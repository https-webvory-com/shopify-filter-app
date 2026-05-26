import { data } from "react-router";
import prisma from "../db.server";
import {
  getActiveRuleForCollection,
  applyMerchandisingRules,
  getActivePinningRuleForCollection,
} from "../services/merchandising.server";

/**
 * Storefront Filtering API
 * Computes dynamic facets (counts, options) and returns matched products.
 * Supports groupId to serve filter config for a specific FilterGroup.
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  // ── 0. Parse Query Parameters (needed for resolving group) ───────
  const collectionId = url.searchParams.get("collectionId");
  const collectionHandle = url.searchParams.get("collectionHandle");
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
  if (
    !resolvedCollectionId &&
    collectionHandle &&
    collectionHandle.toLowerCase() !== "all"
  ) {
    const coll = await prisma.collection.findFirst({
      where: { handle: collectionHandle, shop },
    });
    if (coll) {
      resolvedCollectionId = coll.id;
      resolvedCollectionTitle = coll.title;
    }
  } else if (resolvedCollectionId) {
    const coll = await prisma.collection.findUnique({
      where: { id: resolvedCollectionId },
    });
    if (coll) {
      resolvedCollectionTitle = coll.title;
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

  const vendors = url.searchParams.getAll("vendor[]");
  const types = url.searchParams.getAll("type[]");
  const collections = url.searchParams.getAll("collection[]");
  const tags = url.searchParams.getAll("tags[]");
  const availability = url.searchParams.getAll("availability[]");
  const titles = url.searchParams.getAll("title[]");

  const sortBy = url.searchParams.get("sortBy") || "created-descending";
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

  // ── 2. Fetch Active Pinning Rule Early ──────────────────────────────
  const activePinningRule = await getActivePinningRuleForCollection(
    shop,
    resolvedCollectionTitle,
  );
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

  // ── 3. Build Prisma Product Filter Clause ──────────────────────────
  const where = {
    shop,
    status: "active",
  };

  if (collections.length > 0) {
    where.collections = { some: { collectionId: { in: collections } } };
  } else if (collectionHandle && collectionHandle.toLowerCase() !== "all") {
    // Shopify's default "all" collection is special and may not be stored
    // as a normal collection relationship in the product sync data.
    where.collections = { some: { collection: { handle: collectionHandle } } };
  } else if (collectionId) {
    where.collections = { some: { collectionId } };
  }

  if (vendors.length > 0) {
    where.vendor = { in: vendors };
  }

  if (types.length > 0) {
    where.productType = { in: types };
  }

  if (tags.length > 0) {
    where.tags = { hasSome: tags };
  }

  if (titles.length > 0) {
    where.title = { in: titles };
  }

  if (isSearch && searchQuery) {
    where.OR = [
      { title: { contains: searchQuery, mode: "insensitive" } },
      { vendor: { contains: searchQuery, mode: "insensitive" } },
      { productType: { contains: searchQuery, mode: "insensitive" } },
    ];
  }

  // Build variant level filter (price, stock, size, color options)
  const variantConditions = [];

  // Price constraint
  variantConditions.push({
    price: { gte: minPrice, lte: maxPrice },
  });

  // Stock availability constraint
  if (availability.length > 0) {
    if (
      availability.includes("in_stock") &&
      !availability.includes("out_of_stock")
    ) {
      variantConditions.push({ available: true });
    } else if (
      availability.includes("out_of_stock") &&
      !availability.includes("in_stock")
    ) {
      variantConditions.push({ available: false });
    }
  }

  // Variant options constraints (Size, Color, etc.)
  Object.entries(optionsFilters).forEach(([optionName, values]) => {
    if (values.length > 0) {
      variantConditions.push({
        OR: [
          { option1: { in: values } },
          { option2: { in: values } },
          { option3: { in: values } },
        ],
      });
    }
  });

  if (variantConditions.length > 0) {
    where.variants = {
      some: {
        AND: variantConditions,
      },
    };
  }

  // Metafields constraints
  const metafieldConditions = [];
  Object.entries(metafieldsFilters).forEach(([metafieldKey, values]) => {
    if (values.length > 0 && metafieldKey.includes(".")) {
      const [namespace, key] = metafieldKey.split(".");
      metafieldConditions.push({
        metafields: {
          some: {
            namespace,
            key,
            value: { in: values },
          },
        },
      });
    }
  });

  if (metafieldConditions.length > 0) {
    where.AND = metafieldConditions;
  }

  // ── 3. Parse Sorting ─────────────────────────────────────
  let orderBy = {};
  switch (sortBy) {
    case "title-ascending":
      orderBy = { title: "asc" };
      break;
    case "title-descending":
      orderBy = { title: "desc" };
      break;
    case "price-ascending":
      orderBy = { priceMin: "asc" };
      break;
    case "price-descending":
      orderBy = { priceMax: "desc" };
      break;
    case "created-ascending":
      orderBy = { createdAt: "asc" };
      break;
    case "created-descending":
    default:
      orderBy = { createdAt: "desc" };
      break;
  }

  // ── 4. Fetch Active Merchandising Rules ────────────────────────────
  const activeRule = await getActiveRuleForCollection(
    shop,
    resolvedCollectionTitle,
  );
  // activePinningRule is already fetched above

  // ── 5. Execute Parallel Database Queries ───────────────────────────
  const [totalCount, allMatchedProducts] = await Promise.all([
    // Count of filtered products
    prisma.product.count({ where }),
    // Matched products with variants and metafields for facet computations and sorting
    prisma.product.findMany({
      where,
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
          select: {
            collectionId: true,
            collection: {
              select: {
                title: true,
              },
            },
          },
        },
        options: true,
        variants: {
          select: {
            available: true,
            price: true,
            compareAtPrice: true,
            inventory: true,
            option1: true,
            option2: true,
            option3: true,
            imageUrl: true,
          },
        },
        metafields: {
          select: {
            namespace: true,
            key: true,
            value: true,
          },
        },
      },
    }),
  ]);

  // ── 5. Compute Facets in Memory ────────────────────────────────────
  const vendorCounts = {};
  const typeCounts = {};
  const tagCounts = {};
  const titleCounts = {};
  const optionCounts = {}; // e.g. { "Size": { "S": 5, "M": 12 }, "Color": { "Red": 4 } }
  const metafieldCounts = {}; // e.g. { "custom.material": { "Cotton": 8 } }
  const collectionCounts = {};
  let inStockCount = 0;
  let outOfStockCount = 0;

  // Extract price ranges from the active group filter
  const priceFilter = activeGroupFilters
    ? activeGroupFilters.find(
        (f) => f.filterType === "price" || f.type === "price",
      )
    : null;
  let priceRangesConfig = [];
  if (priceFilter && priceFilter.config) {
    try {
      const configObj =
        typeof priceFilter.config === "string"
          ? JSON.parse(priceFilter.config)
          : priceFilter.config;
      priceRangesConfig = configObj.priceRanges || [];
    } catch (e) {}
  }
  const priceRangeCounts = priceRangesConfig.map((r) => ({ ...r, count: 0 }));

  allMatchedProducts.forEach((p) => {
    if (p.collections) {
      p.collections.forEach((pc) => {
        const id = pc.collectionId;
        const title = pc.collection?.title || id;
        if (!collectionCounts[id]) collectionCounts[id] = { title, count: 0 };
        collectionCounts[id].count += 1;
      });
    }
    // Vendor counts
    if (p.vendor) {
      vendorCounts[p.vendor] = (vendorCounts[p.vendor] || 0) + 1;
    }

    // Product Type counts
    if (p.productType) {
      typeCounts[p.productType] = (typeCounts[p.productType] || 0) + 1;
    }

    // Tag counts
    if (p.tags) {
      p.tags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }

    // Title counts
    if (p.title) {
      titleCounts[p.title] = (titleCounts[p.title] || 0) + 1;
    }

    // Option counts
    let optionsList = [];
    if (typeof p.options === "string") {
      try {
        optionsList = JSON.parse(p.options) || [];
      } catch (e) {}
    } else {
      optionsList = p.options || [];
    }
    p.variants.forEach((v) => {
      if (v.option1 && optionsList[0]) {
        const optName = optionsList[0].name;
        if (!optionCounts[optName]) optionCounts[optName] = {};
        optionCounts[optName][v.option1] =
          (optionCounts[optName][v.option1] || 0) + 1;
      }
      if (v.option2 && optionsList[1]) {
        const optName = optionsList[1].name;
        if (!optionCounts[optName]) optionCounts[optName] = {};
        optionCounts[optName][v.option2] =
          (optionCounts[optName][v.option2] || 0) + 1;
      }
      if (v.option3 && optionsList[2]) {
        const optName = optionsList[2].name;
        if (!optionCounts[optName]) optionCounts[optName] = {};
        optionCounts[optName][v.option3] =
          (optionCounts[optName][v.option3] || 0) + 1;
      }
    });

    // Metafield counts
    if (p.metafields) {
      p.metafields.forEach((m) => {
        const facetKey = `${m.namespace}.${m.key}`;
        if (!metafieldCounts[facetKey]) metafieldCounts[facetKey] = {};
        metafieldCounts[facetKey][m.value] =
          (metafieldCounts[facetKey][m.value] || 0) + 1;
      });
    }

    // Availability counts
    const hasInStock = p.variants.some((v) => v.available);
    if (hasInStock) {
      inStockCount++;
    } else {
      outOfStockCount++;
    }

    // Price range counts
    if (priceRangeCounts.length > 0 && p.variants.length > 0) {
      let minProductPrice = Infinity;
      p.variants.forEach((v) => {
        const vPrice = parseFloat(v.price || 0);
        if (vPrice < minProductPrice) minProductPrice = vPrice;
      });
      if (minProductPrice !== Infinity) {
        priceRangeCounts.forEach((r) => {
          const rMinVal = r.min !== undefined ? r.min : r.from;
          const rMin = parseFloat(rMinVal) || 0;
          const rMaxVal = r.max !== undefined ? r.max : r.to;
          const rMax =
            rMaxVal === "" || rMaxVal === null || rMaxVal === undefined
              ? Infinity
              : parseFloat(rMaxVal);
          if (minProductPrice >= rMin && minProductPrice <= rMax) {
            r.count += 1;
          }
        });
      }
    }
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
      priceRanges: priceRangeCounts,
    },
  });
};
