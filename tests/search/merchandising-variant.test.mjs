import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

const context = { module: { exports: {} }, exports: {}, console, require: () => ({ __esModule: true, default: {} }) };
vm.runInNewContext((await transform(await fs.readFile("app/services/merchandising.server.js", "utf8"), { format: "cjs" })).code, context);
const { selectMerchandisingVariant } = context.module.exports;
const rule = { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black", operator: "contains" }] };
const product = {
  options: [{ name: "Color", values: ["Green", "Blue", "Black"] }], images: ["blue.jpg", "green.jpg", "black.jpg"],
  merchandisingImage: "blue.jpg",
  variantPrices: [
    { id: "green", option1: "Green", available: true, imageUrl: "green.jpg" },
    { id: "blue", option1: "Blue", available: true, imageUrl: "blue.jpg" },
    { id: "black", option1: "Black", available: true, imageUrl: "black.jpg" },
  ],
};

test("a black boost selects the black ID and image despite a pinned blue image", () => {
  const selection = selectMerchandisingVariant(product, rule);
  assert.equal(selection.variantId, "black");
  assert.equal(selection.imageUrl, "black.jpg");
  assert.equal(product.merchandisingImage, "blue.jpg");
});

test("literal black wins over an earlier merged color", () => {
  const selection = selectMerchandisingVariant({ ...product, variantPrices: [{ id: "merged", option1: "Black Nude", available: true, imageUrl: "nude.jpg" }, ...product.variantPrices] }, rule, [{ filterType: "color", targetValue: "Black", sourceValues: ["Black Nude"] }]);
  assert.equal(selection.variantId, "black");
});

test("color in option two uses an available size and a same-color sister image", () => {
  const selection = selectMerchandisingVariant({
    options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Blue", "Black"] }],
    images: ["blue.jpg"], variantPrices: [
      { id: "blue", option1: "M", option2: "Blue", imageUrl: "blue.jpg", available: true },
      { id: "black-s", option1: "S", option2: "Black", imageUrl: "black.jpg", available: false },
      { id: "black-m", option1: "M", option2: "Black", available: true },
    ],
  }, rule);
  assert.equal(selection.variantId, "black-m");
  assert.equal(selection.imageUrl, "black.jpg");
});

test("unmatched and bury rules do not select a variant", () => {
  assert.equal(selectMerchandisingVariant({ ...product, variantPrices: product.variantPrices.slice(0, 2) }, rule), null);
  assert.equal(selectMerchandisingVariant(product, { conditions: [{ ...rule.conditions[0], action: "Bury" }] }), null);
});

test("the card selects the API variant and creates its matching product link", async () => {
  const source = await fs.readFile("extensions/theme-extension/assets/collectionFilterPro.js", "utf8");
  const selection = source.slice(source.indexOf("        if (!matchedVariant && product.selectedVariantId"), source.indexOf("        // Fallback: If no matched variant"));
  const link = source.slice(source.indexOf("          const activeVariantId ="), source.indexOf("          const activeVariantId =") + source.slice(source.indexOf("          const activeVariantId =")).indexOf("\n        }"));
  const card = { product: { handle: "pinned-dress", selectedVariantId: "gid://shopify/ProductVariant/black", variants: product.variantPrices }, matchedVariant: null, matchedVariantId: null, variantImg: null, activeIndex: 0, colorsArray: [["Blue", { variantId: "blue" }]], productUrl: "/products/pinned-dress?variant=green" };
  vm.runInNewContext(selection + link, card);
  assert.equal(card.matchedVariantId, "black");
  assert.equal(card.variantImg, "black.jpg");
  assert.equal(card.productUrl, "/products/pinned-dress?variant=black");
  const customerChoice = { ...card, matchedVariant: product.variantPrices[1], matchedVariantId: "blue", variantImg: "blue.jpg" };
  vm.runInNewContext(selection + link, customerChoice);
  assert.equal(customerChoice.productUrl, "/products/pinned-dress?variant=blue");
});
