import prisma from "../db.server";

/**
 * Fetches the active merchandising rule for a given shop and collection.
 */
export async function getActiveRuleForCollection(shop, collectionTitle) {
  if (!shop || !collectionTitle) return null;

  const now = new Date();

  return await prisma.merchandisingRule.findFirst({
    where: {
      shop,
      status: true,
      collections: { has: collectionTitle },
      OR: [
        { startDate: null },
        { startDate: { lte: now } }
      ],
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: now } }] }
      ]
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Fetches the active pinning rule for a given shop and collection.
 */
export async function getActivePinningRuleForCollection(shop, collectionTitle) {
  if (!shop || !collectionTitle) return null;

  return await prisma.pinnedProductRule.findFirst({
    where: {
      shop,
      status: true,
      OR: [
        { applyToAll: true },
        { collections: { has: collectionTitle } }
      ]
    },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Helper to check if a product matches a rule condition.
 */
function checkRuleMatch(product, condition) {
  const field = condition.field || "";
  
  // Handle Min/Max Range conditions
  if (["Price", "Discount", "Percent sales", "Available", "Rating"].includes(field)) {
    const min = condition.minValue && condition.minValue !== "" ? parseFloat(condition.minValue) : -Infinity;
    const max = condition.maxValue && condition.maxValue !== "" ? parseFloat(condition.maxValue) : Infinity;
    
    if (field === "Price") {
      const minPrice = parseFloat(product.priceMin || 0);
      return minPrice >= min && minPrice <= max;
    }
    
    if (field === "Available") {
      const inventory = product.variants ? product.variants.reduce((sum, v) => sum + (v.inventory || 0), 0) : 0;
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
  const values = valueString.split(',').map(s => s.trim()).filter(Boolean);
  
  if (field === "Vendor") return values.includes(product.vendor);
  if (field === "Product type") return values.includes(product.productType);
  if (field === "Tags") return product.tags && values.some(v => product.tags.includes(v));
  if (field === "Product") return values.includes(product.title);
  if (field === "Collections") {
    return product.collections && product.collections.some(c => c.collection && values.includes(c.collection.title));
  }
  
  if (field === "Title (product option)" || field === "Color (product option)" || field === "Size (product option)" || field.includes("(product option)")) {
    return product.variants && product.variants.find(v => values.includes(v.option1) || values.includes(v.option2) || values.includes(v.option3));
  }
  
  return false;
}

/**
 * Applies merchandising rules and pinning rules to an array of products and returns the sorted array.
 */
export function applyMerchandisingRules(products, rule, sortBy, pinningRule) {
  let filteredProducts = products;

  if (rule && rule.conditions && rule.conditions.length > 0) {
    const includeConditions = rule.conditions.filter(c => c.action === "Include");
    const hasIncludes = includeConditions.length > 0;

    // 1. Filter Phase: Handle Include and Exclude
    filteredProducts = products.filter(p => {
      const matchesExclude = rule.conditions.some(cond => cond.action === "Exclude" && checkRuleMatch(p, cond));
      if (matchesExclude) return false;

      if (hasIncludes) {
        const matchesInclude = includeConditions.some(cond => checkRuleMatch(p, cond));
        if (!matchesInclude) return false;
      }

      return true;
    });

    // 2. Scoring Phase: Assign scores based on conditions
    filteredProducts.forEach(p => {
      p.merchandisingScore = 0;
      rule.conditions.forEach(cond => {
        if (cond.action === "Include" || cond.action === "Exclude") return;

        const matchResult = checkRuleMatch(p, cond);
        if (matchResult) {
          if (typeof matchResult === 'object' && matchResult.imageUrl && !p.merchandisingImage) {
            p.merchandisingImage = matchResult.imageUrl;
          }

          if (cond.action === "Boost") p.merchandisingScore += 1000;
          else if (cond.action === "Bury") p.merchandisingScore -= 1000;
          else if (cond.action === "Pin") p.merchandisingScore += 5000;
          else if (cond.action === "Dynamic") {
            const num = parseFloat(cond.operand);
            if (!isNaN(num)) {
              if (cond.operator === "Add") p.merchandisingScore += num;
              else if (cond.operator === "Subtract") p.merchandisingScore -= num;
              else if (cond.operator === "Set") p.merchandisingScore = num;
              else if (cond.operator === "Multiply") p.merchandisingScore *= num;
              else if (cond.operator === "Divide" && num !== 0) p.merchandisingScore /= num;
            }
          }
        }
      });
    });
  } else {
    // Ensure score is 0 if no rules
    filteredProducts.forEach(p => p.merchandisingScore = 0);
  }

  // Parse pinned product IDs
  let pinnedIds = [];
  if (pinningRule && pinningRule.products) {
    try {
      const parsedPins = typeof pinningRule.products === 'string' ? JSON.parse(pinningRule.products) : pinningRule.products;
      if (Array.isArray(parsedPins)) {
        pinnedIds = parsedPins.map(p => p.id);
      }
    } catch(e) {}
  }

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

    // Neither pinned: sort by score, then default
    if (a.merchandisingScore !== b.merchandisingScore) {
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
  if (sortBy === "title-ascending") return (a.title || "").localeCompare(b.title || "");
  if (sortBy === "title-descending") return (b.title || "").localeCompare(a.title || "");
  if (sortBy === "price-ascending") return (parseFloat(a.priceMin) || 0) - (parseFloat(b.priceMin) || 0);
  if (sortBy === "price-descending") return (parseFloat(b.priceMax) || 0) - (parseFloat(a.priceMax) || 0);
  if (sortBy === "created-ascending") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  
  // default: created-descending
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
