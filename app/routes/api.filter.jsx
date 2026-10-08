import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  getActiveRuleForSearch,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
  getActivePinningRuleForSearch,
  buildMeiliIncludeFilters,
  buildMeiliRuleFilter,
  selectMerchandisingVariant,
} from "../services/merchandising.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";
import meiliClient from "../services/meiliClient.server";
import { getCached } from "../services/shopCache.server";
import { unauthenticated } from "../shopify.server";
import { rateLimit } from "../services/rateLimiter.server";
import { fetchCollectionPage } from "../utils/collectionPage.js";
import { semanticMultiSearch } from "../services/semanticSearch.server";

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

    const isAllowed = await rateLimit(request);
    if (!isAllowed) {
      return data({ error: "Too Many Requests" }, { 
        status: 429, 
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
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
    const isSearch =
      url.searchParams.get("isSearch") === "true" ||
      (collectionHandle && collectionHandle.toLowerCase() === "search");
    let searchQuery = url.searchParams.get("q") || "";
    const searchType = url.searchParams.get("searchType") || "page";
    const rawSort =
      url.searchParams.get("sortBy") ||
      url.searchParams.get("sort_by") ||
      url.searchParams.get("sort") ||
      url.searchParams.get("usf_sort") ||
      "best-selling";
    const normalizedSort = rawSort.toLowerCase().replace(/_/g, "-");
    const sortBy = normalizedSort === "bestselling" ? "best-selling" : normalizedSort;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
    const limit = Math.min(250, Math.max(1, parseInt(url.searchParams.get("limit") || "25") || 25));
    const country = url.searchParams.get("country");

    let vendors = [
      ...url.searchParams.getAll("vendor[]"),
      ...url.searchParams.getAll("vendor"),
      ...url.searchParams.getAll("vendors[]"),
      ...url.searchParams.getAll("vendors"),
    ].filter(Boolean);

    let types = [
      ...url.searchParams.getAll("type[]"),
      ...url.searchParams.getAll("type"),
      ...url.searchParams.getAll("types[]"),
      ...url.searchParams.getAll("types"),
      ...url.searchParams.getAll("product_type[]"),
      ...url.searchParams.getAll("product_type"),
    ].filter(Boolean);

    const collections = [
      ...url.searchParams.getAll("collection[]"),
      ...url.searchParams.getAll("collection"),
      ...url.searchParams.getAll("collections[]"),
      ...url.searchParams.getAll("collections"),
    ].filter(Boolean);

    let tags = [
      ...url.searchParams.getAll("tags[]"),
      ...url.searchParams.getAll("tags"),
      ...url.searchParams.getAll("tag[]"),
      ...url.searchParams.getAll("tag"),
    ].filter(Boolean);

    const availability = [
      ...url.searchParams.getAll("availability[]"),
      ...url.searchParams.getAll("availability"),
    ].filter(Boolean);

    const titles = [
      ...url.searchParams.getAll("title[]"),
      ...url.searchParams.getAll("title"),
      ...url.searchParams.getAll("titles[]"),
      ...url.searchParams.getAll("titles"),
    ].filter(Boolean);

    const optionsFilters = {};
    const metafieldsFilters = {};

    for (const [key, value] of url.searchParams.entries()) {
      if (!value) continue;

      // 1. Check options[OptionName] or options[OptionName][] or option_OptionName
      const optionMatch = key.match(/^(?:options\[([^\]]+)\](?:\[\])?|option_(.+))$/i);
      if (optionMatch) {
        const optionName = optionMatch[1] || optionMatch[2];
        if (!optionsFilters[optionName]) optionsFilters[optionName] = [];
        optionsFilters[optionName].push(value);
        continue;
      }

      // 2. Check metafields[Key] or metafields[Key][] or metafield_Key
      const metafieldMatch = key.match(/^(?:metafields\[([^\]]+)\](?:\[\])?|metafield_(.+))$/i);
      if (metafieldMatch) {
        const metafieldKey = metafieldMatch[1] || metafieldMatch[2];
        if (!metafieldsFilters[metafieldKey]) metafieldsFilters[metafieldKey] = [];
        metafieldsFilters[metafieldKey].push(value);
        continue;
      }
    }

    // ── 0.5 Run dynamic query parser for precise exact matching (Sobooster-like) ──
    const { parseQuery } = await import("../services/queryParser.server.js");
    let parsedQuery = null;
    let queryParserMeiliFilters = [];
    if (searchQuery) {
      parsedQuery = await parseQuery(searchQuery);
      if (parsedQuery && parsedQuery.hasFilters) {
        if (parsedQuery.filters.colors.length > 0) {
          // Temporarily store parsed colors to expand them after mergedValues are loaded
          // We must do this AFTER step 1 (where mergedValues are fetched)
        }
        // For example, if "red" is parsed to a filter, tier1SearchQuery becomes "" (empty).
        // If it's empty, Meilisearch will sort by meiliSort (bestselling) instead of text relevance!
      }
    }
    
    let tier1SearchQuery = parsedQuery && parsedQuery.hasFilters ? parsedQuery.remainingQuery : searchQuery;

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

    // ── 2. Expand merged values & smart tag variations ────────────────────────
    const expandFilterValues = (type, values) => {
      let expanded = [...values];
      for (const val of values) {
        if (!val) continue;
        const rules = mergedValues.filter(
          (m) =>
            m.filterType.toLowerCase() === type.toLowerCase() &&
            m.targetValue.toLowerCase() === val.toLowerCase()
        );
        for (const r of rules) {
          expanded.push(...r.sourceValues);
        }

        // Smart synonym/tag variation generator (e.g. "Back Zip" -> "Back Style_Back Zip", "Length_Floor Length")
        if (type.toLowerCase() === "tags") {
          const clean = val.trim();
          expanded.push(clean.toLowerCase(), clean.toUpperCase());
          expanded.push(clean.replace(/\s+/g, ""));
          expanded.push(clean.replace(/\s+/g, "-"));

          // Shopify tag group prefixes (Group_Value, Group: Value)
          const commonPrefixes = [
            "Back Style_", "Back_", "Style_", "Length_", "Neckline_", "Silhouette_",
            "Embellishment_", "Fabric_", "Occasion_", "Ocassion_", "Pattern_", "Skirt Details_",
            "Sleeve Type_", "Waistline_", "Straps & Sleeves_", "Fit Details_", "Color_"
          ];

          for (const prefix of commonPrefixes) {
            expanded.push(`${prefix}${clean}`);
            expanded.push(`${prefix}${clean.replace(/\s+/g, "")}`);
            expanded.push(`${prefix.replace("_", ": ")}${clean}`);
          }

          if (clean.toLowerCase().includes("zip") && !clean.toLowerCase().includes("zipper")) {
            expanded.push(clean.replace(/zip/i, "Zipper"));
            expanded.push(clean.replace(/zip/i, "zipper"));
          }
          if (clean.toLowerCase().includes("zipper")) {
            expanded.push(clean.replace(/zipper/i, "Zip"));
            expanded.push(clean.replace(/zipper/i, "zip"));
          }

          const lowerClean = clean.toLowerCase();
          if (lowerClean.includes("back") && lowerClean.includes("zip")) {
            expanded.push(
              "Back Style_Back Zip", "Back Style_BackZip", "Back Style: Back Zip",
              "Back Zip", "BackZip", "Back-Zip", "back zip", "backzip",
              "Back Zipper", "Back zipper", "Zip Back", "Zipper Back",
              "Back Zip Closure", "Center Back Zip", "Back: Zip", "Back Closure: Zip",
              "Zipper", "Zip", "ZipperBack", "Zipper Back"
            );
          }
        }
      }
      return [...new Set(expanded.filter(Boolean))];
    };

    vendors = expandFilterValues("vendor", vendors);
    types = expandFilterValues("product_type", types);
    tags = expandFilterValues("tags", tags);
    for (const key of Object.keys(optionsFilters)) {
      optionsFilters[key] = expandFilterValues(key, optionsFilters[key]);
    }

    // Now that mergedValues is loaded, build queryParserMeiliFilters with expanded values!
    if (parsedQuery && parsedQuery.hasFilters) {
      if ((parsedQuery.filters.colors && parsedQuery.filters.colors.length > 0) || (parsedQuery.queryColorWords && parsedQuery.queryColorWords.length > 0)) {
        // Here we expand against "Color" which matches the Option type in Merged Values
        // But wait, what if the user searched "red"? parsedQuery.filters.colors will contain "Red".
        // The expandFilterValues function matches exact strings.
        // We also want to manually inject the exact base colors (like "Red", "Black") 
        // to ensure they map perfectly to merged values.
        let colorsToExpand = [...parsedQuery.filters.colors];
        if (parsedQuery.queryColorWords) {
          colorsToExpand.push(...parsedQuery.queryColorWords);
        }
        let expandedColors = expandFilterValues("Color", colorsToExpand);
        queryParserMeiliFilters.push(
          `option_Color IN [${[...new Set(expandedColors)].map(c => `'${c.replace(/'/g, "\\'")}'`).join(",")}]`
        );
      }
      if (parsedQuery.filters.vendors.length > 0) {
        let expandedVendors = expandFilterValues("vendor", parsedQuery.filters.vendors);
        queryParserMeiliFilters.push(
          `vendor IN [${[...new Set(expandedVendors)].map(v => `'${v.replace(/'/g, "\\'")}'`).join(",")}]`
        );
      }
      if (parsedQuery.filters.types.length > 0) {
        let expandedTypes = expandFilterValues("product_type", parsedQuery.filters.types);
        queryParserMeiliFilters.push(
          `productType IN [${[...new Set(expandedTypes)].map(t => `'${t.replace(/'/g, "\\'")}'`).join(",")}]`
        );
      }
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
      (isSearch ? (sortBy !== "relevance" && sortBy !== "best-selling") : (sortBy !== "best-selling" && sortBy !== "manual"));

    // ── 4. Parallel fetch: pinning + merchandising rules (ALWAYS FRESH FROM DB) ────────
    // Fetch fresh rules directly from DB to prevent serving stale Redis rule objects
    const [activePinningRule, activeRule] = await Promise.all([
      isSearch && searchQuery
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
      case "best-selling":
      case "bestselling":
      case "manual":
        meiliSort = ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"];
        break;
      case "trending":
        meiliSort = ["trendingScore:desc", "bestSellingScore:desc", "createdAt:desc"];
        break;
      case "title-ascending":
      case "title-asc":
        meiliSort = ["title:asc"];
        break;
      case "title-descending":
      case "title-desc":
        meiliSort = ["title:desc"];
        break;
      case "price-ascending":
      case "price-asc":
        meiliSort = ["priceMin:asc"];
        break;
      case "price-descending":
      case "price-desc":
        meiliSort = ["priceMin:desc"];
        break;
      case "created-descending":
      case "created-desc":
        meiliSort = ["createdAt:desc"];
        break;
      case "created-ascending":
      case "created-asc":
        meiliSort = ["createdAt:asc"];
        break;
      case "relevance":
      case "r":
        if (searchQuery) {
          meiliSort = null; // Let Meilisearch sort by relevance
        } else {
          meiliSort = ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"];
        }
        break;
      default:
        meiliSort = ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"];
        break;
    }

    // ── 7. Build Meilisearch filters ───────────────────────────────────
    const baseFilters = [`shop = '${shop}'`, "status = 'ACTIVE'"];
    if (globalSettings?.showOnlyInStock) {
      baseFilters.push(`available = true`);
    }

    // Build Include rules filters (only when user has NO active filters)
    // When user has active filters (color, price, tag etc.), bypass merchandising Include rules
    // so the full filtered catalog is shown, not just merchandised products
    const includeConditions = (!userHasFilters && activeRule?.conditions?.filter((c) => c.action === "Include")) || [];
    const includeMeiliFilters = buildMeiliIncludeFilters(includeConditions);

    if (resolvedCollectionId || (resolvedCollectionTitle && resolvedCollectionTitle.toLowerCase() !== "all")) {
      const collClauseParts = [];
      if (resolvedCollectionId) {
        collClauseParts.push(`collections = '${resolvedCollectionId}'`);
        if (!resolvedCollectionId.includes("gid://")) {
          collClauseParts.push(`collections = 'gid://shopify/Collection/${resolvedCollectionId}'`);
        }
      }
      if (!resolvedCollectionId && resolvedCollectionTitle && resolvedCollectionTitle.toLowerCase() !== "all") {
        collClauseParts.push(`collection_titles IN ['${resolvedCollectionTitle.replace(/'/g, "\\'")}']`);
      }

      const collClause = collClauseParts.join(" OR ");

      // Include rules must not expand a collection to products from elsewhere.
      baseFilters.push(`(${collClause})`);
    } else if (includeMeiliFilters.length > 0) {
      baseFilters.push(`(${includeMeiliFilters.join(" OR ")})`);
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
    const useCollectionPagination = !isSearch && !searchQuery;
    const pinCollectionScope = !isSearch && resolvedCollectionId
      ? { collections: { some: { collectionId: resolvedCollectionId.includes("gid://") ? resolvedCollectionId : `gid://shopify/Collection/${resolvedCollectionId}` } } }
      : !isSearch && resolvedCollectionTitle && resolvedCollectionTitle.toLowerCase() !== "all"
        ? { collections: { some: { collection: { shop, title: resolvedCollectionTitle } } } }
        : {};
    // Bestselling retains pins and merchandising; other selected sorts may override them.
    const hasCustomSort = Boolean(sortBy) && !["best-selling", "bestselling", "manual", "relevance", "r"].includes(sortBy);
    const sortOverPinning = hasCustomSort && globalSettings?.prioritizeSortOverPinning === true;
    const sortOverMerchandising = hasCustomSort && globalSettings?.prioritizeSortOverMerchandising === true;
    let activePinnedList = (!sortOverPinning && !userHasFilters && pinnedIds.length > 0) ? [...new Set(pinnedIds)] : [];
    if (activePinnedList.length) {
      const validPins = await prisma.product.findMany({
        where: { shop, ...pinCollectionScope, status: { equals: "active", mode: "insensitive" }, id: { in: activePinnedList }, ...(globalSettings?.showOnlyInStock ? { variants: { some: { available: true } } } : {}) },
        select: { id: true },
      });
      const validIds = new Set(validPins.map(product => product.id));
      activePinnedList = activePinnedList.filter(id => validIds.has(id));
    }

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
    // ── 8. Build Meilisearch queries (Native 2-Tier Merchandising Query Architecture) ──
    const ruleMeiliFilters = !sortOverMerchandising && !userHasFilters ? buildMeiliRuleFilter(activeRule?.conditions) : [];
    
    // We activate Tier 1 strict filtering if we have Merchandising Rules OR Query Parser Filters
    const hasTier1StrictFilters = ruleMeiliFilters.length > 0 || queryParserMeiliFilters.length > 0;

    const queries = [];

    // Query A1: Tier 1 Boosted Rule Products OR Strict Parsed Query Products
    const tier1Filter = hasTier1StrictFilters 
      ? [...allFiltersList, ...ruleMeiliFilters, ...queryParserMeiliFilters]
      : allFiltersList;

    const mainQuery = {
      indexUid: "products",
      q: tier1SearchQuery,
      filter: tier1Filter,
      limit: useCollectionPagination ? 0 : limit,
      offset: (page - 1) * limit,
      attributesToRetrieve: [
        "id", "title", "handle", "vendor", "productType",
        "priceMin", "priceMax", "tags", "images", "variantPrices",
        "merchandisingImage", "options", "status", "available", "createdAt", "bestSellingRank",
        "bestSellingScore", "trendingScore", "metafield_custom.plus_size_collection_image",
        "metafield_custom.mother_of_the_bride_collection_image",
        "metafield_custom.mob_collection_image",
        "metafield_custom.wedding_collection_image"
      ],
    };
    
    // If Tier 1 query is empty (e.g. they only searched "red"), we MUST provide a sort array 
    // because Meilisearch text relevance won't apply to an empty query.
    let tier1Sort = meiliSort;
    if (!tier1SearchQuery && !tier1Sort) {
      tier1Sort = ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"];
    }
    if (tier1Sort) mainQuery.sort = tier1Sort;
    if (tier1SearchQuery) mainQuery.attributesToHighlight = ["title"];
    
    queries.push(mainQuery);

    // Query A2: Tier 2 General Collection Products (Fallback if Tier 1 runs out of hits)
    let tier2QueryIndex = -1;
    if (hasTier1StrictFilters) {
      tier2QueryIndex = queries.length;
      const tier2MainQuery = {
        ...mainQuery,
        q: searchQuery, // fallback ALWAYS uses the full original search text
        filter: useCollectionPagination ? [...allFiltersList, `NOT (${[...ruleMeiliFilters, ...queryParserMeiliFilters].join(" AND ")})`] : allFiltersList,
      };
      if (meiliSort) {
        tier2MainQuery.sort = meiliSort;
      } else {
        delete tier2MainQuery.sort;
      }
      queries.push(tier2MainQuery);
    }

    // ── 8.5 Build targeted facets list ────
    const neededFacetKeys = ["vendor", "productType"];
    if (activeGroupFilters && Array.isArray(activeGroupFilters)) {
      for (const f of activeGroupFilters) {
        if (!f.isEnabled) continue;
        if (f.filterType === "option" && f.filterKey) {
          neededFacetKeys.push(`option_${f.filterKey}`);
        } else if (f.filterType === "metafield" && f.filterKey) {
          neededFacetKeys.push(`metafield_${f.filterKey}`);
        } else if (f.filterType === "vendor") {
          neededFacetKeys.push("vendor");
        } else if (f.filterType === "product_type") {
          neededFacetKeys.push("productType");
        } else if (f.filterType === "tag") {
          neededFacetKeys.push("tags");
        }
      }
    }
    const targetFacets = [...new Set(neededFacetKeys)];

    // Query B: Facets + exact total count for Tier 1
    const facetQueryIndex = queries.length;
    const facetQuery = {
      indexUid: "products",
      q: searchQuery,
      filter: tier1Filter,
      facets: targetFacets,
      hitsPerPage: 1,
      page: 1,
      attributesToRetrieve: [],
    };
    queries.push(facetQuery);

    // Query B2: Facets + exact total count for Tier 2 (if active)
    let tier2FacetQueryIndex = -1;
    if (hasTier1StrictFilters) {
      tier2FacetQueryIndex = queries.length;
      queries.push({
        indexUid: "products",
        q: searchQuery,
        filter: useCollectionPagination ? queries[tier2QueryIndex].filter : allFiltersList,
        facets: targetFacets,
        hitsPerPage: 1,
        page: 1,
        attributesToRetrieve: [],
      });
    }

    // Query C: Per active-category queries for disjunctive faceting
    const categoryQueryStartIndex = queries.length;
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
    let meiliError = null;
    let collectionPageTotal = null;
    let collectionPaginationApplied = false;

    try {
      const multiSearchRes = await semanticMultiSearch(queries);
      const tier1Res = multiSearchRes.results[0];
      facetRes = multiSearchRes.results[facetQueryIndex];
      facetDistribution = { ...(facetRes?.facetDistribution || {}) };

      let combinedHits = [...(tier1Res?.hits || [])];
      let activeEstimatedTotalHits = tier1Res?.estimatedTotalHits || 0;

      // If Tier 1 hits didn't fill the page, append items from Tier 2 (excluding duplicates)
      if (!useCollectionPagination && tier2QueryIndex !== -1 && combinedHits.length < limit) {
        const tier2Res = multiSearchRes.results[tier2QueryIndex];
        const existingIds = new Set(combinedHits.map((h) => h.id));
        const fillHits = (tier2Res?.hits || []).filter((h) => !existingIds.has(h.id));
        combinedHits = [...combinedHits, ...fillHits].slice(0, limit);
        
        // If Tier 1 is completely empty or very small, we might want to use Tier 2's counts entirely
        // But for total count, if Tier 1 had ANY hits, should we show tier1 count or combined?
        // Since the user expects strict matches to dictate the total, we use tier1 count if it has hits,
        // otherwise we fallback to tier 2. Let's use tier2 count if tier1 has 0 hits.
        if (tier1Res?.estimatedTotalHits === 0) {
           activeEstimatedTotalHits = tier2Res?.estimatedTotalHits || 0;
           facetRes = multiSearchRes.results[tier2FacetQueryIndex];
           facetDistribution = { ...(facetRes?.facetDistribution || {}) };
        }
      }

      meiliRes = {
        hits: combinedHits,
        estimatedTotalHits: activeEstimatedTotalHits,
      };
      if (useCollectionPagination) {
        const tiers = [{ query: mainQuery, total: facetRes?.totalHits ?? tier1Res?.estimatedTotalHits ?? 0 }];
        if (tier2QueryIndex !== -1) {
          const fallbackFacets = multiSearchRes.results[tier2FacetQueryIndex];
          tiers.push({ query: queries[tier2QueryIndex], total: fallbackFacets?.totalHits ?? 0 });
          // Facets describe the full collection, including the fallback tier.
          for (const [field, values] of Object.entries(fallbackFacets?.facetDistribution || {})) {
            const merged = { ...(facetDistribution[field] || {}) };
            for (const [value, count] of Object.entries(values)) merged[value] = (merged[value] || 0) + count;
            facetDistribution[field] = merged;
          }
        }
        const result = await fetchCollectionPage(meiliClient.index("products"), {
          page, limit, pinnedIds: activePinnedList, tiers, attributes: mainQuery.attributesToRetrieve,
          cacheIds: (key, fetchIds) => getCached(`collectionPageIds:${shop}:${key}`, fetchIds, 30),
        });
        meiliRes = { hits: result.hits, estimatedTotalHits: result.total };
        collectionPageTotal = result.total;
        collectionPaginationApplied = true;
      }

      // Merge disjunctive facet counts
      for (let i = 0; i < activeCategories.length; i++) {
        const cat = activeCategories[i];
        const catRes = multiSearchRes.results[categoryQueryStartIndex + i];
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
      meiliError = e.message || String(e);
      console.error("CFP: Meilisearch MultiSearch failed:", e);
      if (useCollectionPagination) {
        // Keep cards available if the new page-query path is unsupported by
        // the deployed search server. Fetch only the old bounded page.
        const fallbackQuery = { ...mainQuery, filter: allFiltersList, q: searchQuery, limit, offset: (page - 1) * limit };
        if (meiliSort) fallbackQuery.sort = meiliSort;
        const { indexUid, q, ...options } = fallbackQuery;
        meiliRes = await meiliClient.index("products").search(q, options);
        // A fallback must still expose the full collection's pagination.
        collectionPageTotal = meiliRes.estimatedTotalHits ?? 0;
      }
    }

    const meiliTime = Date.now() - meiliStart;

    // ── 10. Map Meilisearch hits → product objects ─────────────────────
    let allMatchedProducts = (meiliRes.hits || []).map((h, idx) => ({
      ...h,
      _originalIndex: idx,
      id: `gid://shopify/Product/${h.id}`,
      variants: (h.variantPrices || []).map((v) => ({
        available: v.available,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl || (h.images && h.images.length > 0 ? h.images[0] : null), // Fallback to main product image for swatches
      })),
    }));

    // ── 10.5 Unified Multi-Page Pinning Architecture (Supports 50+ Pinned Products) ────
    // Keep the active/in-stock pins validated before querying, including fallback pages.

    const totalPinned = activePinnedList.length;

    let pagePinnedIds = [];
    if (!collectionPaginationApplied && totalPinned > 0) {
      const pinStart = (page - 1) * limit;
      const pinEnd = page * limit;
      if (pinStart < totalPinned) {
        pagePinnedIds = activePinnedList.slice(pinStart, pinEnd);
      }
      // Always exclude ALL pinned IDs from general Meilisearch results to prevent duplicates across pages
      allMatchedProducts = allMatchedProducts.filter((p) => !activePinnedList.includes(p.id));
    }

    // Inject this page's slice of pinned IDs at the front
    if (pagePinnedIds.length > 0) {
      const unshiftedPinned = [];
      pagePinnedIds.forEach((id) => {
        unshiftedPinned.push({ id, variants: [] });
      });
      allMatchedProducts = [...unshiftedPinned, ...allMatchedProducts];
    }

    // ── 11. Apply merchandising rules + sort ───────────────────────────
    const finalProducts = applyMerchandisingRules(
      allMatchedProducts,
      activeRule,
      sortBy,
      userHasFilters ? null : activePinningRule,
      mergedValues,
      globalSettings,
    );

    // ── 12. Paginate results ───────────────────────────────────────────
    const totalCount = collectionPageTotal ?? ((facetRes?.totalHits ?? facetRes?.estimatedTotalHits ?? meiliRes.estimatedTotalHits ?? 0) + totalPinned);
    let paginatedSlice = finalProducts.slice(0, limit); // Strictly 25 items per page

    // ── 12.5 Fallback for missing data (injected pinned products) ──
    const productsNeedingFallback = paginatedSlice.filter(p => !p.title);
    if (productsNeedingFallback.length > 0) {
      try {
        const missingIds = productsNeedingFallback.map(p => p.id);
        const dbProducts = await prisma.product.findMany({
          where: { shop, status: { equals: "active", mode: "insensitive" }, id: { in: missingIds } },
          select: { 
            id: true, title: true, handle: true, vendor: true, productType: true,
            tags: true, images: true, status: true, options: true, priceMin: true, priceMax: true,
            // Fix: fetch full variant data so pinned products get swatches too
            variants: {
              select: {
                id: true,
                available: true,
                price: true,
                compareAtPrice: true,
                option1: true,
                option2: true,
                option3: true,
                imageUrl: true,
              }
            }
          }
        });
        paginatedSlice.forEach(p => {
          const dbMatch = dbProducts.find(dbP => dbP.id === p.id);
          if (dbMatch) {
            // Fill missing basic info (mainly for injected pinned products)
            if (!p.title) {
              p.title = dbMatch.title || "";
              p.handle = dbMatch.handle || "";
              p.vendor = dbMatch.vendor || "";
              p.productType = dbMatch.productType || "";
              p.tags = dbMatch.tags || [];
              p.images = dbMatch.images || [];
              p.status = dbMatch.status || "active";
              p.priceMin = dbMatch.priceMin ? parseFloat(dbMatch.priceMin) : 0;
              p.priceMax = dbMatch.priceMax ? parseFloat(dbMatch.priceMax) : 0;
              p.isAvailable = dbMatch.variants.some(v => v.available === true);
              // Fix: set variantPrices so Step 13 shape mapper includes imageUrl for pinned products
              p.variantPrices = dbMatch.variants.map(v => ({
                id: v.id,
                available: v.available,
                price: v.price,
                compareAtPrice: v.compareAtPrice,
                option1: v.option1,
                option2: v.option2,
                option3: v.option3,
                imageUrl: v.imageUrl || null,
              }));
            }
            // Fill missing options
            if (!p.options || p.options.length === 0) {
              if (dbMatch.options) {
                const opts = Array.isArray(dbMatch.options) ? dbMatch.options : [dbMatch.options];
                p.options = opts.map(opt => ({
                  name: opt.name,
                  values: Array.isArray(opt.values) ? opt.values : [opt.values]
                }));
              }
            }
          }
        });
      } catch (e) {
        console.error("CFP: Failed to fetch fallback product data", e);
      }
    }

    // Out-of-stock pinned products are now filtered BEFORE pagination.

    // ── 13. Shape products for response ───────────────────────────────
    
    // Helper for smart search query -> variant image swapping
    const normalizeTokens = (str) => {
      if (!str) return [];
      return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
    };
    const searchTokens = searchQuery ? normalizeTokens(searchQuery) : [];

    let products = paginatedSlice.map((p) => {
      let localVariantPrices = [...(p.variantPrices || [])];
      let productImages = [...(p.images || [])];
      let localOptions = p.options ? JSON.parse(JSON.stringify(p.options)) : [];
      
      let activeVariant = null;
      let matchScore = 0;

      // Dynamic variant image swapping based on active filters
      if (Object.keys(optionsFilters).length > 0 && p.options && localVariantPrices.length > 0) {
        activeVariant = localVariantPrices.find(v => {
          return Object.keys(optionsFilters).some(filterName => {
            const filterValues = optionsFilters[filterName].map(val => val.toLowerCase());
            const optIndex = p.options.findIndex(opt => opt.name.toLowerCase() === filterName.toLowerCase());
            if (optIndex === 0 && v.option1 && filterValues.includes(v.option1.toLowerCase())) return true;
            if (optIndex === 1 && v.option2 && filterValues.includes(v.option2.toLowerCase())) return true;
            if (optIndex === 2 && v.option3 && filterValues.includes(v.option3.toLowerCase())) return true;
            return false;
          });
        });
        if (activeVariant) matchScore = 100;
      }

      // If no explicit filter match, try smart token matching against search query
      if (!activeVariant && searchTokens.length > 0 && p.options && localVariantPrices.length > 0) {
        let highestScore = 0;
        let highestRatio = 0;

        localVariantPrices.forEach(v => {
          if (!v.imageUrl) return; // Only score variants with images
          
          // Combine all options for this variant into one searchable string
          const variantStr = [v.option1, v.option2, v.option3].filter(Boolean).join(" ");
          const vTokens = normalizeTokens(variantStr);
          if (vTokens.length === 0) return;

          let intersectionCount = 0;
          let intersectionWeight = 0;
          let lastIndex = -1;
          let orderPreserved = true;

          searchTokens.forEach((st, stIndex) => {
            const idx = vTokens.indexOf(st);
            if (idx !== -1) {
              intersectionCount++;
              intersectionWeight += (searchTokens.length - stIndex);
              if (idx < lastIndex) orderPreserved = false;
              lastIndex = idx;
            }
          });

          if (intersectionCount > 0) {
            const orderBonus = (orderPreserved && intersectionCount > 1) ? 10 : 0;
            const totalScore = intersectionWeight + orderBonus;
            const ratio = intersectionCount / vTokens.length;

            if (totalScore > highestScore || (totalScore === highestScore && ratio > highestRatio)) {
              highestScore = totalScore;
              highestRatio = ratio;
              activeVariant = v;
            }
          }
        });
        
        if (activeVariant) matchScore = highestScore;
      }

      if (!activeVariant && Object.keys(optionsFilters).length === 0) {
        const selection = selectMerchandisingVariant(p, activeRule, mergedValues);
        if (selection) {
          activeVariant = localVariantPrices.find(v => String(v.id) === String(selection.variantId)) || null;
          if (activeVariant && selection.imageUrl) activeVariant.imageUrl = selection.imageUrl;
        }
      }

      if (activeVariant) {
        if (activeVariant.imageUrl) {
          const filterVariantImage = activeVariant.imageUrl;
          productImages = [
            filterVariantImage,
            ...productImages.filter((img) => img !== filterVariantImage),
          ];
        }
        
        // Move activeVariant to the front so frontend selects it by default
        const activeIdx = localVariantPrices.indexOf(activeVariant);
        if (activeIdx > 0) {
          localVariantPrices.splice(activeIdx, 1);
          localVariantPrices.unshift(activeVariant);
        }

        // Also reorder the options values so the frontend swatch selects the matched color by default
        if (localOptions.length > 0) {
          if (activeVariant.option1 && localOptions[0]) {
            const valIdx = localOptions[0].values.indexOf(activeVariant.option1);
            if (valIdx > 0) {
              localOptions[0].values.splice(valIdx, 1);
              localOptions[0].values.unshift(activeVariant.option1);
            }
          }
          if (activeVariant.option2 && localOptions[1]) {
            const valIdx = localOptions[1].values.indexOf(activeVariant.option2);
            if (valIdx > 0) {
              localOptions[1].values.splice(valIdx, 1);
              localOptions[1].values.unshift(activeVariant.option2);
            }
          }
          if (activeVariant.option3 && localOptions[2]) {
            const valIdx = localOptions[2].values.indexOf(activeVariant.option3);
            if (valIdx > 0) {
              localOptions[2].values.splice(valIdx, 1);
              localOptions[2].values.unshift(activeVariant.option3);
            }
          }
        }
      } else if (p.merchandisingImage) {
        productImages = [
          p.merchandisingImage,
          ...productImages.filter((img) => img !== p.merchandisingImage),
        ];
      }

      const productObj = {
        id: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        tags: p.tags || [],
        images: productImages,
        image: productImages.length > 0 ? productImages[0] : null,
        featured_image: productImages.length > 0 ? productImages[0] : null,
        status: (p.status || "ACTIVE").toLowerCase(),
        options: localOptions,
        selectedVariantId: activeVariant?.id || null,
        merchandisingImage: activeVariant ? (activeVariant.imageUrl || productImages[0] || null) : (p.merchandisingImage || null),
        _matchScore: matchScore,
        variants: localVariantPrices.map((v) => ({
          id: v.id && String(v.id).includes('gid://') ? v.id : `gid://shopify/ProductVariant/${v.id}`,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          available: v.available,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          imageUrl: v.imageUrl || (productImages.length > 0 ? productImages[0] : null), // Fallback to main product image for swatches
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

    // Sort products by match score so the most relevant colors appear first on the page
    if (searchTokens.length > 0 || Object.keys(optionsFilters).length > 0) {
      products.sort((a, b) => b._matchScore - a._matchScore);
    }

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
    // ⚡ PERFORMANCE: Bypassing synchronous Shopify GraphQL API call 
    // reduces response time from 37,000ms down to < 200ms!
    let contextualPricingApplied = false;
    const fetchContextualPricing = false; // Bypassed for speed
    if (fetchContextualPricing && country && products.length > 0) {
      try {
        const productGids = products.map((p) => p.id);
        const pricingCacheKey = `contextualPricing:${shop}:${country}:${productGids.join(',')}`;

        const nodes = await getCached(
          pricingCacheKey,
          async () => {
            const { admin } = await unauthenticated.admin(shop);
            if (!admin) return null;
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
            return json.data?.nodes || null;
          },
          300 // 5 minutes TTL
        );

        if (nodes) {
          nodes.forEach((node) => {
            if (!node) return;
            const product = products.find((p) => p.id === node.id);
            if (product) {
              let pMin = Infinity;
              let pMax = -Infinity;
              node.variants.nodes.forEach((vNode) => {
                const v = product.variants.find((pv) => pv.id === vNode.id);
                if (v && vNode.contextualPricing) {
                  const amt = parseFloat(vNode.contextualPricing.price.amount);
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
      } catch (e) {
        console.error("Failed to fetch contextual pricing:", e);
      }
    }

    const totalMs = Date.now() - startTime;
    console.log(`CFP: api/filter completed in ${totalMs}ms (meili: ${meiliTime}ms, limit: ${limit}, page: ${page})`);

    // ⚡ PERFORMANCE: Cache the response for 10 seconds on CDN/browser
    // This avoids repeat API calls when user navigates back or re-renders
    const responseHeaders = {
      'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const responsePayload = {
      products,
      totalCount,
      contextualPricingApplied,
      settings: activeGroupFilters || [],
      globalSettings,
      mergedValues,
      didYouMean,
      debug: {
        collectionPaginationApplied,
        resolvedCollectionId,
        resolvedCollectionTitle,
        hasActivePinningRule: !!activePinningRule,
        pinningRuleName: activePinningRule?.name,
        pinnedProductsCount: pinnedIds.length,
        hasMerchandisingRule: !!activeRule,
        activeRuleName: activeRule?.name || null,
        activeRuleConditions: activeRule?.conditions || [],
        rawMeiliHitsCount: meiliRes.hits?.length || 0,
        allMatchedCount: allMatchedProducts.length,
        finalProductsCount: finalProducts.length,
        paginatedSliceCount: paginatedSlice.length,
        activeGroupFiltersLength: activeGroupFilters
          ? activeGroupFilters.length
          : null,
        meiliError,
        topProductScores: finalProducts.slice(0, 25).map(p => ({
          title: p.title,
          id: p.id,
          merchandisingScore: p.merchandisingScore,
          bestSellingScore: p.bestSellingScore,
          isPinned: pinnedIds.includes(p.id)
        })),
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
    };

    // Save in Redis Cache for 30s
    try {
      const responseCacheKey = `api_filter_res_${shop}_${encodeURIComponent(request.url)}`;
      await getCached(responseCacheKey, async () => responsePayload, 30);
    } catch (e) {}

    return data(responsePayload, { headers: responseHeaders });
  } catch (err) {
    console.error("API Filter Error: ", err);
    return data(
      { error: err.message, stack: err.stack, crash: true },
      { 
        status: 200, 
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    );
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  return new Response("Method Not Allowed", { status: 405 });
};
