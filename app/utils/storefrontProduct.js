// Shopify can keep an ACTIVE product unpublished from the Online Store.
export function isStorefrontProduct(product) {
  return product?.status?.toUpperCase() === "ACTIVE" && Boolean(product.publishedAt);
}
