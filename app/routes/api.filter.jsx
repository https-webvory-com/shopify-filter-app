import { selectSearchColorVariant } from "../utils/searchColor.js";
import { spellingCorrection } from "../utils/spellingCorrection.js";
import { availableProductIds, matchingAvailableVariants, ensureVariantEligibilityFilter } from "../utils/availableVariants.js";
import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  getActiveRuleForSearch,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
  getActivePinningRuleForSearch,
  buildMeiliIncludeFilters,
  buildIncludeWhereClause,
  buildMeiliRuleFilter,
  selectMerchandisingVariant,
  createMerchandisingComparator,
} from "../services/merchandising.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";
import meiliClient from "../services/meiliClient.server";
import { getCached } from "../services/shopCache.server";
import { unauthenticated } from "../shopify.server";
import { rateLimit } from "../services/rateLimiter.server";
import { getCollectionBestSellingState } from "../services/collectionBestSelling.server.js";
import { fetchCollectionPage } from "../utils/collectionPage.js";
import { readRankedCollectionPage, hydrateCollectionSkus } from "../utils/rankedCollectionPage.js";
import { getCollectionPreparationRevision, getPreparedCollectionRanking, discardPreparedCollectionRanking, registerCollectionWarmup, registerCollectionCardVisit, getCollectionHeadVersion, reportCollectionHead, rememberCollectionHead, compareCollectionHead } from "../services/collectionPreparation.server.js";
import { collectionRankingFingerprint, getCollectionRankingSession, saveCollectionRankingSession } from "../services/collectionRankingSession.server.js";
import { semanticMultiSearch } from "../services/semanticSearch.server";
import { rankSearchResults } from "../services/searchRanking.server.js";
import {isPublicCollectionCards,collectionCardsResponse,collectionPageFingerprint,acceptsCollectionPinnedPrefix} from '../utils/collectionCards.js';
import {getPreparedCollectionCards,beginPreparedCollectionCards} from '../services/collectionCards.server.js';
import {prepareCollectionPinnedPrefix} from '../utils/collectionPinnedPrefix.js';

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
export const loader = async ({ request, context }) => {
  const startTime = Date.now();
  let preparedSpec;
  let preparedCacheKey;
  let collectionResponse;
  let responsePageFingerprint;
  let responsePreviewFingerprint;
  let getResponsePageFingerprint;
  let cardSnapshot;
  let pinnedPrefix=false;
  let pinnedPrefixVersion;
  console.log("API Filter Request: ", request.url);
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return data({ error: "Missing shop parameter" }, { status: 400 });
    }

    const isAllowed = context?.rankingWarmup === true || await rateLimit(request);
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
    if((!context?.rankingWarmup||context?.rankingCardsPrecompute===true)&&(isPublicCollectionCards(request)||(request.headers.get('accept')||'').includes('application/x-cfp-published-page-v1'))){
      // Trusted background rendering can reuse validated cards, but must never
      // create a shopper's browsing session while probing readiness.
      const ready=await getPreparedCollectionCards(request,{probe:context?.rankingWarmup===true,onHit:registerCollectionCardVisit});
      if(ready)return ready;
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
      (isSearch ? "relevance" : "best-selling");
    const normalizedSort = rawSort.toLowerCase().replace(/_/g, "-");
    const sortBy = normalizedSort === "bestselling" ? "best-selling" : normalizedSort;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
    const limit = Math.min(250, Math.max(1, parseInt(url.searchParams.get("limit") || "25") || 25));
    const country = url.searchParams.get("country");
    // Capture before reading cached configuration, so a concurrent admin save
    // cannot publish a sequence built from a mixture of configuration versions.
    const preparationRevision = !isSearch && !searchQuery && sortBy !== "manual"
      ? await getCollectionPreparationRevision(shop) : null;

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
      parsedQuery = await parseQuery(searchQuery, shop);
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
          let resolvedCollectionHandle=collectionHandle||'';

          // Resolve collection handle → id/title
          if (collectionHandle) {
            if (collectionHandle.toLowerCase() === "all") {
              resolvedCollectionTitle = "all";
            } else {
              const coll = await prisma.collection.findFirst({
                where: { handle: collectionHandle, shop },
                select: { id: true, title: true,handle:true },
              });
              if (coll) {
                resolvedCollectionId = coll.id;
                resolvedCollectionTitle = coll.title;
                resolvedCollectionHandle=coll.handle||resolvedCollectionHandle;
              }
            }
          }

          if (!resolvedCollectionTitle && resolvedCollectionId) {
            const formattedId = resolvedCollectionId.includes("gid://")
              ? resolvedCollectionId
              : `gid://shopify/Collection/${resolvedCollectionId}`;
            const coll = await prisma.collection.findUnique({
              where: { id: formattedId },
              select: { id: true, title: true,handle:true },
            });
            if (coll) {
              resolvedCollectionTitle = coll.title;
              resolvedCollectionId = coll.id;
              resolvedCollectionHandle=coll.handle||resolvedCollectionHandle;
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

          return { resolvedCollectionId, resolvedCollectionTitle,resolvedCollectionHandle, activeGroupFilters };
        }
      ),
    ]);

    const { resolvedCollectionId, resolvedCollectionTitle, activeGroupFilters } =
      resolvedGroup;

    // Stable bootstrap data has its own browser validator and never waits for
    // rankings, facets or product hydration. Updated clients request it in parallel.
    if (url.searchParams.get('responseProfile') === 'collection-config-v1') {
      const {configurationResponse} = await import('../utils/collectionBootstrap.js');
      const {isPublicCollectionResponse} = await import('../utils/collectionResponse.js');
      if (!isPublicCollectionResponse(request) || isSearch || searchQuery || sortBy === 'manual')
        return data({error:'Invalid collection configuration context'}, {status:400,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
      if (await getCollectionPreparationRevision(shop) !== preparationRevision)
        return data({error:'Collection configuration changed; retry'}, {status:409,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
      return configurationResponse(request,{settings:activeGroupFilters || [],mergedValues,globalSettings});
    }

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
      maxPrice < 9999999;

    // ── 4. Parallel fetch: pinning + merchandising rules (ALWAYS FRESH FROM DB) ────────
    // Fetch fresh rules directly from DB to prevent serving stale Redis rule objects
    const [activePinningRule, activeRule] = await Promise.all([
      isSearch && searchQuery
        ? getActivePinningRuleForSearch(shop, searchQuery, searchType)
        : getActivePinningRuleForCollection(shop, resolvedCollectionTitle, resolvedCollectionId),

      isSearch && searchQuery
        ? getActiveRuleForSearch(shop, searchQuery, currentCustomerTags, url.searchParams.get("locale") || url.searchParams.get("language") || "")
        : getActiveRuleForCollection(shop, resolvedCollectionTitle, currentCustomerTags, url.searchParams.get("locale") || url.searchParams.get("language") || "", resolvedCollectionId),
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
    const hideUnavailable = globalSettings?.hideUnavailableVariantsWhenSelected === true && userHasFilters;
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

      // Include adds eligible products without changing Shopify membership.
      // Tenant, publication/status, availability and customer filters remain ANDed.
      baseFilters.push(`(${[collClause, ...includeMeiliFilters].join(" OR ")})`);
    } else if (includeMeiliFilters.length > 0) {
      baseFilters.push(`(${includeMeiliFilters.join(" OR ")})`);
    }
    const selectedPriceRange = minPrice > 0 || maxPrice < 9999999
      ? { min: Math.max(0, minPrice - 0.5), max: maxPrice + 0.5 } : null;
    if (hideUnavailable) {
      await getCached('variantEligibilityFilter:' + shop, async () => {
        await ensureVariantEligibilityFilter(meiliClient.index('products'), meiliClient.tasks);
        return true;
      }, 60);
      const scope = resolvedCollectionId ? { collections: { some: { collectionId: resolvedCollectionId.includes('gid://') ? resolvedCollectionId : 'gid://shopify/Collection/' + resolvedCollectionId } } } : {};
      const eligible = await getCached('availableVariants:' + shop + ':' + JSON.stringify([scope, optionsFilters, mergedValues]),
        () => availableProductIds(prisma.product, {shop, status: {equals: 'active', mode: 'insensitive'}, ...scope}, optionsFilters, mergedValues), 30);
      baseFilters.push(eligible.length ? 'id IN [' + eligible.map(id => JSON.stringify(id)).join(',') + ']' : 'id = "__no_available_variant__"');
    }
    const categoryFilters = {};
    if (minPrice > 0 || maxPrice < 9999999) {
      const bufferedMin = Math.max(0, minPrice - 0.5);
      const bufferedMax = maxPrice + 0.5;
      if (hideUnavailable) {
        const scope = resolvedCollectionId ? { collections: { some: { collectionId: resolvedCollectionId.includes('gid://') ? resolvedCollectionId : 'gid://shopify/Collection/' + resolvedCollectionId } } } : {};
        const eligible = await getCached('availableVariantPrices:' + shop + ':' + JSON.stringify([scope, optionsFilters, mergedValues, selectedPriceRange]),
          () => availableProductIds(prisma.product, {shop, status: {equals: 'active', mode: 'insensitive'}, ...scope}, optionsFilters, mergedValues, selectedPriceRange), 30);
        // Keep this in the price category so disjunctive price facets can remove it.
        categoryFilters["priceMin"] = eligible.length ? 'id IN [' + eligible.map(id => JSON.stringify(id)).join(',') + ']' : 'id = "__no_available_variant_price__"';
      } else {
        categoryFilters["priceMin"] = `priceMin >= ${bufferedMin} AND priceMin <= ${bufferedMax}`;
      }
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

    const allFiltersList = [...baseFilters, ...Object.values(categoryFilters), ...(parsedQuery?.colorFilter ? [parsedQuery.colorFilter] : [])];
    const activeCategories = Object.keys(categoryFilters);
    const useCollectionPagination = !isSearch && !searchQuery;
    const useRankedCollectionPagination = useCollectionPagination && sortBy !== "manual";
    const cardsOnly=useRankedCollectionPagination&&isPublicCollectionCards(request);
    // Bestselling retains pins and merchandising; other selected sorts may override them.
    const hasCustomSort = Boolean(sortBy) && !["best-selling", "bestselling", "manual", "relevance", "r"].includes(sortBy);
    const sortOverPinning = hasCustomSort && globalSettings?.prioritizeSortOverPinning === true;
    const sortOverMerchandising = hasCustomSort && globalSettings?.prioritizeSortOverMerchandising === true;
    let activePinnedList = (!sortOverPinning && !userHasFilters && pinnedIds.length > 0) ? [...new Set(pinnedIds)] : [];
    if (activePinnedList.length) {
      let pinCollectionScope = {};
      // Imported collection pins position eligible products; they do not grant
      // membership for Include-driven lists. Collections without Include rules,
      // legacy/manual pin rules and search retain their existing contract.
      if (useCollectionPagination && resolvedCollectionId && includeConditions.length && activePinningRule?.collectionSortKey) {
        let targets;
        try { targets = JSON.parse(activePinningRule.collectionSortKey); } catch { /* Legacy key. */ }
        if (Array.isArray(targets) && targets.length) {
          const collectionId = `gid://shopify/Collection/${String(resolvedCollectionId).split('/').pop()}`;
          const includeScope = buildIncludeWhereClause(includeConditions);
          pinCollectionScope = { OR: [{ collections: { some: { collectionId } } }, ...(includeScope?.OR || [])] };
        }
      }
      const validPins = await prisma.product.findMany({
        where: { shop, status: { equals: "active", mode: "insensitive" }, id: { in: activePinnedList }, ...pinCollectionScope, ...(globalSettings?.showOnlyInStock ? { variants: { some: { available: true } } } : {}) },
        select: parsedQuery?.colorIntent?.requested.length ? { id: true, options: true, variants: true } : { id: true },
      });
      const validIds = new Set(validPins.filter(product => {
        if (!parsedQuery?.colorIntent?.requested.length) return true;
        const variant = selectSearchColorVariant(product, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
        return variant && (!globalSettings?.showOnlyInStock || variant.available !== false);
      }).map(product => product.id));
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
    // Always request catalog-wide price statistics. Without this facet an
    // unfiltered slider falls back to prices from just the current page,
    // then jumps to different bounds when the disjunctive price query runs.
    const neededFacetKeys = ["vendor", "productType", "priceMin"];
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
      ...(useRankedCollectionPagination ? {limit:0} : {hitsPerPage:1,page:1}),
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
        ...(useRankedCollectionPagination ? {limit:0} : {hitsPerPage:1,page:1}),
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
    let collectionRankingStatus = "inactive";
    if (useRankedCollectionPagination && !context?.rankingWarmup) {
      registerCollectionWarmup(shop, request.url, resolvedCollectionId)
        .catch(error => console.error('CFP: Could not register collection warmup:', error.name));
    }
    let meiliRes = { hits: [], estimatedTotalHits: 0 };
    let facetDistribution = {};
    let facetRes = null;
    let meiliError = null;
    let collectionPageTotal = null;
    let collectionPaginationApplied = false;
    let collectionBestSellingApplied = false;
    let collectionRankingApplied = false;
    let searchRankingApplied = false;
    let searchRankingMode = null;
    const rankingFingerprint = collectionRankingFingerprint(request.url);
    let rankingSession = useRankedCollectionPagination
      ? await getCollectionRankingSession(shop, rankingFingerprint, url.searchParams.get("rankingToken")) : null;
    const needsShopifyOrder = useRankedCollectionPagination && resolvedCollectionId && ["best-selling", "bestselling"].includes(sortBy);
    const collectionBestSellingState = needsShopifyOrder && rankingSession
      ? { ids: rankingSession.ids, status: "ready", updatedAt: rankingSession.updatedAt }
      : needsShopifyOrder
      ? await getCollectionBestSellingState(shop, resolvedCollectionId, { warmup: context?.rankingWarmup === true }) : { ids: null, status: "inactive" };
    const collectionBestSellingIds = collectionBestSellingState.ids;
    const canPreviewPins=cardsOnly&&url.searchParams.get('responseProfile')==='collection-preview-v1'&&acceptsCollectionPinnedPrefix(request)&&!context?.rankingWarmup&&activePinnedList.length>0;
    const missingNativeOrder=needsShopifyOrder&&!Array.isArray(collectionBestSellingIds);
    // Age alone must not block browsing. A complete last-good Shopify snapshot
    // remains the ranking source while its durable refresh runs in the worker.
    if (missingNativeOrder&&!canPreviewPins) {
      const orderStatus = collectionBestSellingState.status === "stale"
        ? collectionBestSellingState.refreshState === "failed" ? "failed" : "pending"
        : collectionBestSellingState.status;
      return data({ products: [], totalCount: 0, debug: {
        collectionBestSellingApplied: false,
        collectionBestSellingStatus: orderStatus,
        collectionBestSellingRefreshState: collectionBestSellingState.refreshState,
        collectionBestSellingPending: orderStatus === "pending",
      } }, { status: orderStatus === "failed" ? 503 : 202,
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    }

    // A warmup only needs to schedule/refresh the complete ranking. Pending
    // visitors also need no facet queries until that ranking is usable.
    if (useRankedCollectionPagination && !rankingSession) {
      preparedSpec = {
        pinEligibilityVersion: 2,
        shop, collectionId: resolvedCollectionId, revision: preparationRevision, sortBy, needsShopifyOrder,
        retainForIdle: !userHasFilters && !customerTagsStr && !searchQuery,
        query: { ...mainQuery, filter: allFiltersList, q: searchQuery },
        pinnedIds: activePinnedList, orderedIds: collectionBestSellingIds,
        orderRevision: collectionBestSellingState.revision ?? null,
        orderUpdatedAt: collectionBestSellingState.updatedAt ?? null,
        // Filters suppress missing-pin injection through activePinnedList, but
        // native best-selling keeps the order of matching configured pins.
        rule: activeRule, pinningRule: userHasFilters && !needsShopifyOrder ? null : activePinningRule,
        globalSettings, mergedValues,
      };
      let prepared;
      try{prepared = missingNativeOrder?{status:'pending'}:await getPreparedCollectionRanking(preparedSpec, {
        warmup: context?.rankingWarmup === true,
        precompute: context?.rankingPrecompute === true,
        deferDirect:canPreviewPins,
      });}catch(error){if(!canPreviewPins)throw error;prepared={status:'pending'};reportCollectionHead(preparedSpec,'background-unavailable',error.name);}
      if(canPreviewPins&&prepared.status!=='ready')try{
        let declineReason;
        const version=await getCollectionHeadVersion(preparedSpec);
        const prefix=await prepareCollectionPinnedPrefix(preparedSpec,{index:meiliClient.index('products'),batchOwner:meiliClient,prisma,arrange:applyMerchandisingRules,comparator:createMerchandisingComparator,onDecline:reason=>declineReason=reason});
        if(prefix&&version&&await getCollectionHeadVersion(preparedSpec)===version){prepared={...prefix,status:'ready'};pinnedPrefix=true;pinnedPrefixVersion=version;}
        else reportCollectionHead(preparedSpec,'declined',!version?'unproven-input-version':!prefix?declineReason||'unproven-pin-prefix':'inputs-changed');
      }catch{reportCollectionHead(preparedSpec,'declined','proof-unavailable');}
      else if(prepared.status==='pending'&&cardsOnly&&!context?.rankingWarmup)reportCollectionHead(preparedSpec,'declined',!acceptsCollectionPinnedPrefix(request)?'client-protocol-not-supported':activePinnedList.length===0?'insufficient-eligible-pins':'unsupported-head-profile');
      preparedCacheKey = prepared.cacheKey;
      collectionRankingStatus = prepared.status;
      if(prepared.status==='ready'&&!pinnedPrefix&&!context?.rankingWarmup&&typeof compareCollectionHead==='function')await compareCollectionHead(preparedSpec,prepared);
      if (prepared.status !== 'ready') {
        return data({ products: [], totalCount: 0, debug: {
          collectionRankingStatus: prepared.status,
          collectionBestSellingStatus: prepared.status,
          collectionOrderSnapshotStatus: collectionBestSellingState.status,
          collectionBestSellingApplied: false,
        } }, { status: prepared.status === 'failed' ? 503 : 202,
          headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Retry-After': '1' } });
      }
      if (context?.rankingWarmup&&!context?.rankingCardsPrecompute) return data({ warmup: true });
      const updatedAt=prepared.cacheKey?prepared.orderUpdatedAt:collectionBestSellingState.updatedAt??null;
      rankingSession = pinnedPrefix?{ids:prepared.ids,metadata:prepared.metadata,updatedAt,token:null}:context?.rankingCardsPrecompute?
        {ids:prepared.ids,metadata:prepared.metadata,updatedAt,token:'background-cards'}:
        await saveCollectionRankingSession(shop, rankingFingerprint, prepared.ids, updatedAt, prepared.metadata);
    }
    if(cardsOnly&&preparedSpec&&!pinnedPrefix&&(limit!==50||context?.rankingCardsPrecompute===true))cardSnapshot=await beginPreparedCollectionCards({request,spec:preparedSpec,preparedKey:preparedCacheKey,rankingSession,attributes:mainQuery.attributesToRetrieve,collectionHandle:resolvedGroup.resolvedCollectionHandle||collectionHandle,startedAt:startTime});

    // Only updated collection clients opt into the lossless transport. Ranking
    // readiness and the immutable browsing session are established before reuse.
    if (['collection-v1','collection-v2'].includes(url.searchParams.get('responseProfile')) && useRankedCollectionPagination && !context?.rankingWarmup) {
      const {beginCollectionResponse, collectionPageFingerprint} = await import('../services/collectionResponse.server.js');
      getResponsePageFingerprint = collectionPageFingerprint;
      collectionResponse = await beginCollectionResponse({request, shop, configurationRevision: preparationRevision, rankingToken: rankingSession.token,
        validate: async fingerprint => {
          const current = await readRankedCollectionPage(meiliClient.index('products'), {ids:rankingSession.ids,page,limit,shop,batchOwner:meiliClient,attributes:mainQuery.attributesToRetrieve});
          return collectionPageFingerprint(current.hits) === fingerprint;
        }});
      if (collectionResponse.response) return collectionResponse.response;
    }

    // Ranked search owns its counts, facets and page retrieval. Do not run a
    // second ordinary search whose products would immediately be discarded.
    const needsRankedSearch = isSearch && searchQuery && !userHasFilters && (activeRule || activePinningRule);
    if(cardsOnly){
      const result=await readRankedCollectionPage(meiliClient.index('products'),{
        ids:rankingSession.ids,page,limit:pinnedPrefix?rankingSession.ids.length:limit,shop,batchOwner:meiliClient,attributes:mainQuery.attributesToRetrieve,
      });
      responsePageFingerprint=collectionPageFingerprint(result.hits);
      responsePreviewFingerprint=collectionPageFingerprint(result.hits.slice(0,5));
      meiliRes={hits:result.hits,estimatedTotalHits:result.total};collectionPageTotal=result.total;
      collectionRankingApplied=true;collectionRankingStatus='ready';collectionPaginationApplied=true;
      collectionBestSellingApplied=Array.isArray(collectionBestSellingIds);
    }
    if (!needsRankedSearch&&(!cardsOnly||context?.rankingCardsPrecompute===true&&limit===50)) {
    try {
      // The immutable sequence already owns product order and exact totals.
      // Skip ordinary product searches whose hits would be discarded, and do
      // not force exhaustive hit-count ranking merely to obtain facets.
      const queryIndexes=queries.map((_,i)=>i).filter(i=>!useRankedCollectionPagination || (i!==0&&i!==tier2QueryIndex));
      const [multiSearchRes,rankedPage] = await Promise.all([
        semanticMultiSearch(queryIndexes.map(i=>queries[i])),
        useRankedCollectionPagination?readRankedCollectionPage(meiliClient.index('products'),{
          ids:rankingSession.ids,page,limit,shop,batchOwner:meiliClient,attributes:mainQuery.attributesToRetrieve,
        }):null,
      ]);
      if(useRankedCollectionPagination){
        const selected=multiSearchRes.results;multiSearchRes.results=queries.map(()=>({hits:[],estimatedTotalHits:0}));
        queryIndexes.forEach((index,i)=>{multiSearchRes.results[index]=selected[i];});
      }
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
        let result;
        if (useRankedCollectionPagination) {
          collectionRankingStatus = 'ready';
          result = rankedPage;
          if(cardsOnly){responsePageFingerprint=collectionPageFingerprint(result.hits);responsePreviewFingerprint=collectionPageFingerprint(result.hits.slice(0,5));}
          if (collectionResponse) responsePageFingerprint = getResponsePageFingerprint(result.hits);
          collectionRankingApplied = true;
        } else {
          result = await fetchCollectionPage(meiliClient.index("products"), {
            page, limit, pinnedIds: activePinnedList, tiers, attributes: mainQuery.attributesToRetrieve, orderedIds: collectionBestSellingIds,
            cacheIds: (key, fetchIds) => getCached(`collectionPageIds:${shop}:${key}`, fetchIds, 30),
          });
        }
        meiliRes = { hits: result.hits, estimatedTotalHits: result.total };
        collectionPageTotal = result.total;
        collectionPaginationApplied = true;
        collectionBestSellingApplied = Array.isArray(collectionBestSellingIds);
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
      if (useRankedCollectionPagination) throw e;
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

    }
    if (needsRankedSearch) {
      const result = await rankSearchResults({ shop, query: searchQuery,
        options: { filter: allFiltersList, ...(meiliSort ? { sort: meiliSort } : {}), sortBy },
        rule: activeRule, pinningRule: activePinningRule, parsedQuery, globalSettings, mergedValues, page, limit, facetKeys: targetFacets });
      meiliRes = { hits: result.products.map(p => ({ ...p, id: String(p.id).split('/').pop(), variantPrices: p.variants })), estimatedTotalHits: result.total };
      collectionPageTotal = result.total;
      facetDistribution = result.facetDistribution;
      facetRes = { ...(facetRes || {}), totalHits: result.total, facetDistribution, facetStats: result.facetStats };
      searchRankingApplied = true;
      searchRankingMode = result.rankingMode || 'compatible';
    }
    const meiliTime = Date.now() - meiliStart;

    // ── 10. Map Meilisearch hits → product objects ─────────────────────
    let allMatchedProducts = (meiliRes.hits || []).map((h, idx) => ({
      ...h,
      ...(rankingSession?.metadata?.[String(h.id).split('/').pop()] || {}),
      merchandisingScore: rankingSession?.metadata?.[String(h.id).split('/').pop()]?.merchandisingScore ?? h.merchandisingScore ?? 0,
      _originalIndex: idx,
      id: `gid://shopify/Product/${h.id}`,
      variants: (h.variantPrices || []).map((v) => ({
        id: v.id,
        sku: v.sku,
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

    if (!collectionRankingApplied && activeRule?.conditions?.some(c => c.field === "SKU")) await hydrateCollectionSkus(allMatchedProducts, prisma.variant, shop);
    const totalPinned = activePinnedList.length;

    let pagePinnedIds = [];
    if (!collectionPaginationApplied && !searchRankingApplied && totalPinned > 0) {
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
    const finalProducts = collectionRankingApplied || searchRankingApplied ? allMatchedProducts : applyMerchandisingRules(
      allMatchedProducts,
      activeRule,
      sortBy,
      userHasFilters ? null : activePinningRule,
      mergedValues,
      { ...globalSettings, preserveCollectionBestSellingOrder: collectionBestSellingApplied },
    );

    // ── 12. Paginate results ───────────────────────────────────────────
    const totalCount = collectionPageTotal ?? ((facetRes?.totalHits ?? facetRes?.estimatedTotalHits ?? meiliRes.estimatedTotalHits ?? 0) + totalPinned);
    let paginatedSlice = finalProducts.slice(0, pinnedPrefix?rankingSession.ids.length:limit); // Strictly 25 items per page

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
        if (collectionRankingApplied) throw e;
      }
    }

    if (collectionRankingApplied && paginatedSlice.some(p => !p.title || (p.status && p.status.toLowerCase() !== 'active'))) {
      throw new Error('Collection ranking session expired; product eligibility changed');
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
      let localVariantPrices = hideUnavailable ? matchingAvailableVariants({...p, variants: p.variantPrices || []}, optionsFilters, mergedValues, selectedPriceRange) : [...(p.variantPrices || [])];
      let productImages = [...(p.images || [])];
      let localOptions = p.options ? JSON.parse(JSON.stringify(p.options)) : [];
      if (hideUnavailable) {
        localOptions = localOptions.map((option, index) => ({
          ...option,
          values: (option.values || []).filter(value => localVariantPrices.some(variant =>
            String(variant[`option${index + 1}`] || '').toLowerCase() === String(value).toLowerCase())),
        }));
      }
      
      let activeVariant = parsedQuery?.colorIntent?.requested.length
        ? selectSearchColorVariant({ ...p, variants: undefined, variantPrices: localVariantPrices.filter(v =>
            Object.entries(optionsFilters).every(([name, values]) => {
              const index = localOptions.findIndex(option => option.name.toLowerCase() === name.toLowerCase());
              return index < 0 || values.some(value => String(value).toLowerCase() === String(v[`option${index + 1}`] || '').toLowerCase());
            })) }, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested) : null;
      if (activeVariant) {
        const index = localVariantPrices.findIndex(v => String(v.id) === String(activeVariant.id));
        if (index >= 0) localVariantPrices[index] = activeVariant;
      }
      let matchScore = 0;

      // Dynamic variant image swapping based on active filters
      if (!activeVariant && Object.keys(optionsFilters).length > 0 && p.options && localVariantPrices.length > 0) {
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

      if (activeVariant?.searchColor) {
        productImages = activeVariant.imageUrl ? [activeVariant.imageUrl] : [];
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
        searchColor: activeVariant?.searchColor || null,
        searchColorImage: activeVariant?.searchColor ? activeVariant.imageUrl : null,
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
    if (!collectionRankingApplied && !searchRankingApplied && (searchTokens.length > 0 || Object.keys(optionsFilters).length > 0)) {
      products.sort((a, b) => b._matchScore - a._matchScore);
    }

    // ── 14. Did-you-mean suggestion ────────────────────────────────────
    const didYouMean = spellingCorrection(searchQuery, meiliRes.hits, meiliRes.semanticHitCount);

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
      'Cache-Control': useRankedCollectionPagination ? 'no-store' : 'public, max-age=10, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const responsePayload = {
      rankingToken: rankingSession?.token ?? null,
      products,
      totalCount:pinnedPrefix?null:totalCount,
      ...(pinnedPrefix?{collectionPinnedPrefix:true}:{}),
      contextualPricingApplied,
      settings: activeGroupFilters || [],
      globalSettings,
      mergedValues,
      didYouMean,
      debug: {
        collectionPaginationApplied,
        collectionRankingApplied,
        collectionRankingStatus:pinnedPrefix?'prefix-ready':collectionRankingStatus,
        collectionBestSellingApplied,
        collectionBestSellingPending: collectionBestSellingState.status === "pending",
        collectionBestSellingStatus:pinnedPrefix?'prefix-ready':collectionBestSellingState.status,
        collectionBestSellingRefreshState: collectionBestSellingState.refreshState ?? null,
        collectionBestSellingUpdatedAt: collectionBestSellingState.updatedAt ?? null,
        resolvedCollectionId,
        resolvedCollectionTitle,
        hasActivePinningRule: !!activePinningRule,
        searchRankingApplied,
        searchRankingMode,
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

    if(cardsOnly){
      if(pinnedPrefix){
        if(await getCollectionHeadVersion(preparedSpec)!==pinnedPrefixVersion)return data({products:[],totalCount:0,debug:{collectionRankingStatus:'pending'}},{status:202,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Retry-After':'1'}});
        if(!await rememberCollectionHead(preparedSpec,pinnedPrefixVersion,rankingSession.ids))return data({products:[],totalCount:0,debug:{collectionRankingStatus:'pending'}},{status:202,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Retry-After':'1'}});
        responsePayload.collectionPinnedPrefix={version:2,inputVersion:pinnedPrefixVersion};reportCollectionHead(preparedSpec,'proven','explicit-paid-pins');
      }
      const stored=await cardSnapshot?.finish(responsePayload,responsePageFingerprint,responsePreviewFingerprint);
      return collectionCardsResponse(responsePayload,pinnedPrefix?'prefix':stored?'stored':'miss',request,{previewLimit:limit});
    }
    return collectionResponse ? await collectionResponse.finish(responsePayload, responsePageFingerprint) : data(responsePayload, { headers: responseHeaders });
  } catch (err) {
    if (preparedSpec && /Collection ranking session expired/.test(err.message)) {
      try { await discardPreparedCollectionRanking(preparedSpec, preparedCacheKey); }
      catch (error) { console.error('CFP: Failed to discard obsolete preparation:',error.name); }
    }
    console.error("API Filter Error: ", err);
    return data(
      { error: err.message, stack: err.stack, crash: true },
      { 
        status: /Collection ranking session expired|Invalid collection ranking token/.test(err.message) ? 409 : 503,
        headers: {
          'Cache-Control': 'no-store',
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
