import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
  getActivePinningRuleForSearch,
  buildIncludeWhereClause,
} from "../services/merchandising.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";

/**
 * Storefront Filtering API
 * Computes dynamic facets (counts, options) and returns matched products.
 * Supports groupId to serve filter config for a specific FilterGroup.
 */
export const loader = async ({ request }) => {
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
    const searchQuery = url.searchParams.get("q");
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
        activePinningRule = await getActivePinningRuleForSearch(shop, searchQuery);
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

    const activeRule = await getActiveRuleForCollection(
      shop,
      resolvedCollectionTitle,
      currentCustomerTags
    );

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
        { vendor: { contains: searchQuery, mode: "insensitive" } },
        { productType: { contains: searchQuery, mode: "insensitive" } },
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
    switch (sortBy) {
      case "title-ascending": orderBy = { title: "asc" }; break;
      case "title-descending": orderBy = { title: "desc" }; break;
      case "price-ascending": orderBy = { priceMin: "asc" }; break;
      case "price-descending": orderBy = { priceMin: "desc" }; break;
      case "created-ascending": orderBy = { createdAt: "asc" }; break;
      case "created-descending": default: orderBy = { createdAt: "desc" }; break;
    }

    // 🚚 5. Execute Base Database Query & Smart In-Memory Filtering 🚚
    const baseProducts = await prisma.product.findMany({
      where: baseWhere,
      select: {
        id: true,
        createdAt: true,
        priceMin: true,
        priceMax: true,
        vendor: true,
        productType: true,
        tags: true,
        title: true,
        collections: {
          select: { collectionId: true, collection: { select: { title: true } } },
        },
        options: true,
        variants: {
          select: {
            available: true, price: true, compareAtPrice: true, inventory: true,
            option1: true, option2: true, option3: true, imageUrl: true,
          },
        },
        metafields: { select: { namespace: true, key: true, value: true } },
      },
    });

    const matchesFilters = (product, excludeFacetGroup = null) => {
      if (excludeFacetGroup !== 'vendor' && vendors.length > 0) {
         if (!vendors.includes(product.vendor)) return false;
      }
      if (excludeFacetGroup !== 'productType' && types.length > 0) {
         if (!types.includes(product.productType)) return false;
      }
      if (excludeFacetGroup !== 'tag' && tags.length > 0) {
         if (!tags.some(t => product.tags && (product.tags.includes(t) || product.tags.some(pt => pt.endsWith('_' + t))))) return false;
      }
      if (excludeFacetGroup !== 'title' && titles.length > 0) {
         if (!titles.includes(product.title)) return false;
      }
      
      let matchingVariants = product.variants || [];
      if (excludeFacetGroup !== 'price') {
          matchingVariants = matchingVariants.filter(v => {
              const p = parseFloat(v.price || 0);
              return p >= minPrice && p <= maxPrice;
          });
      }
      if (excludeFacetGroup !== 'availability' && availability.length > 0) {
          if (availability.includes("in_stock") && !availability.includes("out_of_stock")) {
              matchingVariants = matchingVariants.filter(v => v.available);
          } else if (availability.includes("out_of_stock") && !availability.includes("in_stock")) {
              matchingVariants = matchingVariants.filter(v => !v.available);
          }
      } else if (excludeFacetGroup !== 'availability') {
          const hasAnyFilterSelected = vendors.length > 0 || types.length > 0 || collections.length > 0 || tags.length > 0 || titles.length > 0 || Object.values(optionsFilters).some(v => v.length > 0) || Object.values(metafieldsFilters).some(v => v.length > 0) || (minPrice > 0 || maxPrice < 9999);
          if (globalSettings && globalSettings.hideUnavailableVariantsWhenSelected && hasAnyFilterSelected) {
              matchingVariants = matchingVariants.filter(v => v.available);
          }
      }
      
      for (const [optionName, values] of Object.entries(optionsFilters)) {
          if (excludeFacetGroup === `option:${optionName}`) continue;
          if (values.length > 0) {
              matchingVariants = matchingVariants.filter(v => 
                  values.includes(v.option1) || values.includes(v.option2) || values.includes(v.option3)
              );
          }
      }
      
      if (matchingVariants.length === 0) return false;
      
      for (const [metafieldKey, values] of Object.entries(metafieldsFilters)) {
          if (excludeFacetGroup === `metafield:${metafieldKey}`) continue;
          if (values.length > 0 && metafieldKey.includes(".")) {
              const [namespace, key] = metafieldKey.split(".");
              const hasMetafield = product.metafields && product.metafields.some(m => m.namespace === namespace && m.key === key && values.includes(m.value));
              if (!hasMetafield) return false;
          }
      }
      return true;
    };

    const allMatchedProducts = baseProducts.filter(p => matchesFilters(p, null));
    const totalCount = allMatchedProducts.length;

    // ── 5. Compute Smart Facets in Memory ────────────────────────────────────
    const vendorCounts = {};
    const typeCounts = {};
    const tagCounts = {};
    const titleCounts = {};
    const optionCounts = {};
    const metafieldCounts = {};
    const collectionCounts = {};
    let inStockCount = 0;
    let outOfStockCount = 0;

    const priceFilter = activeGroupFilters ? activeGroupFilters.find((f) => f.filterType === "price" || f.type === "price") : null;
    let priceRangesConfig = [];
    if (priceFilter && priceFilter.config) {
      try {
        const configObj = typeof priceFilter.config === "string" ? JSON.parse(priceFilter.config) : priceFilter.config;
        priceRangesConfig = configObj.priceRanges || [];
      } catch (e) {}
    }
    const priceRangeCounts = priceRangesConfig.map((r) => ({ ...r, count: 0 }));

    // Helper to process facets safely
    const processFacetsForGroup = (excludeGroup, processor) => {
       const filteredProducts = excludeGroup === null ? allMatchedProducts : baseProducts.filter(p => matchesFilters(p, excludeGroup));
       filteredProducts.forEach(processor);
    };

    const getTargetValue = (type, rawValue) => {
        const rule = mergedValues.find(
            m => m.filterType.toLowerCase() === type.toLowerCase() && 
                 m.sourceValues.some(sv => sv.toLowerCase() === rawValue.toLowerCase())
        );
        return rule ? rule.targetValue : rawValue;
    };

    // 1. Collections
    processFacetsForGroup(null, (p) => {
       if (p.collections) {
         p.collections.forEach((pc) => {
           const id = pc.collectionId;
           const title = pc.collection?.title || id;
           if (!collectionCounts[id]) collectionCounts[id] = { title, count: 0 };
           collectionCounts[id].count += 1;
         });
       }
    });

    // 2. Vendors
    processFacetsForGroup('vendor', (p) => {
       if (p.vendor) {
           const tv = getTargetValue("vendor", p.vendor);
           vendorCounts[tv] = (vendorCounts[tv] || 0) + 1;
       }
    });

    // 3. Product Types
    processFacetsForGroup('productType', (p) => {
       if (p.productType) {
           const tv = getTargetValue("product_type", p.productType);
           typeCounts[tv] = (typeCounts[tv] || 0) + 1;
       }
    });

    // 4. Tags
    processFacetsForGroup('tag', (p) => {
       if (p.tags) {
         p.tags.forEach((tag) => {
             const tv = getTargetValue("tags", tag);
             tagCounts[tv] = (tagCounts[tv] || 0) + 1;
         });
       }
    });

    // 5. Titles
    processFacetsForGroup('title', (p) => {
       if (p.title) titleCounts[p.title] = (titleCounts[p.title] || 0) + 1;
    });

    // 6. Availability
    processFacetsForGroup('availability', (p) => {
       const hasInStock = p.variants.some((v) => v.available);
       if (hasInStock) inStockCount++; else outOfStockCount++;
    });

    // 7. Price Ranges
    let absoluteMinPrice = Infinity;
    let absoluteMaxPrice = -Infinity;
    
    processFacetsForGroup('price', (p) => {
       if (p.variants.length > 0) {
         let minProductPrice = Infinity;
         let maxProductPrice = -Infinity;
         
         p.variants.forEach((v) => {
           const vPrice = parseFloat(v.price || 0);
           if (vPrice < minProductPrice) minProductPrice = vPrice;
           if (vPrice > maxProductPrice) maxProductPrice = vPrice;
         });
         
         if (minProductPrice !== Infinity) {
           if (minProductPrice < absoluteMinPrice) absoluteMinPrice = minProductPrice;
           if (maxProductPrice > absoluteMaxPrice) absoluteMaxPrice = maxProductPrice;
           
           if (priceRangeCounts.length > 0) {
             priceRangeCounts.forEach((r) => {
               const rMin = parseFloat(r.min !== undefined ? r.min : r.from) || 0;
               const rMaxVal = r.max !== undefined ? r.max : r.to;
               const rMax = (rMaxVal === "" || rMaxVal === null || rMaxVal === undefined) ? Infinity : parseFloat(rMaxVal);
               if (minProductPrice >= rMin && minProductPrice <= rMax) r.count += 1;
             });
           }
         }
       }
    });

    // 8. Options
    const activeOptionNames = activeGroupFilters ? activeGroupFilters.filter(f => f.filterType === 'option' || f.type === 'option').map(f => f.filterKey || f.key) : [];
    Object.keys(optionsFilters).forEach(k => { if(!activeOptionNames.includes(k)) activeOptionNames.push(k); });
    
    activeOptionNames.forEach(optName => {
        if (!optionCounts[optName]) optionCounts[optName] = {};
        processFacetsForGroup(`option:${optName}`, (p) => {
            let optionsList = [];
            if (typeof p.options === "string") {
              try { optionsList = JSON.parse(p.options) || []; } catch (e) {}
            } else { optionsList = p.options || []; }
            
            p.variants.forEach((v) => {
              if (v.option1 && optionsList[0] && optionsList[0].name === optName) {
                  const tv = getTargetValue(optName, v.option1);
                  optionCounts[optName][tv] = (optionCounts[optName][tv] || 0) + 1;
              }
              if (v.option2 && optionsList[1] && optionsList[1].name === optName) {
                  const tv = getTargetValue(optName, v.option2);
                  optionCounts[optName][tv] = (optionCounts[optName][tv] || 0) + 1;
              }
              if (v.option3 && optionsList[2] && optionsList[2].name === optName) {
                  const tv = getTargetValue(optName, v.option3);
                  optionCounts[optName][tv] = (optionCounts[optName][tv] || 0) + 1;
              }
            });
        });
    });

    // 9. Metafields
    const activeMetafieldNames = activeGroupFilters ? activeGroupFilters.filter(f => f.filterType === 'metafield' || f.type === 'metafield').map(f => f.filterKey || f.key) : [];
    Object.keys(metafieldsFilters).forEach(k => { if(!activeMetafieldNames.includes(k)) activeMetafieldNames.push(k); });

    activeMetafieldNames.forEach(metaKey => {
        if (!metafieldCounts[metaKey]) metafieldCounts[metaKey] = {};
        processFacetsForGroup(`metafield:${metaKey}`, (p) => {
            if (p.metafields) {
               p.metafields.forEach((m) => {
                 const facetKey = `${m.namespace}.${m.key}`;
                 if (facetKey === metaKey) {
                    metafieldCounts[facetKey][m.value] = (metafieldCounts[facetKey][m.value] || 0) + 1;
                 }
               });
            }
        });
    });

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
      },
      facets: {
        vendors: Object.entries(vendorCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => a.value.localeCompare(b.value)),
        productTypes: Object.entries(typeCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => a.value.localeCompare(b.value)),
        tags: Object.entries(tagCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => a.value.localeCompare(b.value)),
        titles: Object.entries(titleCounts)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => a.value.localeCompare(b.value)),
        options: Object.entries(optionCounts).reduce((acc, [name, valuesMap]) => {
          acc[name] = Object.entries(valuesMap)
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => a.value.localeCompare(b.value));
          return acc;
        }, {}),
        collections: Object.entries(collectionCounts)
          .map(([value, item]) => ({
            value,
            label: item.title,
            count: item.count,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        metafields: Object.entries(metafieldCounts).reduce(
          (acc, [key, valuesMap]) => {
            acc[key] = Object.entries(valuesMap)
              .map(([value, count]) => ({ value, count }))
              .sort((a, b) => a.value.localeCompare(b.value));
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
