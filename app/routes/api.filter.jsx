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
    
    const meiliFilters = [`shop = '${shop}'`];
    if (resolvedCollectionId) {
       meiliFilters.push(`collections = '${resolvedCollectionId}'`);
    }
    if (minPrice > 0 || maxPrice < 9999999) {
       meiliFilters.push(`priceMin >= ${minPrice} AND priceMin <= ${maxPrice}`);
    }
    if (availability.length > 0) {
       if (availability.includes("in_stock") && !availability.includes("out_of_stock")) meiliFilters.push(`available = true`);
       else if (availability.includes("out_of_stock") && !availability.includes("in_stock")) meiliFilters.push(`available = false`);
    }
    if (vendors.length > 0) {
       meiliFilters.push(`vendor IN [${vendors.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`);
    }
    if (types.length > 0) {
       meiliFilters.push(`productType IN [${types.map(t => `'${t.replace(/'/g, "\\'")}'`).join(',')}]`);
    }
    if (tags.length > 0) {
       meiliFilters.push(`tags IN [${tags.map(t => `'${t.replace(/'/g, "\\'")}'`).join(',')}]`);
    }
    for (const [key, values] of Object.entries(optionsFilters)) {
       if (values.length > 0) {
          meiliFilters.push(`option_${key} IN [${values.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`);
       }
    }
    for (const [key, values] of Object.entries(metafieldsFilters)) {
       if (values.length > 0) {
          meiliFilters.push(`metafield_${key} IN [${values.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',')}]`);
       }
    }

    const meiliStart = Date.now();
    const meiliSearchParams = {
       filter: meiliFilters,
       facets: ["*"],
       limit: 1000,
       attributesToHighlight: ["title", "tags", "productType", "vendor"]
    };
    if (meiliSort) {
       meiliSearchParams.sort = meiliSort;
    }
    const meiliRes = await meiliClient.index("products").search(searchQuery, meiliSearchParams);

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
        if (firstHit._formatted) {
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

    const totalCount = meiliRes.estimatedTotalHits;
    const facetDistribution = meiliRes.facetDistribution || {};
    const allMatchedProducts = meiliRes.hits.map(h => ({
        ...h,
        id: `gid://shopify/Product/${h.id}`
    }));

    // Fetch full variants for the 1000 products to compute merchandising and price ranges
    const meiliIds = allMatchedProducts.map(h => h.id);
    
    if (pinnedIds && pinnedIds.length > 0) {
        pinnedIds.forEach(id => {
            if (!meiliIds.includes(id)) meiliIds.push(id);
        });
    }

    const prismaStart = Date.now();
    const dbProducts = await prisma.product.findMany({
        where: { id: { in: meiliIds } },
        select: {
          id: true,
          priceMin: true,
          priceMax: true,
          vendor: true,
          productType: true,
          tags: true,
          title: true,
          collections: { select: { collectionId: true, collection: { select: { title: true } } } },
          variants: {
            select: { available: true, price: true, compareAtPrice: true, inventory: true, option1: true, option2: true, option3: true },
          }
        },
    });
    const prismaTime = Date.now() - prismaStart;

    // Merge variants and collections into allMatchedProducts for merchandising logic
    const collectionIdToTitle = {};
    allMatchedProducts.forEach(mp => {
       const dbp = dbProducts.find(p => p.id === mp.id);
       if (dbp) {
          mp.variants = dbp.variants;
          mp.collections = dbp.collections;
          if (dbp.collections) {
             dbp.collections.forEach(c => {
                if (c.collection && c.collection.title) {
                   collectionIdToTitle[c.collectionId] = c.collection.title;
                }
             });
          }
       }
    });

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

    // ── 7. Fetch Full Details for Paginated Products ───────────────────
    const startIndex = (page - 1) * limit;
    const paginatedIds = finalProducts
      .slice(startIndex, startIndex + limit)
      .map((p) => p.id);

    let products = [];
    if (paginatedIds.length > 0) {
      const fetchedProducts = await prisma.product.findMany({
        where: { id: { in: paginatedIds } },
        include: { variants: true },
      });

      // Restore exact sort order and attach merchandisingImage
      products = paginatedIds
        .map((id) => {
          const p = fetchedProducts.find((fp) => fp.id === id);
          if (p) {
            const matched = finalProducts.find((mp) => mp.id === id);
            if (matched && matched.merchandisingImage) {
              p.merchandisingImage = matched.merchandisingImage;
            }
          }
          return p;
        })
        .filter(Boolean);
    }

    const totalMs = Date.now() - startTime;

    return data({
      products,
      totalCount,
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
