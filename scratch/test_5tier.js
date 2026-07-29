const product = {
    "id": "gid://shopify/Product/15138310390131",
    "title": "Long Beaded A-Line Formal Dress by LaDivine CD0241",
    "images": [
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241_2.jpg?v=1764944498",
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown.jpg?v=1764944498",
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown-2.jpg?v=1773965635"
    ],
    "options": [
        {
            "name": "Color",
            "values": [
                "Eggplant", "Black Nude", "English Violet", "Gold", "Greenery", "Navy", "Silver", "Smoky Blue"
            ]
        }
    ],
    "variants": [
        {
            "id": "52785461363059",
            "option1": "Eggplant",
            "option2": "6",
            "imageUrl": null
        },
        {
            "id": "52785461100915",
            "option1": "Black Nude",
            "option2": "6",
            "imageUrl": null // Simulating missing variant image in Shopify
        }
    ]
};

function getMerchandisingImageUrl(matchedVariant, product, colorValues = []) {
  const getVarImg = (v) => {
    const img = v.imageUrl || v.image;
    if (typeof img === "string" && img.trim() !== "") return img;
    if (img && typeof img === "object" && (img.url || img.src)) {
      return img.url || img.src;
    }
    return null;
  };

  const variants = product.variants || [];

  // Tier 1: Direct image on matched variant
  const directImg = getVarImg(matchedVariant);
  if (directImg) return directImg;

  // Tier 2: Search sister variants of the exact same color that DO have an image
  const matchedColor = (
    matchedVariant.option1 ||
    matchedVariant.option2 ||
    matchedVariant.option3 ||
    ""
  ).toLowerCase().trim();
  if (matchedColor && variants.length > 0) {
    const sisterVariant = variants.find((v) => {
      const vColor = (
        v.option1 ||
        v.option2 ||
        v.option3 ||
        ""
      ).toLowerCase().trim();
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

  return gallery[0] || null;
}

const matchedVariant = product.variants[1]; // Black Nude
const result = getMerchandisingImageUrl(matchedVariant, product, ["black"]);
console.log("Extracted Image URL for Black Nude (even when variant image is null):", result);
