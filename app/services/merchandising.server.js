import prisma from "../db.server";

/**
 * Fetches the active merchandising rule for a given shop and collection.
 */
export async function getActiveRuleForCollection(shop, collectionTitle, currentCustomerTags = []) {
  if (!shop || !collectionTitle) return null;

  const now = new Date();

  const rules = await prisma.merchandisingRule.findMany({
    where: {
      shop,
      status: true,
      AND: [
        {
          OR: [
            { collections: { has: collectionTitle } },
            { collections: { equals: [] } }
          ]
        },
        {
          OR: [{ startDate: null }, { startDate: { lte: now } }]
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: now } }]
        }
      ]
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  for (const rule of rules) {
    if (!rule.customerTags || rule.customerTags.trim() === "") {
      return rule; // Rule applies to everyone
    }

    // Rule has specific customer tags, check if currentCustomerTags intersect
    const requiredTags = rule.customerTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const userTags = currentCustomerTags.map(t => t.trim().toLowerCase());

    const hasMatchingTag = requiredTags.some(tag => userTags.includes(tag));
    if (hasMatchingTag) {
      return rule;
    }
  }

  return null;
}

/**
 * Fetches the active merchandising rule for a given shop and search query.
 */
export async function getActiveRuleForSearch(shop, searchQuery, currentCustomerTags = []) {
  if (!shop || !searchQuery) return null;

  const now = new Date();

  // Find rules where ruleType is 'search'
  const rules = await prisma.merchandisingRule.findMany({
    where: {
      shop,
      status: true,
      ruleType: "search",
      AND: [
        {
          OR: [{ startDate: null }, { startDate: { lte: now } }]
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: now } }]
        }
      ]
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  const queryLower = searchQuery.toLowerCase();

  for (const rule of rules) {
    if (!rule.searchQueries || rule.searchQueries.length === 0) continue;
    
    // Check if any of the search queries match the user's query
    if (rule.searchQueries.some(q => q.toLowerCase() === queryLower)) {
      if (!rule.customerTags || rule.customerTags.trim() === "") {
        return rule; // Rule applies to everyone
      }

      // Rule has specific customer tags, check if currentCustomerTags intersect
      const requiredTags = rule.customerTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const userTags = currentCustomerTags.map(t => t.trim().toLowerCase());

      const hasMatchingTag = requiredTags.some(tag => userTags.includes(tag));
      if (hasMatchingTag) {
        return rule;
      }
    }
  }

  return null;
}

/**
 * Fetches the active pinning rule for a given shop and collection.
 */
export async function getActivePinningRuleForCollection(shop, collectionTitle) {
  if (!shop || !collectionTitle) return null;

  if (collectionTitle === "all") {
    return await prisma.pinnedProductRule.findFirst({
      where: {
        shop,
        status: true,
        applyToAll: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // Find a specific rule for this collection (do not fallback to applyToAll)
  const specificRule = await prisma.pinnedProductRule.findFirst({
    where: {
      shop,
      status: true,
      ruleType: "collection",
      collections: { has: collectionTitle },
    },
    orderBy: { createdAt: "desc" },
  });

  return specificRule;
}

export async function getActivePinningRuleForSearch(shop, searchQuery, searchType = "page") {
  if (!shop || !searchQuery) return null;

  const activeRules = await prisma.pinnedProductRule.findMany({
    where: {
      shop,
      status: true,
      ruleType: "search",
    },
    orderBy: { createdAt: "desc" },
  });

  const queryLower = searchQuery.toLowerCase();

  for (const rule of activeRules) {
    if (!rule.searchQueries || rule.searchQueries.length === 0) continue;
    
    // Check if the rule applies to this type of search (instant vs page)
    if (rule.applyToSearchType !== "both" && rule.applyToSearchType !== searchType) {
      continue;
    }

    if (rule.searchQueries.some(q => q.toLowerCase() === queryLower)) {
      return rule;
    }
  }

  return null;
}

/**
 * Helper to check if a product matches a rule condition.
 */
function checkRuleMatch(product, condition) {
  const field = condition.field || "";

  // Handle Min/Max Range conditions
  if (
    ["Price", "Discount", "Percent sales", "Available", "Rating"].includes(
      field,
    )
  ) {
    const min =
      condition.minValue && condition.minValue !== ""
        ? parseFloat(condition.minValue)
        : -Infinity;
    const max =
      condition.maxValue && condition.maxValue !== ""
        ? parseFloat(condition.maxValue)
        : Infinity;

    if (field === "Price") {
      const minPrice = parseFloat(product.priceMin || 0);
      return minPrice >= min && minPrice <= max;
    }

    if (field === "Available") {
      const inventory = product.variants
        ? product.variants.reduce((sum, v) => sum + (v.inventory || 0), 0)
        : 0;
      return inventory >= min && inventory <= max;
    }

    if (field === "Discount") {
      if (!product.variants) return false;
      const discount = product.variants.reduce((maxDisc, v) => {
        const p = parseFloat(v.price || 0);
        const cp = parseFloat(v.compareAtPrice || 0);
        const d = cp > p ? cp - p : 0;
        return d > maxDisc ? d : maxDisc;
      }, 0);
      return discount >= min && discount <= max;
    }

    if (field === "Percent sales") {
      if (!product.variants) return false;
      const pct = product.variants.reduce((maxPct, v) => {
        const p = parseFloat(v.price || 0);
        const cp = parseFloat(v.compareAtPrice || 0);
        const pt = cp > p ? ((cp - p) / cp) * 100 : 0;
        return pt > maxPct ? pt : maxPct;
      }, 0);
      return pct >= min && pct <= max;
    }

    return false;
  }

  // Handle Exact/Comma-separated values
  const valueString = condition.value || "";
  const values = valueString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (field === "Vendor") return values.includes(product.vendor);
  if (field === "Product type") return values.includes(product.productType);
  if (field === "Tags")
    return product.tags && values.some((v) => product.tags.includes(v));
  if (field === "Product") return values.includes(product.title);
  if (field === "Collections") {
    return (
      product.collections &&
      product.collections.some(
        (c) => c.collection && values.includes(c.collection.title),
      )
    );
  }

  if (
    field === "Title (product option)" ||
    field === "Color (product option)" ||
    field === "Size (product option)" ||
    field.includes("(product option)")
  ) {
    return (
      product.variants &&
      product.variants.find(
        (v) =>
          values.includes(v.option1) ||
          values.includes(v.option2) ||
          values.includes(v.option3),
      )
    );
  }

  return false;
}

/**
 * Applies merchandising rules and pinning rules to an array of products and returns the sorted array.
 */
export function applyMerchandisingRules(products, rule, sortBy, pinningRule) {
  let filteredProducts = products;

  // Parse pinned product IDs early so we can protect them from being excluded
  let pinnedIds = [];
  if (pinningRule && pinningRule.products) {
    try {
      const parsedPins =
        typeof pinningRule.products === "string"
          ? JSON.parse(pinningRule.products)
          : pinningRule.products;
      if (Array.isArray(parsedPins)) {
        pinnedIds = parsedPins.map((p) => p.id);
      }
    } catch (e) {console.error("Error parsing pinned products:", e);}
  }

  if (rule && rule.conditions && rule.conditions.length > 0) {
    // 1. Filter Phase: Handle Exclude
    filteredProducts = products.filter((p) => {
      // Priority: Pinned products cannot be excluded
      if (pinnedIds.includes(p.id)) return true;

      const matchesExclude = rule.conditions.some(
        (cond) => cond.action === "Exclude" && checkRuleMatch(p, cond),
      );
      if (matchesExclude) return false;

      return true;
    });

    // 2. Scoring Phase: Assign scores based on conditions
    filteredProducts.forEach((p) => {
      p.merchandisingScore = 0;
      rule.conditions.forEach((cond) => {
        if (cond.action === "Include" || cond.action === "Exclude") return;

        const matchResult = checkRuleMatch(p, cond);
        if (matchResult) {
          if (
            typeof matchResult === "object" &&
            matchResult.imageUrl &&
            !p.merchandisingImage
          ) {
            p.merchandisingImage = matchResult.imageUrl;
          }

          if (cond.action === "Boost") p.merchandisingScore += 1000;
          else if (cond.action === "Bury") p.merchandisingScore -= 1000;
          else if (cond.action === "Pin") p.merchandisingScore += 5000;
          else if (cond.action === "Dynamic") {
            const num = parseFloat(cond.operand);
            if (!isNaN(num)) {
              if (cond.operator === "Add") p.merchandisingScore += num;
              else if (cond.operator === "Subtract")
                p.merchandisingScore -= num;
              else if (cond.operator === "Set") p.merchandisingScore = num;
              else if (cond.operator === "Multiply")
                p.merchandisingScore *= num;
              else if (cond.operator === "Divide" && num !== 0)
                p.merchandisingScore /= num;
            }
          }
        }
      });
    });
  } else {
    // Ensure score is 0 if no rules
    filteredProducts.forEach((p) => (p.merchandisingScore = 0));
  }

  // Determine if a custom sort is applied
  const isCustomSort = sortBy && sortBy !== "best-selling" && sortBy !== "relevance";

  // Sort logic
  filteredProducts.sort((a, b) => {
    const aPinIndex = pinnedIds.indexOf(a.id);
    const bPinIndex = pinnedIds.indexOf(b.id);

    const aIsPinned = aPinIndex !== -1;
    const bIsPinned = bPinIndex !== -1;

    // Both pinned: order by pin index
    if (aIsPinned && bIsPinned) {
      return aPinIndex - bPinIndex;
    }
    // One pinned: pinned always goes first
    if (aIsPinned) return -1;
    if (bIsPinned) return 1;

    // Neither pinned: sort by score ONLY if no custom sort is applied
    if (!isCustomSort && a.merchandisingScore !== b.merchandisingScore) {
      return b.merchandisingScore - a.merchandisingScore;
    }
    return defaultSortComparison(a, b, sortBy);
  });

  return filteredProducts;
}

/**
 * Default sorting mechanism used as a fallback or when no rules exist.
 */
export function sortProductsByDefault(products, sortBy) {
  return products.sort((a, b) => defaultSortComparison(a, b, sortBy));
}

function defaultSortComparison(a, b, sortBy) {
  if (sortBy === "title-ascending")
    return (a.title || "").localeCompare(b.title || "");
  if (sortBy === "title-descending")
    return (b.title || "").localeCompare(a.title || "");
  if (sortBy === "price-ascending")
    return (parseFloat(a.priceMin) || 0) - (parseFloat(b.priceMin) || 0);
  if (sortBy === "price-descending")
    return (parseFloat(b.priceMin) || 0) - (parseFloat(a.priceMin) || 0);
  if (sortBy === "created-ascending")
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  // default: created-descending
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * Builds a Prisma 'where' clause object for 'Include' rules to fetch external products.
 */
export function buildIncludeWhereClause(includeConditions) {
  if (!includeConditions || includeConditions.length === 0) return null;

  const OR = [];

  for (const cond of includeConditions) {
    const field = cond.field || "";
    
    if (["Price", "Available"].includes(field)) {
      const min = cond.minValue && cond.minValue !== "" ? parseFloat(cond.minValue) : -999999999;
      const max = cond.maxValue && cond.maxValue !== "" ? parseFloat(cond.maxValue) : 999999999;
      
      if (field === "Price") {
        OR.push({ priceMin: { gte: min, lte: max } });
      }
      if (field === "Available") {
        OR.push({ variants: { some: { inventory: { gte: min, lte: max } } } });
      }
      continue;
    }

    const valueString = cond.value || "";
    const values = valueString.split(",").map(s => s.trim()).filter(Boolean);

    if (values.length === 0) continue;

    if (field === "Vendor") {
      OR.push({ vendor: { in: values } });
    } else if (field === "Product type") {
      OR.push({ productType: { in: values } });
    } else if (field === "Tags") {
      OR.push({ tags: { hasSome: values } });
    } else if (field === "Product") {
      OR.push({ title: { in: values } });
    } else if (field === "Collections") {
      OR.push({
        collections: { some: { collection: { title: { in: values } } } }
      });
    } else if (field.includes("(product option)")) {
      OR.push({
        variants: {
          some: {
            OR: [
              { option1: { in: values } },
              { option2: { in: values } },
              { option3: { in: values } }
            ]
          }
        }
      });
    }
  }

  if (OR.length === 0) return null;
  return { OR };
}

