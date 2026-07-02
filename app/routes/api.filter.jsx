import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  getActiveRuleForSearch,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
  getActivePinningRuleForSearch,
  buildIncludeWhereClause,
} from "../services/merchandising.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";
import meiliClient from "../services/meiliClient.server";
import { unauthenticated } from "../shopify.server";

/**
 * Storefront Filtering API
 * Computes dynamic facets (counts, options) and returns matched products.
 * Supports groupId to serve filter config for a specific FilterGroup.
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

    const globalSettings = await getFilterGlobalSettings(shop);

    const mergedValues = await prisma.mergedValue.findMany({
      where: { shop, isActive: true },
    });

    // ── 0. Parse Query Parameters (needed for resolving group) ───────
    const collectionId = url.searchParams.get("collectionId");
    const collectionHandle = url.searchParams.get("collectionHandle");
    const customerTagsStr = url.searchParams.get("customerTags") || url.searchParams.get("customer_tags") || "";
    const currentCustomerTags = customerTagsStr.split(',').filter(Boolean);
    const minPrice = parseFloat(url.searchParams.get("minPrice") || "0");
    const maxPrice = parseFloat(url.searchParams.get("maxPrice") || "9999999");
    const isSearch = url.searchParams.get("isSearch") === "true";
    const searchQuery = url.searchParams.get("q") || "";
    const searchType = url.searchParams.get("searchType") || "page";

    // ── 1. Fetch Active Filter Group ───────────────────────────────────
    let activeGroupFilters = null;
    let targetGroup = null;

    if (isSearch) {
      // If it's a search page, fetch the filter group specifically assigned to search
      const searchGroupColl = await prisma.filterGroupCollection.findFirst({
        where: {
          pageType: "search",
          filterGroup: { shop, isDefault: false, status: true },
        },
        include: {
          filterGroup: { include: { filters: { orderBy: { order: "asc" } } } },
        },
      });
      if (searchGroupColl && searchGroupColl.filterGroup) {
        activeGroupFilters = searchGroupColl.filterGroup.filters;
      }
    }

    let resolvedCollectionId = collectionId;
    let resolvedCollectionTitle = "";
    
    if (collectionHandle) {
      if (collectionHandle.toLowerCase() === "all") {
        resolvedCollectionTitle = "all";
      } else {
        const coll = await prisma.collection.findFirst({
          where: { handle: collectionHandle, shop },
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
      });
      if (coll) {
        resolvedCollectionTitle = coll.title;
        resolvedCollectionId = coll.id;
      }
    }

    if (!activeGroupFilters && resolvedCollectionId) {
      // Try to find a specific group assigned to this collection
      const assignedGroup = await prisma.filterGroup.findFirst({
        where: {
          shop,
          status: true,
          collections: {
            some: {
              collectionId: resolvedCollectionId,
            },
          },
        },
        include: { filters: { orderBy: { order: "asc" } } },
      });
      if (assignedGroup) activeGroupFilters = assignedGroup.filters;
    }

    if (!activeGroupFilters) {
      // Try to find the default group
      const defaultGroup = await prisma.filterGroup.findFirst({
        where: { shop, isDefault: true, status: true },
        include: { filters: { orderBy: { order: "asc" } } },
      });
      if (defaultGroup) activeGroupFilters = defaultGroup.filters;
    }

    // ── 2. Parse Remaining Query Parameters ────────────────────────────

    let vendors = url.searchParams.getAll("vendor[]");
    let types = url.searchParams.getAll("type[]");
    const collections = url.searchParams.getAll("collection[]");
    let tags = url.searchParams.getAll("tags[]");
    const availability = url.searchParams.getAll("availability[]");
    const titles = url.searchParams.getAll("title[]");

    const sortBy = url.searchParams.get("sortBy") || "best-selling";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "24");

    // Parse variant option filters (e.g. options[Size][]=M)
    const optionsFilters = {};
    // Parse metafield filters (e.g. metafields[custom.material][]=Cotton)
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

    // Determine if user has actively selected any filters or changed default sorting
    const userHasFilters = 
        vendors.length > 0 || 
        types.length > 0 || 
        collections.length > 0 || 
        tags.length > 0 || 
        titles.length > 0 || 
        availability.length > 0 ||
        Object.values(optionsFilters).some(v => v.length > 0) || 
        Object.values(metafieldsFilters).some(v => v.length > 0) || 
        (minPrice > 0 || maxPrice < 9999999) || 
        sortBy !== "best-selling";

    // 🚚 2. Fetch Active Pinning Rule & Merchandising Rules Early 🚚
    let activePinningRule = null;
    
    // Only apply pinning rule if NO user filters or custom sorting are active
    if (!userHasFilters) {
      if (isSearch && searchQuery) {
        activePinningRule = await getActivePinningRuleForSearch(shop, searchQuery, searchType);
      } else {
        activePinningRule = await getActivePinningRuleForCollection(
          shop,
          resolvedCollectionTitle,
        );
      }
    }

    let pinnedIds = [];
    if (activePinningRule && activePinningRule.products) {
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

    let activeRule = null;
    if (isSearch && searchQuery) {
      activeRule = await getActiveRuleForSearch(
        shop,
        searchQuery,
        currentCustomerTags
      );
    } else {
      activeRule = await getActiveRuleForCollection(
        shop,
        resolvedCollectionTitle,
        currentCustomerTags
      );
    }

    let includeWhereClause = null;
    if (activeRule && activeRule.conditions) {
      const includes = activeRule.conditions.filter(c => c.action === "Include");
      includeWhereClause = buildIncludeWhereClause(includes);
    }

    // 🚚 3. Build Prisma Base Product Filter Clause 🚚
    const baseWhere = {
      shop,
      status: "active",
    };

    const andConditions = [];

    let collectionCondition = null;
    if (collections.length > 0) {
      collectionCondition = { collections: { some: { collectionId: { in: collections } } } };
    } else if (collectionHandle && collectionHandle.toLowerCase() !== "all") {
      collectionCondition = { collections: { some: { collection: { handle: collectionHandle } } } };
    } else if (collectionId) {
      collectionCondition = { collections: { some: { collectionId } } };
    }

    let pinnedIdsWhere = null;
    if (pinnedIds.length > 0) {
      pinnedIdsWhere = { id: { in: pinnedIds } };
    }

    if ((includeWhereClause || pinnedIdsWhere) && collectionCondition) {
      const orArr = [collectionCondition];
      if (includeWhereClause) orArr.push(...includeWhereClause.OR);
      if (pinnedIdsWhere) orArr.push(pinnedIdsWhere);
      andConditions.push({ OR: orArr });
    } else if (collectionCondition) {
      Object.assign(baseWhere, collectionCondition);
    }

    if (isSearch && searchQuery) {
      const searchOr = [
        { title: { contains: searchQuery, mode: "insensitive" } },
        { tags: { has: searchQuery } },
        { productType: { contains: searchQuery, mode: "insensitive" } },
        { vendor: { contains: searchQuery, mode: "insensitive" } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: searchQuery, mode: "insensitive" } },
                { option1: { contains: searchQuery, mode: "insensitive" } },
                { option2: { contains: searchQuery, mode: "insensitive" } },
                { option3: { contains: searchQuery, mode: "insensitive" } }
              ]
            }
          }
        }
      ];
      if (pinnedIdsWhere) {
        searchOr.push(pinnedIdsWhere);
      }
      andConditions.push({ OR: searchOr });
    }

    if (andConditions.length > 0) {
      baseWhere.AND = andConditions;
    }

    // 🚚 4. Establish Order By 🚚
    let orderBy = {};
    let meiliSort = null;
    switch (sortBy) {
      case "title-ascending": 
        orderBy = { title: "asc" }; 
        meiliSort = ["title:asc"];
        break;
      case "title-descending": 
        orderBy = { title: "desc" }; 
        meiliSort = ["title:desc"];
        break;
      case "price-ascending": 
        orderBy = { priceMin: "asc" }; 
        meiliSort = ["priceMin:asc"];
        break;
      case "price-descending": 
        orderBy = { priceMin: "desc" };
        meiliSort = ["priceMin:desc"];
        break;
      case "created-descending":
        orderBy = { createdAt: "desc" };
        meiliSort = ["createdAt:desc"];
        break;
      case "created-ascending":
        orderBy = { createdAt: "asc" };
        meiliSort = ["createdAt:asc"];
        break;
    }
    
    const baseFilters = [`shop = '${shop}'`];
    if (resolvedCollectionId) {
       baseFilters.push(`collections = '${resolvedCollectionId}'`);
    }
    if (minPrice > 0 || maxPrice < 9999999) {
       baseFilters.push(`priceMin >= ${minPrice} AND priceMin <= ${maxPrice}`);
    }

    const categoryFilters = {};
    if (availability.length > 0) {
       if (availability.includes("in_stock") && !availability.includes("out_of_stock")) categoryFilters["available"] = `available = true`;
       else if (availability.includes("out_of_stock") && !availability.includes("in_stock")) categoryFilters["available"] = `available = false`;
    }
    if (vendors.length > 0) {
       categoryFilters["vendor"] = `vendor IN [${vendors.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`;
    }
    if (types.length > 0) {
       categoryFilters["productType"] = `productType IN [${types.map(t => `'${t.replace(/'/g, "\\'")}'`).join(',')}]`;
    }
    if (tags.length > 0) {
       categoryFilters["tags"] = `tags IN [${tags.map(t => `'${t.replace(/'/g, "\\'")}'`).join(',')}]`;
    }
    for (const [key, values] of Object.entries(optionsFilters)) {
       if (values.length > 0) {
          categoryFilters[`option_${key}`] = `option_${key} IN [${values.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`;
       }
    }
    for (const [key, values] of Object.entries(metafieldsFilters)) {
       if (values.length > 0) {
          categoryFilters[`metafield_${key}`] = `metafield_${key} IN [${values.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`;
       }
    }

    const allFiltersList = [...baseFilters, ...Object.values(categoryFilters)];
    
    const queries = [];
    const mainQuery = {
       indexUid: "products",
       q: searchQuery,
       filter: allFiltersList,
       facets: ["*"],
       limit: 1000,
       attributesToHighlight: ["title", "tags", "productType", "vendor"]
    };
    if (meiliSort) mainQuery.sort = meiliSort;
    queries.push(mainQuery);
    
    const activeCategories = Object.keys(categoryFilters);
    for (const cat of activeCategories) {
        const filterForThisCat = [
           ...baseFilters,
           ...activeCategories.filter(c => c !== cat).map(c => categoryFilters[c])
        ];
        queries.push({
           indexUid: "products",
           q: searchQuery,
           filter: filterForThisCat,
           facets: [cat],
           limit: 0, 
        });
    }

    const meiliStart = Date.now();
    let meiliRes = { hits: [], estimatedTotalHits: 0 };
    let facetDistribution = {};
    
    try {
        const multiSearchRes = await meiliClient.multiSearch({ queries });
        meiliRes = multiSearchRes.results[0];
        facetDistribution = { ...(meiliRes.facetDistribution || {}) };
        
        for (let i = 0; i < activeCategories.length; i++) {
           const cat = activeCategories[i];
           const catRes = multiSearchRes.results[i + 1];
           if (catRes && catRes.facetDistribution && catRes.facetDistribution[cat]) {
               facetDistribution[cat] = catRes.facetDistribution[cat];
           }
        }
    } catch (e) {
        console.error("CFP: Meilisearch MultiSearch failed:", e);
    }

    let didYouMean = null;
    if (searchQuery && searchQuery.length > 2 && meiliRes.hits.length > 0) {
      const sq = searchQuery.toLowerCase();
      const exactMatchFound = meiliRes.hits.some(hit => 
        (hit.title && hit.title.toLowerCase().includes(sq)) ||
        (hit.tags && hit.tags.some(t => t.toLowerCase().includes(sq))) ||
        (hit.vendor && hit.vendor.toLowerCase().includes(sq)) ||
        (hit.productType && hit.productType.toLowerCase().includes(sq))
      );

      if (!exactMatchFound) {
        const firstHit = meiliRes.hits[0];
        if (firstHit && firstHit._formatted) {
          const match = JSON.stringify(firstHit._formatted).match(/<em>(.*?)<\/em>/i);
          if (match && match[1]) {
             const suggestion = match[1].toLowerCase().trim();
             if (suggestion !== sq && /^[a-z0-9\s]+$/.test(suggestion)) {
                didYouMean = suggestion;
             }
          }
        }
      }
    }
    const meiliTime = Date.now() - meiliStart;

    const totalCount = meiliRes.estimatedTotalHits || 0;
    // ✅ Use Meilisearch hits directly — they now contain handle, images, variantPrices
    const allMatchedProducts = (meiliRes.hits || []).map(h => ({
        ...h,
        id: `gid://shopify/Product/${h.id}`,
        // Normalize variantPrices → variants shape for merchandising logic
        variants: (h.variantPrices || []).map(v => ({
          available: v.available,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
        })),
    }));

    if (pinnedIds && pinnedIds.length > 0) {
        pinnedIds.forEach(id => {
            if (!allMatchedProducts.some(p => p.id === id)) {
                allMatchedProducts.push({ id, variants: [] });
            }
        });
    }

    // ✅ Build collectionIdToTitle from Meili facets (no extra Prisma query needed)
    const collectionIdToTitle = {};
    const prismaTime = 0;

    // Compute Price Range Counts from the top 1000 items
    const priceFilter = activeGroupFilters ? activeGroupFilters.find((f) => f.filterType === "price" || f.type === "price") : null;
    let priceRangesConfig = [];
    if (priceFilter && priceFilter.config) {
      try {
        const configObj = typeof priceFilter.config === "string" ? JSON.parse(priceFilter.config) : priceFilter.config;
        priceRangesConfig = configObj.priceRanges || [];
      } catch (e) {}
    }
    const priceRangeCounts = priceRangesConfig.map((r) => ({ ...r, count: 0 }));
    
    let absoluteMinPrice = Infinity;
    let absoluteMaxPrice = -Infinity;

    if (allMatchedProducts.length > 0) {
       allMatchedProducts.forEach(p => {
          if (priceRangeCounts.length > 0) {
             priceRangeCounts.forEach(r => {
                const rMin = parseFloat(r.min !== undefined ? r.min : r.from) || 0;
                const rMaxVal = r.max !== undefined ? r.max : r.to;
                const rMax = (rMaxVal === "" || rMaxVal === null || rMaxVal === undefined) ? Infinity : parseFloat(rMaxVal);
                if (p.priceMin >= rMin && p.priceMin <= rMax) r.count += 1;
             });
          }
          if (p.priceMin < absoluteMinPrice) absoluteMinPrice = p.priceMin;
          if (p.priceMax > absoluteMaxPrice) absoluteMaxPrice = p.priceMax;
       });
    }

    const getTargetValue = (type, rawValue) => {
        const rule = mergedValues.find(
            m => m.filterType.toLowerCase() === type.toLowerCase() && 
                 m.sourceValues.some(sv => sv.toLowerCase() === rawValue.toLowerCase())
        );
        return rule ? rule.targetValue : rawValue;
    };
    const vendorCounts = {};
    const typeCounts = {};
    const tagCounts = {};
    const titleCounts = {};
    const optionCounts = {};
    const metafieldCounts = {};
    const collectionCounts = facetDistribution.collections || {};
    let inStockCount = facetDistribution.available?.true || 0;
    let outOfStockCount = facetDistribution.available?.false || 0;

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
            const metaKey = facetKey.replace("metafield_", ""); // "namespace.key"
            if (!metafieldCounts[metaKey]) metafieldCounts[metaKey] = {};
            for (const [val, count] of Object.entries(counts)) {
                metafieldCounts[metaKey][val] = (metafieldCounts[metaKey][val] || 0) + count;
            }
        }
    }

    // ── 6. Apply Merchandising Scores and Sort ─────────────────────────
    const finalProducts = applyMerchandisingRules(
      allMatchedProducts,
      activeRule,
      sortBy,
      activePinningRule,
    );

    // ── 7. Build paginated products from Meilisearch data directly ───────
    // ✅ No extra Prisma query needed — Meili doc now has handle, images, variantPrices
    const startIndex = (page - 1) * limit;
    const paginatedSlice = finalProducts.slice(startIndex, startIndex + limit);

    let products = paginatedSlice.map((p) => {
      // Shape the product to match the frontend's expected format
      const variantPrices = p.variantPrices || [];
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        tags: p.tags || [],
        images: p.images || [],
        status: (p.status || 'ACTIVE').toLowerCase(),
        options: p.options || [],
        merchandisingImage: p.merchandisingImage || null,
        variants: variantPrices.map(v => ({
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
    });

    const totalMs = Date.now() - startTime;

    let contextualPricingApplied = false;
    const country = url.searchParams.get("country");
    if (country && products.length > 0) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        if (admin) {
           const productGids = products.map(p => p.id);
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
           const response = await admin.graphql(query, { variables: { ids: productGids, country } });
           const json = await response.json();
           if (json.data && json.data.nodes) {
              json.data.nodes.forEach(node => {
                 if (!node) return;
                 const product = products.find(p => p.id === node.id);
                 if (product) {
                    let minPrice = Infinity;
                    let maxPrice = -Infinity;
                    node.variants.nodes.forEach(vNode => {
                       const v = product.variants.find(pv => pv.id === vNode.id);
                       if (v && vNode.contextualPricing) {
                          const amt = parseFloat(vNode.contextualPricing.price.amount);
                          v.price = amt;
                          if (vNode.contextualPricing.compareAtPrice) {
                             v.compareAtPrice = parseFloat(vNode.contextualPricing.compareAtPrice.amount);
                          }
                          if (amt < minPrice) minPrice = amt;
                          if (amt > maxPrice) maxPrice = amt;
                       }
                    });
                    if (minPrice !== Infinity) {
                       product.priceMin = minPrice;
                       product.priceMax = maxPrice;
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

    return data({
      products,
      totalCount,
      contextualPricingApplied,
      // Return group filters (FilterGroupItem[]) if available, else empty
      settings: activeGroupFilters || [],
      globalSettings,
      mergedValues,
      debug: {
        resolvedCollectionId,
        resolvedCollectionTitle,
        hasActivePinningRule: !!activePinningRule,
        pinningRuleName: activePinningRule?.name,
        pinnedProductsCount: activePinningRule?.products ? (typeof activePinningRule.products === "string" ? JSON.parse(activePinningRule.products).length : activePinningRule.products.length) : 0,
        hasMerchandisingRule: !!activeRule,
        activeGroupFiltersLength: activeGroupFilters ? activeGroupFilters.length : null,
        timing: {
           meiliMs: meiliTime,
           prismaMs: prismaTime,
           totalMs: totalMs
        }
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
            .sort((a, b) => String(a.value || "").localeCompare(String(b.value || "")));
          return acc;
        }, {}),
        collections: Object.entries(collectionCounts)
          .map(([value, count]) => ({
            value,
            label: collectionIdToTitle[value] || value,
            count: count,
          }))
          .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""))),
        metafields: Object.entries(metafieldCounts).reduce(
          (acc, [key, valuesMap]) => {
            acc[key] = Object.entries(valuesMap)
              .map(([value, count]) => ({ value, count }))
              .sort((a, b) => String(a.value || "").localeCompare(String(b.value || "")));
            return acc;
          },
          {},
        ),
        availability: {
          inStock: inStockCount,
          outOfStock: outOfStockCount,
        },
        priceRanges: {
          ranges: priceRangeCounts,
          minLimit: absoluteMinPrice === Infinity ? 0 : absoluteMinPrice,
          maxLimit: absoluteMaxPrice === -Infinity ? 100000 : absoluteMaxPrice
        },
      },
    });
  } catch (err) {
    console.error("API Filter Error: ", err);
    return data({ error: err.message, stack: err.stack, crash: true }, { status: 200 });
  }
};
