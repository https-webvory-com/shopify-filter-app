import prisma from "../db.server.js";

/**
 * Fetches the active merchandising rule for a given shop and collection.
 */
export async function getActiveRuleForCollection(
  shop,
  collectionTitle,
  currentCustomerTags = [],
) {
  if (!shop || !collectionTitle) return null;

  const now = new Date();

  const rules = await prisma.merchandisingRule.findMany({
    where: {
      shop,
      status: true,
      AND: [
        {
          OR: [{ startDate: null }, { startDate: { lte: now } }],
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
      ],
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  const targetLower = collectionTitle.toLowerCase().trim();
  const targetHandle = targetLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const matchingRules = rules.filter((rule) => {
    if (!rule.collections || !Array.isArray(rule.collections) || rule.collections.length === 0) return false;
    return rule.collections.some((c) => {
      if (!c) return false;
      const cLower = String(c).toLowerCase().trim();
      const cHandle = cLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return cLower === targetLower || cHandle === targetHandle || cLower === targetHandle || cHandle === targetLower;
    });
  });

  // Prioritize specific rules over global (apply to all) rules, and sort by createdAt ASC (older rule created first runs first)
  matchingRules.sort((a, b) => {
    const aIsGlobal = !a.collections || a.collections.length === 0;
    const bIsGlobal = !b.collections || b.collections.length === 0;
    if (aIsGlobal && !bIsGlobal) return 1; // b comes first
    if (!aIsGlobal && bIsGlobal) return -1; // a comes first
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });

  const applicableRules = [];
  for (const rule of matchingRules) {
    if (!rule.customerTags || rule.customerTags.trim() === "") {
      applicableRules.push(rule);
    } else {
      const requiredTags = rule.customerTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const userTags = currentCustomerTags.map((t) => t.trim().toLowerCase());

      const hasMatchingTag = requiredTags.some((tag) => userTags.includes(tag));
      if (hasMatchingTag) {
        applicableRules.push(rule);
      }
    }
  }

  if (applicableRules.length === 0) return null;
  if (applicableRules.length === 1) return applicableRules[0];

  // Merge conditions across all matching rules for the collection sequentially
  const combinedConditions = [];
  applicableRules.forEach((r) => {
    if (Array.isArray(r.conditions)) {
      combinedConditions.push(...r.conditions);
    }
  });

  return {
    id: applicableRules[0].id,
    shop: applicableRules[0].shop,
    name: applicableRules.map((r) => r.name).join(" + "),
    collections: applicableRules[0].collections,
    conditions: combinedConditions,
  };
}

/**
 * Fetches the active merchandising rule for a given shop and search query.
 */
export async function getActiveRuleForSearch(
  shop,
  searchQuery,
  currentCustomerTags = [],
) {
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
          OR: [{ startDate: null }, { startDate: { lte: now } }],
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
      ],
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  const queryLower = searchQuery.toLowerCase();

  for (const rule of rules) {
    if (!rule.searchQueries || rule.searchQueries.length === 0) continue;

    // Check if any of the search queries match the user's query
    if (rule.searchQueries.some((q) => q.toLowerCase() === queryLower)) {
      if (!rule.customerTags || rule.customerTags.trim() === "") {
        return rule; // Rule applies to everyone
      }

      // Rule has specific customer tags, check if currentCustomerTags intersect
      const requiredTags = rule.customerTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const userTags = currentCustomerTags.map((t) => t.trim().toLowerCase());

      const hasMatchingTag = requiredTags.some((tag) => userTags.includes(tag));
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

  // Find all collection-level pinning rules for this shop
  const allRules = await prisma.pinnedProductRule.findMany({
    where: {
      shop,
      status: true,
      ruleType: "collection",
    },
    orderBy: { createdAt: "desc" },
  });

  const targetLower = collectionTitle.toLowerCase().trim();
  const targetHandle = targetLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const specificRule = allRules.find((r) => {
    if (!r.collections || r.collections.length === 0) return false;
    return r.collections.some((c) => {
      if (!c) return false;
      const cLower = c.toLowerCase().trim();
      const cHandle = cLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return cLower === targetLower || cHandle === targetHandle || cLower === targetHandle || cHandle === targetLower;
    });
  });

  if (specificRule) {
    return specificRule;
  }

  // Fallback to applyToAll rules
  return allRules.find((r) => r.applyToAll === true) || null;
}

export async function getActivePinningRuleForSearch(
  shop,
  searchQuery,
  searchType = "page",
) {
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
    if (
      rule.applyToSearchType !== "both" &&
      rule.applyToSearchType !== searchType
    ) {
      continue;
    }

    if (rule.searchQueries.some((q) => q.toLowerCase() === queryLower)) {
      return rule;
    }
  }

  return null;
}

/**
 * Helper to check if a product matches a rule condition.
 * Supports Merged Values rules expansion for options like Color/Size.
 */
function checkRuleMatch(product, condition, mergedValues = []) {
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
  let valueString = condition.value || "";
  if (
    typeof valueString === "string" &&
    (valueString.startsWith("[") || valueString.startsWith("{"))
  ) {
    try {
      const parsed = JSON.parse(valueString);
      if (Array.isArray(parsed)) {
        valueString = parsed.join(",");
      } else if (typeof parsed === "string") {
        valueString = parsed;
      }
    } catch (e) {}
  }

  const rawValues = valueString
    .split(",")
    .map((s) => s.replace(/[\[\]"']/g, "").trim().toLowerCase())
    .filter(Boolean);

  let mergedValuesExpanded = [];
  if (
    mergedValues &&
    mergedValues.length > 0 &&
    (field === "Color (product option)" ||
      field === "Size (product option)" ||
      field.includes("(product option)"))
  ) {
    for (const val of rawValues) {
      const matchingRules = mergedValues.filter(
        (m) => (m.targetValue || "").toLowerCase().trim() === val
      );
      for (const r of matchingRules) {
        if (Array.isArray(r.sourceValues)) {
          for (const sv of r.sourceValues) {
            const svLower = (sv || "").toLowerCase().trim();
            if (svLower && !rawValues.includes(svLower)) {
              mergedValuesExpanded.push(svLower);
            }
          }
        }
      }
    }
  }

  if (field === "Id" || field === "ID" || field === "id") {
    const prodIdClean = String(product.id || "").replace("gid://shopify/Product/", "").toLowerCase().trim();
    return rawValues.some((v) => v === prodIdClean || v === String(product.id).toLowerCase().trim())
      ? { matchType: "exact" }
      : false;
  }
  if (field === "Vendor")
    return rawValues.includes((product.vendor || "").toLowerCase())
      ? { matchType: "exact" }
      : false;
  if (field === "Product type")
    return rawValues.includes((product.productType || "").toLowerCase())
      ? { matchType: "exact" }
      : false;
  if (field === "Tags")
    return product.tags &&
      product.tags.some((v) => rawValues.includes((v || "").toLowerCase()))
      ? { matchType: "exact" }
      : false;
  if (field === "Product")
    return rawValues.includes((product.title || "").toLowerCase())
      ? { matchType: "exact" }
      : false;
  if (field === "Collections") {
    return product.collections &&
      product.collections.some(
        (c) =>
          c.collection &&
          rawValues.includes((c.collection.title || "").toLowerCase()),
      )
      ? { matchType: "exact" }
      : false;
  }

  const fieldLower = field.toLowerCase();
  if (
    fieldLower.includes("option") ||
    fieldLower.includes("color") ||
    fieldLower.includes("size") ||
    fieldLower.includes("title")
  ) {
    const variants = product.variantPrices || product.variants;
    if (!variants || variants.length === 0) return false;

    const getVarImg = (v) => {
      const img = v.imageUrl || v.image;
      if (typeof img === "string" && img.trim() !== "") return img;
      if (img && typeof img === "object" && (img.url || img.src)) {
        return img.url || img.src;
      }
      return null;
    };

    // Multi-tier helper to ensure merchandisingImage is extracted cleanly
    const getMerchandisingImageUrl = (matchedVariant, colorValues = []) => {
      // Tier 1: Direct image on matched variant
      const directImg = getVarImg(matchedVariant);
      if (directImg) return directImg;

      // Tier 2: Search sister variants of the exact same color that DO have an image
      const matchedColor = (matchedVariant.option1 || matchedVariant.option2 || matchedVariant.option3 || "").toLowerCase().trim();
      if (matchedColor && variants.length > 0) {
        const sisterVariant = variants.find((v) => {
          const vColor = (v.option1 || v.option2 || v.option3 || "").toLowerCase().trim();
          return vColor === matchedColor && getVarImg(v);
        });
        if (sisterVariant) {
          const sisterImg = getVarImg(sisterVariant);
          if (sisterImg) return sisterImg;
        }
      }

      const gallery = product.images || [];

      // Tier 3: Search product gallery images for matching color words in filename
      if (gallery.length > 0 && (colorValues.length > 0 || matchedColor)) {
        const searchTerms = [
          ...colorValues,
          matchedColor,
          ...(matchedColor ? matchedColor.split(/[\s\/-]+/) : []),
        ].map((s) => (s || "").toLowerCase().trim()).filter(Boolean);

        for (const term of searchTerms) {
          if (!term || term.length < 2) continue;
          const matchingImg = gallery.find((imgUrl) => {
            if (typeof imgUrl !== "string") return false;
            const filename = imgUrl.split("/").pop().split("?")[0].toLowerCase();
            return filename.includes(term);
          });
          if (matchingImg) return matchingImg;
        }
      }

      // Tier 4: Position-based fallback from product.options -> product.images
      if (gallery.length > 0 && product.options) {
        const colorOpt = (product.options || []).find(
          (o) => o && o.name && o.name.toLowerCase().includes("color")
        );
        if (colorOpt && Array.isArray(colorOpt.values) && matchedColor) {
          const colorIdx = colorOpt.values.findIndex(
            (val) => (val || "").toLowerCase().trim() === matchedColor
          );
          if (colorIdx !== -1 && gallery[colorIdx]) {
            const posImg = typeof gallery[colorIdx] === "string" ? gallery[colorIdx] : gallery[colorIdx].url || gallery[colorIdx].src;
            if (posImg) return posImg;
          }
        }
      }

      // Tier 5: Fallback to first gallery image if nothing else matched
      return gallery[0] || null;
    };

    const exactMatchesList = (v, list) =>
      list.some(
        (val) =>
          (v.option1 || "").toLowerCase().trim() === val ||
          (v.option2 || "").toLowerCase().trim() === val ||
          (v.option3 || "").toLowerCase().trim() === val,
      );

    const containsWholeWord = (text, word) => {
      if (!text || !word) return false;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?:^|[\\s\\/\\-\\_,.])${escaped}(?:$|[\\s\\/\\-\\_,.])`, "i");
      return regex.test(text);
    };

    const mergedMatchesList = (v, list) =>
      list.some((val) => {
        const opt1 = (v.option1 || "").toLowerCase().trim();
        const opt2 = (v.option2 || "").toLowerCase().trim();
        const opt3 = (v.option3 || "").toLowerCase().trim();
        return (
          opt1 === val ||
          opt2 === val ||
          opt3 === val ||
          containsWholeWord(opt1, val) ||
          containsWholeWord(opt2, val) ||
          containsWholeWord(opt3, val)
        );
      });

    // Priority 1: Check for Exact Match (e.g. pure "Black" option) -> +2000 score (only in-stock variants)
    let exactVariant = variants.find(
      (v) => v.available !== false && getVarImg(v) && exactMatchesList(v, rawValues),
    );
    if (!exactVariant)
      exactVariant = variants.find((v) => v.available !== false && exactMatchesList(v, rawValues));
    if (!exactVariant)
      exactVariant = variants.find((v) => getVarImg(v) && exactMatchesList(v, rawValues));
    if (!exactVariant)
      exactVariant = variants.find((v) => exactMatchesList(v, rawValues));

    if (exactVariant) {
      const extractedImg = getMerchandisingImageUrl(exactVariant, rawValues);
      return {
        variant: exactVariant,
        imageUrl: extractedImg,
        matchType: "exact",
      };
    }

    // Priority 2: Check for Merged Value Match (e.g. "Black Nude", "Black/Gold") -> +1000 score
    const mergedList = [...mergedValuesExpanded, ...rawValues];
    let mergedVariant = variants.find(
      (v) => v.available !== false && getVarImg(v) && mergedMatchesList(v, mergedList),
    );
    if (!mergedVariant)
      mergedVariant = variants.find((v) => v.available !== false && mergedMatchesList(v, mergedList));
    if (mergedVariant) {
      const extractedImg = getMerchandisingImageUrl(mergedVariant, mergedList);
      return {
        variant: mergedVariant,
        imageUrl: extractedImg,
        matchType: "merged",
      };
    }
  }

  return false;
}

/**
 * Applies merchandising rules and pinning rules to an array of products and returns the sorted array.
 */
export function applyMerchandisingRules(
  products,
  rule,
  sortBy,
  pinningRule,
  mergedValues = [],
  globalSettings = null,
) {
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

        // Assign pinned image/imageUrl to merchandisingImage for each pinned product
        parsedPins.forEach((pinnedItem) => {
          if (!pinnedItem || !pinnedItem.id) return;
          const targetProd = products.find((p) => p.id === pinnedItem.id);
          if (targetProd) {
            const pinnedImg = pinnedItem.image || pinnedItem.imageUrl || pinnedItem.src;
            if (pinnedImg && typeof pinnedImg === "string") {
              targetProd.merchandisingImage = pinnedImg;
            } else if (pinnedImg && typeof pinnedImg === "object" && (pinnedImg.src || pinnedImg.url)) {
              targetProd.merchandisingImage = pinnedImg.src || pinnedImg.url;
            }
          }
        });
      }
    } catch (e) {
      console.error("Error parsing pinned products:", e);
    }
  }

  if (rule && rule.conditions && rule.conditions.length > 0) {
    // 1. Filter Phase: Handle Exclude
    filteredProducts = products.filter((p) => {
      // Priority: Pinned products cannot be excluded
      if (pinnedIds.includes(p.id)) return true;

      const matchesExclude = rule.conditions.some(
        (cond) =>
          cond.action === "Exclude" && checkRuleMatch(p, cond, mergedValues),
      );
      if (matchesExclude) return false;

      return true;
    });

    // 2. Scoring Phase: Assign scores based on conditions
    filteredProducts.forEach((p) => {
      p.merchandisingScore = 0;
      rule.conditions.forEach((cond) => {
        if (cond.action === "Exclude") return;

        const matchResult = checkRuleMatch(p, cond, mergedValues);
        if (matchResult) {
          const isExact =
            typeof matchResult === "object" &&
            matchResult.matchType === "exact";
          const imageUrl =
            typeof matchResult === "object" ? matchResult.imageUrl : null;

          if (imageUrl && !p.merchandisingImage) {
            p.merchandisingImage = imageUrl;
          }

          if (cond.action === "Boost") {
            // Tier 1 Exact match gets higher score (+2000) than Tier 2 Merged match (+1000)
            p.merchandisingScore += isExact ? 2000 : 1000;
          } else if (cond.action === "Bury") {
            p.merchandisingScore -= isExact ? 2000 : 1000;
          } else if (cond.action === "Pin") {
            p.merchandisingScore += 5000;
          } else if (cond.action === "Dynamic") {
            const numStr = cond.operand || cond.value || "";
            const num = parseFloat(numStr);
            if (!isNaN(num)) {
              const op = (cond.operator || "Add").trim();
              if (op === "Add" || !op || op === "Operator" || op === "Set")
                p.merchandisingScore += num;
              else if (op === "Subtract") p.merchandisingScore -= num;
              else if (op === "Multiply") p.merchandisingScore *= num;
              else if (op === "Divide" && num !== 0) p.merchandisingScore /= num;
            }
          }
        }
      });
    });
  } else {
    // Ensure score is 0 if no rules
    filteredProducts.forEach((p) => (p.merchandisingScore = 0));
  }

  // Priority toggles (SoBooster defaults: false -> rules and pinning have priority)
  const prioritizeSortOverPinning = globalSettings?.prioritizeSortOverPinning ?? false;
  const prioritizeSortOverMerchandising = globalSettings?.prioritizeSortOverMerchandising ?? false;

  // Sort logic
  filteredProducts.sort((a, b) => {
    const aPinIndex = pinnedIds.indexOf(a.id);
    const bPinIndex = pinnedIds.indexOf(b.id);

    const aIsPinned = aPinIndex !== -1;
    const bIsPinned = bPinIndex !== -1;

    // 1. Pinned items priority (unless prioritizeSortOverPinning is true)
    if (!prioritizeSortOverPinning && (aIsPinned || bIsPinned)) {
      if (aIsPinned && bIsPinned) {
        return aPinIndex - bPinIndex;
      }
      if (aIsPinned) return -1;
      if (bIsPinned) return 1;
    }

    // 2. Merchandising score priority (unless prioritizeSortOverMerchandising is true)
    if (!prioritizeSortOverMerchandising && a.merchandisingScore !== b.merchandisingScore) {
      return b.merchandisingScore - a.merchandisingScore;
    }

    // 3. Fallback to default / selected sort order tie-breaker
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
  if (sortBy === "created-descending")
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  // default / manual / best-selling: tie-break by original collection position (_originalIndex)
  if (a._originalIndex !== undefined && b._originalIndex !== undefined && a._originalIndex !== b._originalIndex) {
    return a._originalIndex - b._originalIndex;
  }

  // Commented out bestSellingScore sort as requested by user
  /*
  if (sortBy === "best-selling") {
    const scoreA = a.bestSellingScore !== undefined ? parseFloat(a.bestSellingScore) : 0;
    const scoreB = b.bestSellingScore !== undefined ? parseFloat(b.bestSellingScore) : 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return 0;
  }
  */
  
  if (sortBy === "trending") {
    const scoreA = a.trendingScore !== undefined ? parseFloat(a.trendingScore) : 0;
    const scoreB = b.trendingScore !== undefined ? parseFloat(b.trendingScore) : 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return 0;
  }

  if (a._originalIndex !== undefined && b._originalIndex !== undefined) {
    return a._originalIndex - b._originalIndex;
  }

  return 0;
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
      const min =
        cond.minValue && cond.minValue !== ""
          ? parseFloat(cond.minValue)
          : -999999999;
      const max =
        cond.maxValue && cond.maxValue !== ""
          ? parseFloat(cond.maxValue)
          : 999999999;

      if (field === "Price") {
        OR.push({ priceMin: { gte: min, lte: max } });
      }
      if (field === "Available") {
        OR.push({ variants: { some: { inventory: { gte: min, lte: max } } } });
      }
      continue;
    }

    const valueString = cond.value || "";
    const values = valueString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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
        collections: { some: { collection: { title: { in: values } } } },
      });
    } else if (field.includes("(product option)")) {
      OR.push({
        variants: {
          some: {
            OR: [
              { option1: { in: values } },
              { option2: { in: values } },
              { option3: { in: values } },
            ],
          },
        },
      });
    }
  }

  if (OR.length === 0) return null;
  return { OR };
}

/**
 * Builds Meilisearch filter array for 'Include' rules to pull external products into search results.
 */
export function buildMeiliIncludeFilters(includeConditions) {
  if (!includeConditions || includeConditions.length === 0) return [];
  const meiliFilters = [];

  for (const cond of includeConditions) {
    if (cond.action !== "Include") continue;
    const field = cond.field || "";
    const valueString = cond.value || "";
    const values = valueString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (values.length === 0) continue;

    if (field === "Vendor") {
      meiliFilters.push(`vendor IN [${values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(",")}]`);
    } else if (field === "Product type") {
      meiliFilters.push(`productType IN [${values.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(",")}]`);
    } else if (field === "Tags") {
      meiliFilters.push(`tags IN [${values.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(",")}]`);
    } else if (field === "Product") {
      meiliFilters.push(`title IN [${values.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(",")}]`);
    } else if (field === "Collections") {
      meiliFilters.push(`collection_titles IN [${values.map((c) => `'${c.replace(/'/g, "\\'")}'`).join(",")}]`);
    } else if (field.includes("(product option)")) {
      const optName = field.replace(" (product option)", "");
      meiliFilters.push(`option_${optName} IN [${values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(",")}]`);
    }
  }

  return meiliFilters;
}

