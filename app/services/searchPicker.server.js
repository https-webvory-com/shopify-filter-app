import { parseQuery } from './queryParser.server.js';
import { rankSearchResults } from './searchRanking.server.js';

// Use storefront retrieval, rather than a catalog-wide title substring lookup.
export async function searchPickerProducts(shop, queries) {
  const products = new Map();
  for (const query of [...new Set(queries.map(q => String(q).trim()).filter(Boolean))]) {
    const parsedQuery = await parseQuery(query, shop);
    const result = await rankSearchResults({ shop, query, parsedQuery,
      options: { filter: [`shop = '${shop.replace(/'/g, "\\'")}'`, "status = 'ACTIVE'",
        ...(parsedQuery?.colorFilter ? [parsedQuery.colorFilter] : [])] }, limit: Number.MAX_SAFE_INTEGER });
    for (const product of result.products) products.set(product.id, product);
  }
  return [...products.values()];
}
