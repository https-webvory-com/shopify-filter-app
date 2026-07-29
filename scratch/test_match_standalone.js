function checkRuleMatch(product, condition, mergedValues = []) {
  const field = condition.field || "";

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

  if (
    field === "Title (product option)" ||
    field === "Color (product option)" ||
    field === "Size (product option)" ||
    field.includes("(product option)")
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

      // Tier 3: Search product gallery images for matching color in filename
      const gallery = product.images || [];
      if (gallery.length > 0 && colorValues.length > 0) {
        for (const colorVal of colorValues) {
          const cleanVal = colorVal.toLowerCase().trim();
          if (!cleanVal) continue;
          const matchingImg = gallery.find((imgUrl) => {
            if (typeof imgUrl !== "string") return false;
            const filename = imgUrl.split("/").pop().split("?")[0].toLowerCase();
            return filename.includes(cleanVal);
          });
          if (matchingImg) return matchingImg;
        }
      }

      return null;
    };

    const matchesList = (v, list) =>
      list.some(
        (val) =>
          (v.option1 || "").toLowerCase().trim() === val ||
          (v.option1 || "").toLowerCase().trim().includes(val) ||
          (v.option2 || "").toLowerCase().trim() === val ||
          (v.option2 || "").toLowerCase().trim().includes(val) ||
          (v.option3 || "").toLowerCase().trim() === val ||
          (v.option3 || "").toLowerCase().trim().includes(val),
      );

    let exactVariant = variants.find(
      (v) => getVarImg(v) && matchesList(v, rawValues),
    );
    if (!exactVariant)
      exactVariant = variants.find((v) => matchesList(v, rawValues));
    if (exactVariant) {
      const extractedImg = getMerchandisingImageUrl(exactVariant, rawValues);
      return {
        variant: exactVariant,
        imageUrl: extractedImg,
        matchType: "exact",
      };
    }
  }

  return false;
}

// Case 1: Variant without direct image, sister variant has image
const product1 = {
  id: "1",
  images: ["https://cdn.shopify.com/.../1319_Gold_1.jpg"],
  variants: [
    { option1: "Dark Gold", option2: "XS", imageUrl: "https://cdn.shopify.com/.../1319_Gold_1.jpg" },
    { option1: "Black", option2: "Size 10", imageUrl: null }, // Matched variant has no image
    { option1: "Black", option2: "Size 6", imageUrl: "https://cdn.shopify.com/.../1_81ff5ebb_black.jpg" } // Sister variant HAS image
  ]
};

// Case 2: Variant has no image, sister variants have no image, gallery has color filename
const product2 = {
  id: "2",
  images: [
    "https://cdn.shopify.com/.../1319_Gold_1.jpg",
    "https://cdn.shopify.com/.../1319_BLACK_1.jpg" // Gallery image has "black"
  ],
  variants: [
    { option1: "Dark Gold", option2: "XS", imageUrl: null },
    { option1: "Black", option2: "XS", imageUrl: null }
  ]
};

console.log("Test Case 1 (Sister Variant Fallback):", checkRuleMatch(product1, { field: "Color (product option)", value: "Black" }));
console.log("Test Case 2 (Gallery Image Fallback):", checkRuleMatch(product2, { field: "Color (product option)", value: "Black" }));
