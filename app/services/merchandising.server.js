import prisma from "../db.server";

/**
 * Fetches the active merchandising rule for a given shop and collection.
 */
export async function getActiveRuleForCollection(shop, collectionTitle) {
  if (!shop || !collectionTitle) return null;

  return await prisma.merchandisingRule.findFirst({
    where: {
      shop,
      status: true,
      collections: { has: collectionTitle }
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Helper to check if a product matches a rule condition.
 */
function checkRuleMatch(product, condition) {
  const field = condition.field || "";
  const value = condition.value || "";
  
  if (field === "Vendor") return product.vendor === value;
  if (field === "Product type") return product.productType === value;
  if (field === "Tags") return product.tags && product.tags.includes(value);
  
  if (field === "Title (product option)" || field === "Color (product option)" || field === "Size (product option)" || field.includes("(product option)")) {
    return product.variants && product.variants.find(v => v.option1 === value || v.option2 === value || v.option3 === value);
  }
  
  return false;
}

/**
 * Applies merchandising rules to an array of products and returns the sorted array.
 */
export function applyMerchandisingRules(products, rule, sortBy) {
  if (!rule || !rule.conditions || rule.conditions.length === 0) {
    return sortProductsByDefault(products, sortBy);
  }

  // Assign scores based on conditions
  products.forEach(p => {
    p.merchandisingScore = 0;
    rule.conditions.forEach(cond => {
      const matchResult = checkRuleMatch(p, cond);
      if (matchResult) {
        // If the match was a variant, save its image URL
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
          }
        }
      }
    });
  });

  // Sort by score first, then by the selected default sort
  products.sort((a, b) => {
    if (a.merchandisingScore !== b.merchandisingScore) {
      return b.merchandisingScore - a.merchandisingScore;
    }
    return defaultSortComparison(a, b, sortBy);
  });

  return products;
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
