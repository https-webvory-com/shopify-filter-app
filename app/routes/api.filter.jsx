import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  getActiveRuleForSearch,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
  getActivePinningRuleForSearch,
} from "../services/merchandising.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";
import meiliClient from "../services/meiliClient.server";
import { getCached } from "../services/shopCache.server";
import { unauthenticated } from "../shopify.server";

/**
 * Storefront Filtering API — OPTIMIZED
 *
 * Key optimizations vs previous version:
 *  1. All independent DB queries run in parallel via Promise.all()
 *  2. Stable shop config (settings, mergedValues, filterGroups) served from in-memory cache
 *  3. Meilisearch uses native offset pagination (no more limit:1000 + JS slice)
 *  4. Facet query is separate (limit:0) so product data is not transferred for counts
 *  5. Pinning + merchandising rule DB calls run in parallel
 */
export const loader = async ({ request }) => {
  const startTime = Date.now();
  console.log("API Filter Request: ", request.url);
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return data({ error: "Missing shop parameter" }, { status: 400 });
    }

    // ── 0. Parse ALL query parameters upfront ─────────────────────────
    const collectionId = url.searchParams.get("collectionId");
    const collectionHandle = url.searchParams.get("collectionHandle");
    const customerTagsStr =
      url.searchParams.get("customerTags") ||
      url.searchParams.get("customer_tags") ||
      "";
    const currentCustomerTags = customerTagsStr.split(",").filter(Boolean);
    const minPrice = parseFloat(url.searchParams.get("minPrice") || "0");
    const maxPrice = parseFloat(url.searchParams.get("maxPrice") || "9999999");
    const isSearch = url.searchParams.get("isSearch") === "true";
    const searchQuery = url.searchParams.get("q") || "";
    const searchType = url.searchParams.get("searchType") || "page";
    const sortBy = url.searchParams.get("sortBy") || "best-selling";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "24");
    const country = url.searchParams.get("country");

    let vendors = url.searchParams.getAll("vendor[]");
    let types = url.searchParams.getAll("type[]");
    const collections = url.searchParams.getAll("collection[]");
    let tags = url.searchParams.getAll("tags[]");
    const availability = url.searchParams.getAll("availability[]");
    const titles = url.searchParams.getAll("title[]");

    const optionsFilters = {};
    const metafieldsFilters = {};
    for (const [key, value] of url.searchParams.entries()) {
      const optionMatch = key.match(/^options\[([^\]]+)\](?:\[\])?$/);
      if (optionMatch) {
        const optionName = optionMatch[1];
        if (!optionsFilters[optionName]) optionsFilters[optionName] = [];
        optionsFilters[optionName].push(value);
      }
      const metafieldMatch = key.match(/^metafields\[([^\]]+)\](?:\[\])?$/);
      if (metafieldMatch) {
        const metafieldKey = metafieldMatch[1];
        if (!metafieldsFilters[metafieldKey])
          metafieldsFilters[metafieldKey] = [];
        metafieldsFilters[metafieldKey].push(value);
      }
    }

    // ── 1. Parallel fetch: stable shop config (all cached) ─────────────
    // These 3 change only when admin saves settings → safe to cache 60s
    const [globalSettings, mergedValues, resolvedGroup] = await Promise.all([
      // Cached: filter global settings
      getCached(`globalSettings:${shop}`, () => getFilterGlobalSettings(shop)),

      // Cached: merged values
      getCached(`mergedValues:${shop}`, () =>
        prisma.mergedValue.findMany({ where: { shop, isActive: true } })
      ),

      // Cached: resolve collection + active filter group in one helper
      getCached(
        `filterGroup:${shop}:${isSearch ? "search" : collectionHandle || collectionId || "default"}`,
        async () => {
          let resolvedCollectionId = collectionId;
          let resolvedCollectionTitle = "";

          // Resolve collection handle → id/title
          if (collectionHandle) {
            if (collectionHandle.toLowerCase() === "all") {
              resolvedCollectionTitle = "all";
            } else {
              const coll = await prisma.collection.findFirst({
                where: { handle: collectionHandle, shop },
                select: { id: true, title: true },
              });
              if (coll) {
                resolvedCollectionId = coll.id;
                resolvedCollectionTitle = coll.title;
              }
            }
          }

          if (!resolvedCollectionTitle && resolvedCollectionId) {
            const formattedId = resolvedCollectionId.includes("gid://")
              ? resolvedCollectionId
              : `gid://shopify/Collection/${resolvedCollectionId}`;
            const coll = await prisma.collection.findUnique({
              where: { id: formattedId },
              select: { id: true, title: true },
            });
            if (coll) {
              resolvedCollectionTitle = coll.title;
              resolvedCollectionId = coll.id;
            }
          }

          // Resolve active filter group
          let activeGroupFilters = null;

          if (isSearch) {
            const searchGroupColl =
              await prisma.filterGroupCollection.findFirst({
                where: {
                  pageType: "search",
                  filterGroup: { shop, isDefault: false, status: true },
                },
                include: {
                  filterGroup: {
                    include: { filters: { orderBy: { order: "asc" } } },
                  },
                },
              });
            if (searchGroupColl?.filterGroup) {
              activeGroupFilters = searchGroupColl.filterGroup.filters;
            }
          }

          if (!activeGroupFilters && resolvedCollectionId) {
            const assignedGroup = await prisma.filterGroup.findFirst({
              where: {
                shop,
                status: true,
                collections: {
                  some: { collectionId: resolvedCollectionId },
                },
              },
              include: { filters: { orderBy: { order: "asc" } } },
            });
            if (assignedGroup) activeGroupFilters = assignedGroup.filters;
          }

          if (!activeGroupFilters) {
            const defaultGroup = await prisma.filterGroup.findFirst({
              where: { shop, isDefault: true, status: true },
              include: { filters: { orderBy: { order: "asc" } } },
            });
            if (defaultGroup) activeGroupFilters = defaultGroup.filters;
          }

          return { resolvedCollectionId, resolvedCollectionTitle, activeGroupFilters };
        }
      ),
    ]);

    const { resolvedCollectionId, resolvedCollectionTitle, activeGroupFilters } =
      resolvedGroup;

    // ── 2. Expand merged values ────────────────────────────────────────
    const expandFilterValues = (type, values) => {
      let expanded = [...values];
      for (const val of values) {
        const rules = mergedValues.filter(
          (m) =>
            m.filterType.toLowerCase() === type.toLowerCase() &&
            m.targetValue.toLowerCase() === val.toLowerCase()
        );
        for (const r of rules) {
          expanded.push(...r.sourceValues);
        }
      }
      return [...new Set(expanded)];
    };

    vendors = expandFilterValues("vendor", vendors);
    types = expandFilterValues("product_type", types);
    tags = expandFilterValues("tags", tags);
    for (const key of Object.keys(optionsFilters)) {
      optionsFilters[key] = expandFilterValues(key, optionsFilters[key]);
    }

    // ── 3. Determine if user has active filters ────────────────────────
    const userHasFilters =
      vendors.length > 0 ||
      types.length > 0 ||
      collections.length > 0 ||
      tags.length > 0 ||
      titles.length > 0 ||
      availability.length > 0 ||
      Object.values(optionsFilters).some((v) => v.length > 0) ||
      Object.values(metafieldsFilters).some((v) => v.length > 0) ||
      minPrice > 0 ||
      maxPrice < 9999999 ||
      sortBy !== "best-selling";

    // ── 4. Parallel fetch: pinning + merchandising rules ───────────────
    // These run at same time (independent of each other)
    const [activePinningRule, activeRule] = await Promise.all([
      userHasFilters
        ? Promise.resolve(null) // No pinning when user has active filters
        : isSearch && searchQuery
        ? getActivePinningRuleForSearch(shop, searchQuery, searchType)
        : getActivePinningRuleForCollection(shop, resolvedCollectionTitle),

      isSearch && searchQuery
        ? getActiveRuleForSearch(shop, searchQuery, currentCustomerTags)
        : getActiveRuleForCollection(shop, resolvedCollectionTitle, currentCustomerTags),
    ]);

    // ── 5. Parse pinned IDs ────────────────────────────────────────────
    let pinnedIds = [];
    if (activePinningRule?.products) {
      try {
        const parsedPins =
          typeof activePinningRule.products === "string"
            ? JSON.parse(activePinningRule.products)
            : activePinningRule.products;
        if (Array.isArray(parsedPins)) {
          pinnedIds = parsedPins.map((p) => p.id);
        }
      } catch (e) {}
    }

    // ── 6. Build Meilisearch sort ──────────────────────────────────────
    let meiliSort = null;
    switch (sortBy) {
      case "title-ascending":
        meiliSort = ["title:asc"];
        break;
      case "title-descending":
        meiliSort = ["title:desc"];
        break;
      case "price-ascending":
        meiliSort = ["priceMin:asc"];
        break;
      case "price-descending":
        meiliSort = ["priceMin:desc"];
        break;
      case "created-descending":
        meiliSort = ["createdAt:desc"];
        break;
      case "created-ascending":
        meiliSort = ["createdAt:asc"];
        break;
    }

    // ── 7. Build Meilisearch filters ───────────────────────────────────
    const baseFilters = [`shop = '${shop}'`, `status = 'ACTIVE'`];
    if (globalSettings?.showOnlyInStock) {
      baseFilters.push(`available = true`);
    }
    if (resolvedCollectionId) {
      baseFilters.push(`collections = '${resolvedCollectionId}'`);
    }
    const categoryFilters = {};
    if (minPrice > 0 || maxPrice < 9999999) {
      const bufferedMin = Math.max(0, minPrice - 0.5);
      const bufferedMax = maxPrice + 0.5;
      categoryFilters["priceMin"] = `priceMin >= ${bufferedMin} AND priceMin <= ${bufferedMax}`;
    }
    if (availability.length > 0) {
      if (
        availability.includes("in_stock") &&
        !availability.includes("out_of_stock")
      )
        categoryFilters["available"] = `available = true`;
      else if (
        availability.includes("out_of_stock") &&
        !availability.includes("in_stock")
      )
        categoryFilters["available"] = `available = false`;
    }
    if (vendors.length > 0) {
      categoryFilters["vendor"] = `vendor IN [${vendors
        .map((v) => `'${v.replace(/'/g, "\\'")}'`)
        .join(",")}]`;
    }
    if (collections.length > 0) {
      categoryFilters["collection_titles"] = `collection_titles IN [${collections
        .map((c) => `'${c.replace(/'/g, "\\'")}'`)
        .join(",")}]`;
    }
    if (types.length > 0) {
      categoryFilters["productType"] = `productType IN [${types
        .map((t) => `'${t.replace(/'/g, "\\'")}'`)
        .join(",")}]`;
    }
    if (tags.length > 0) {
      categoryFilters["tags"] = `tags IN [${tags
        .map((t) => `'${t.replace(/'/g, "\\'")}'`)
        .join(",")}]`;
    }
    for (const [key, values] of Object.entries(optionsFilters)) {
      if (values.length > 0) {
        categoryFilters[`option_${key}`] = `option_${key} IN [${values
          .map((v) => `'${v.replace(/'/g, "\\'")}'`)
          .join(",")}]`;
      }
    }
    for (const [key, values] of Object.entries(metafieldsFilters)) {
      if (values.length > 0) {
        categoryFilters[`metafield_${key}`] = `metafield_${key} IN [${values
          .map((v) => `'${v.replace(/'/g, "\\'")}'`)
          .join(",")}]`;
      }
    }

    const allFiltersList = [...baseFilters, ...Object.values(categoryFilters)];
    const activeCategories = Object.keys(categoryFilters);

    // ── 8. Build Meilisearch queries ───────────────────────────────────
    //
    // KEY OPTIMIZATION: Split into 3 query types:
    //
    //  A) Main paginated query  → limit:24, offset:N → only transfers 24 docs
    //  B) Facet-only query      → limit:0 → gets all facet counts, transfers NO docs
    //  C) Per-category queries  → limit:0 → for disjunctive faceting
    //
    // Previously: limit:1000 fetched 1000 full docs (with variants!) for JS-side pagination
    // Now: Only 24 docs are transferred per request
    //
    // EXCEPTION: When pinning is active, we need a broader fetch to inject pinned products
    // at the right positions. We fetch 1 extra page + pinned count in that case.

    const hasPinning = pinnedIds.length > 0;
    const hasMerchandisingExclude =
      activeRule?.conditions?.some((c) => c.action === "Exclude") ?? false;

    // If pinning or merchandising exclude is active, we still need broader fetch
    // to apply JS-side ordering correctly
    const needsBroadFetch = hasPinning || hasMerchandisingExclude;

    const queries = [];

    // Query A: Main product data
    const mainQuery = {
      indexUid: "products",
      q: searchQuery,
      filter: allFiltersList,
      limit: needsBroadFetch ? 1000 : limit,
      offset: needsBroadFetch ? 0 : (page - 1) * limit,
      attributesToRetrieve: [
        "id", "title", "handle", "vendor", "productType",
        "priceMin", "priceMax", "tags", "images", "variantPrices",
        "merchandisingImage", "options", "status", "available", "createdAt",
        "metafield_custom.plus_size_collection_image",
        "metafield_custom.mother_of_the_bride_collection_image",
        "metafield_custom.wedding_collection_image"
      ],
    };
    if (meiliSort) mainQuery.sort = meiliSort;
    if (searchQuery) mainQuery.attributesToHighlight = ["title"];
    queries.push(mainQuery);

    // Query B: Facets only (no product data transferred)
    const facetQuery = {
      indexUid: "products",
      q: searchQuery,
      filter: allFiltersList,
      facets: ["*"],
      limit: 0,
      attributesToRetrieve: [],
    };
    queries.push(facetQuery);

    // Query C: Per active-category queries for disjunctive faceting
    for (const cat of activeCategories) {
      const filterForThisCat = [
        ...baseFilters,
        ...activeCategories
          .filter((c) => c !== cat)
          .map((c) => categoryFilters[c]),
      ];
      queries.push({
        indexUid: "products",
        q: searchQuery,
        filter: filterForThisCat,
        facets: [cat],
        limit: 0,
        attributesToRetrieve: [],
      });
    }

    // ── 9. Execute Meilisearch multiSearch ─────────────────────────────
    const meiliStart = Date.now();
    let meiliRes = { hits: [], estimatedTotalHits: 0 };
    let facetDistribution = {};
    let facetRes = null;

    try {
      const multiSearchRes = await meiliClient.multiSearch({ queries });
      meiliRes = multiSearchRes.results[0]; // Main paginated results
      facetRes = multiSearchRes.results[1]; // Facet-only result
      facetDistribution = { ...(facetRes?.facetDistribution || {}) };

      // Merge disjunctive facet counts
      for (let i = 0; i < activeCategories.length; i++) {
        const cat = activeCategories[i];
        const catRes = multiSearchRes.results[i + 2];
        if (catRes?.facetDistribution?.[cat]) {
          facetDistribution[cat] = catRes.facetDistribution[cat];
        }
        if (catRes?.facetStats?.[cat]) {
          if (!facetRes) facetRes = {};
          if (!facetRes.facetStats) facetRes.facetStats = {};
          facetRes.facetStats[cat] = catRes.facetStats[cat];
        }
      }
    } catch (e) {
      console.error("CFP: Meilisearch MultiSearch failed:", e);
    }

    const meiliTime = Date.now() - meiliStart;

    // ── 10. Map Meilisearch hits → product objects ─────────────────────
    let allMatchedProducts = (meiliRes.hits || []).map((h) => ({
      ...h,
      id: `gid://shopify/Product/${h.id}`,
      variants: (h.variantPrices || []).map((v) => ({
        available: v.available,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
      })),
    }));

    // Inject pinned products that might not appear in the current filter result
    if (pinnedIds.length > 0) {
      pinnedIds.forEach((id) => {
        if (!allMatchedProducts.some((p) => p.id === id)) {
          allMatchedProducts.push({ id, variants: [] });
        }
      });
    }

    // ── 11. Apply merchandising rules + sort ───────────────────────────
    const finalProducts = applyMerchandisingRules(
      allMatchedProducts,
      activeRule,
      sortBy,
      activePinningRule,
    );

    // ── 12. Paginate results ───────────────────────────────────────────
    const totalCount = meiliRes.estimatedTotalHits || 0;
    const paginatedSlice = needsBroadFetch
      ? finalProducts.slice((page - 1) * limit, page * limit)
      : finalProducts; // Already paginated by Meilisearch

    // ── 12.5 Fallback for missing options ──────────────────────────────
    const productsMissingOptions = paginatedSlice.filter(p => !p.options || p.options.length === 0);
    if (productsMissingOptions.length > 0) {
      try {
        const missingIds = productsMissingOptions.map(p => p.id);
        const dbOptions = await prisma.product.findMany({
          where: { id: { in: missingIds } },
          select: { id: true, options: true }
        });
        paginatedSlice.forEach(p => {
          if (!p.options || p.options.length === 0) {
            const dbMatch = dbOptions.find(dbP => dbP.id === p.id);
            if (dbMatch && dbMatch.options) {
              p.options = dbMatch.options.map(opt => ({
                name: opt.name,
                values: Array.isArray(opt.values) ? opt.values : [opt.values]
              }));
            }
          }
        });
      } catch (e) {
        console.error("CFP: Failed to fetch fallback options", e);
      }
    }

    // ── 13. Shape products for response ───────────────────────────────
    let products = paginatedSlice.map((p) => {
      const variantPrices = p.variantPrices || [];
      const productObj = {
        id: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        tags: p.tags || [],
        images: p.images || [],
        status: (p.status || "ACTIVE").toLowerCase(),
        options: p.options || [],
        merchandisingImage: p.merchandisingImage || null,
        variants: variantPrices.map((v) => ({
          id: `gid://shopify/ProductVariant/${v.id}`,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          available: v.available,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          imageUrl: v.imageUrl,
        })),
      };

      // Pass through any metafields from Meilisearch
      Object.keys(p).forEach(key => {
        if (key.startsWith("metafield_")) {
          productObj[key] = p[key];
        }
      });

      return productObj;
    });

    // ── 14. Did-you-mean suggestion ────────────────────────────────────
    let didYouMean = null;
    if (searchQuery && searchQuery.length > 2 && meiliRes.hits.length > 0) {
      const sq = searchQuery.toLowerCase();
      const exactMatchFound = meiliRes.hits.some(
        (hit) =>
          (hit.title && hit.title.toLowerCase().includes(sq)) ||
          (hit.tags && hit.tags.some((t) => t.toLowerCase().includes(sq))) ||
          (hit.vendor && hit.vendor.toLowerCase().includes(sq)) ||
          (hit.productType && hit.productType.toLowerCase().includes(sq))
      );
      if (!exactMatchFound) {
        const firstHit = meiliRes.hits[0];
        if (firstHit?._formatted) {
          const match = JSON.stringify(firstHit._formatted).match(
            /<em>(.*?)<\/em>/i
          );
          if (match?.[1]) {
            const suggestion = match[1].toLowerCase().trim();
            if (suggestion !== sq && /^[a-z0-9\s]+$/.test(suggestion)) {
              didYouMean = suggestion;
            }
          }
        }
      }
    }

    // ── 15. Price range counts (from Meilisearch hits) ────────────────
    const priceFilter = activeGroupFilters
      ? activeGroupFilters.find(
          (f) => f.filterType === "price" || f.type === "price"
        )
      : null;
    let priceRangesConfig = [];
    if (priceFilter?.config) {
      try {
        const configObj =
          typeof priceFilter.config === "string"
            ? JSON.parse(priceFilter.config)
            : priceFilter.config;
        priceRangesConfig = configObj.priceRanges || [];
      } catch (e) {}
    }
    const priceRangeCounts = priceRangesConfig.map((r) => ({ ...r, count: 0 }));

    let absoluteMinPrice = Infinity;
    let absoluteMaxPrice = -Infinity;

    if (facetRes && facetRes.facetStats && facetRes.facetStats.priceMin) {
      absoluteMinPrice = facetRes.facetStats.priceMin.min;
      absoluteMaxPrice = facetRes.facetStats.priceMin.max;
      
      // Fallback loop for price range list counts (note: only counts current page unless broadFetch)
      if (allMatchedProducts.length > 0 && priceRangeCounts.length > 0) {
        allMatchedProducts.forEach((p) => {
          priceRangeCounts.forEach((r) => {
            const rMin = parseFloat(r.min !== undefined ? r.min : r.from) || 0;
            const rMaxVal = r.max !== undefined ? r.max : r.to;
            const rMax = rMaxVal === "" || rMaxVal === null || rMaxVal === undefined ? Infinity : parseFloat(rMaxVal);
            if (p.priceMin >= rMin && p.priceMin <= rMax) r.count += 1;
          });
        });
      }
    } else {
      if (allMatchedProducts.length > 0) {
        allMatchedProducts.forEach((p) => {
          if (priceRangeCounts.length > 0) {
            priceRangeCounts.forEach((r) => {
              const rMin = parseFloat(r.min !== undefined ? r.min : r.from) || 0;
              const rMaxVal = r.max !== undefined ? r.max : r.to;
              const rMax = rMaxVal === "" || rMaxVal === null || rMaxVal === undefined ? Infinity : parseFloat(rMaxVal);
              if (p.priceMin >= rMin && p.priceMin <= rMax) r.count += 1;
            });
          }
          if (p.priceMin < absoluteMinPrice) absoluteMinPrice = p.priceMin;
          if (p.priceMax > absoluteMaxPrice) absoluteMaxPrice = p.priceMax; // or p.priceMin
        });
      }
    }

    // ── 16. Build facet counts from Meilisearch distribution ──────────
    const getTargetValue = (type, rawValue) => {
      const rule = mergedValues.find(
        (m) =>
          m.filterType.toLowerCase() === type.toLowerCase() &&
          m.sourceValues.some((sv) => sv.toLowerCase() === rawValue.toLowerCase())
      );
      return rule ? rule.targetValue : rawValue;
    };

    const vendorCounts = {};
    const typeCounts = {};
    const tagCounts = {};
    const titleCounts = {};
    const optionCounts = {};
    const metafieldCounts = {};
    const collectionCounts = facetDistribution.collection_titles || {};
    const inStockCount = facetDistribution.available?.true || 0;
    const outOfStockCount = facetDistribution.available?.false || 0;

    if (facetDistribution.vendor) {
      for (const [v, count] of Object.entries(facetDistribution.vendor)) {
        const tv = getTargetValue("vendor", v);
        vendorCounts[tv] = (vendorCounts[tv] || 0) + count;
      }
    }
    if (facetDistribution.productType) {
      for (const [t, count] of Object.entries(facetDistribution.productType)) {
        const tv = getTargetValue("product_type", t);
        typeCounts[tv] = (typeCounts[tv] || 0) + count;
      }
    }
    if (facetDistribution.tags) {
      for (const [t, count] of Object.entries(facetDistribution.tags)) {
        const tv = getTargetValue("tags", t);
        tagCounts[tv] = (tagCounts[tv] || 0) + count;
      }
    }

    for (const [facetKey, counts] of Object.entries(facetDistribution)) {
      if (facetKey.startsWith("option_")) {
        const optName = facetKey.replace("option_", "");
        if (!optionCounts[optName]) optionCounts[optName] = {};
        for (const [val, count] of Object.entries(counts)) {
          const tv = getTargetValue(optName, val);
          optionCounts[optName][tv] = (optionCounts[optName][tv] || 0) + count;
        }
      }
      if (facetKey.startsWith("metafield_")) {
        const metaKey = facetKey.replace("metafield_", "");
        if (!metafieldCounts[metaKey]) metafieldCounts[metaKey] = {};
        for (const [val, count] of Object.entries(counts)) {
          metafieldCounts[metaKey][val] =
            (metafieldCounts[metaKey][val] || 0) + count;
        }
      }
    }

    // ── 17. Optional contextual pricing (country-based) ───────────────
    let contextualPricingApplied = false;
    if (country && products.length > 0) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        if (admin) {
          const productGids = products.map((p) => p.id);
          const query = `
            query getPrices($ids: [ID!]!, $country: CountryCode!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  variants(first: 100) {
                    nodes {
                      id
                      contextualPricing(context: {country: $country}) {
                        price { amount }
                        compareAtPrice { amount }
                      }
                    }
                  }
                }
              }
            }
          `;
          const response = await admin.graphql(query, {
            variables: { ids: productGids, country },
          });
          const json = await response.json();
          if (json.data?.nodes) {
            json.data.nodes.forEach((node) => {
              if (!node) return;
              const product = products.find((p) => p.id === node.id);
              if (product) {
                let pMin = Infinity;
                let pMax = -Infinity;
                node.variants.nodes.forEach((vNode) => {
                  const v = product.variants.find((pv) => pv.id === vNode.id);
                  if (v && vNode.contextualPricing) {
                    const amt = parseFloat(
                      vNode.contextualPricing.price.amount
                    );
                    v.price = amt;
                    if (vNode.contextualPricing.compareAtPrice) {
                      v.compareAtPrice = parseFloat(
                        vNode.contextualPricing.compareAtPrice.amount
                      );
                    }
                    if (amt < pMin) pMin = amt;
                    if (amt > pMax) pMax = amt;
                  }
                });
                if (pMin !== Infinity) {
                  product.priceMin = pMin;
                  product.priceMax = pMax;
                }
              }
            });
            contextualPricingApplied = true;
          }
        }
      } catch (e) {
        console.error("Failed to fetch contextual pricing:", e);
      }
    }

    const totalMs = Date.now() - startTime;
    console.log(`CFP: api/filter completed in ${totalMs}ms (meili: ${meiliTime}ms, broadFetch: ${needsBroadFetch})`);

    return data({
      products,
      totalCount,
      contextualPricingApplied,
      settings: activeGroupFilters || [],
      globalSettings,
      mergedValues,
      didYouMean,
      debug: {
        resolvedCollectionId,
        resolvedCollectionTitle,
        hasActivePinningRule: !!activePinningRule,
        pinningRuleName: activePinningRule?.name,
        pinnedProductsCount: pinnedIds.length,
        hasMerchandisingRule: !!activeRule,
        activeGroupFiltersLength: activeGroupFilters
          ? activeGroupFilters.length
          : null,
        needsBroadFetch,
        timing: {
          meiliMs: meiliTime,
          totalMs,
        },
      },
      facets: {
        vendors: Object.entries(vendorCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => String(a.value || "").localeCompare(String(b.value || ""))),
        productTypes: Object.entries(typeCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => String(a.value || "").localeCompare(String(b.value || ""))),
        tags: Object.entries(tagCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => String(a.value || "").localeCompare(String(b.value || ""))),
        titles: Object.entries(titleCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => String(a.value || "").localeCompare(String(b.value || ""))),
        options: Object.entries(optionCounts).reduce((acc, [name, valuesMap]) => {
          acc[name] = Object.entries(valuesMap)
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) =>
              String(a.value || "").localeCompare(String(b.value || ""))
            );
          return acc;
        }, {}),
        collections: Object.entries(collectionCounts)
          .map(([value, count]) => ({
            value,
            label: value,
            count,
          }))
          .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""))),
        metafields: Object.entries(metafieldCounts).reduce(
          (acc, [key, valuesMap]) => {
            acc[key] = Object.entries(valuesMap)
              .map(([value, count]) => ({ value, count }))
              .sort((a, b) =>
                String(a.value || "").localeCompare(String(b.value || ""))
              );
            return acc;
          },
          {}
        ),
        availability: {
          inStock: inStockCount,
          outOfStock: outOfStockCount,
        },
        priceRanges: {
          ranges: priceRangeCounts,
          minLimit: absoluteMinPrice === Infinity ? 0 : absoluteMinPrice,
          maxLimit: absoluteMaxPrice === -Infinity ? 100000 : absoluteMaxPrice,
        },
      },
    });
  } catch (err) {
    console.error("API Filter Error: ", err);
    return data(
      { error: err.message, stack: err.stack, crash: true },
      { status: 200 }
    );
  }
};
