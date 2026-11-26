import meiliClient from "./meiliClient.server.js";

import { getCached } from "./shopCache.server.js";
import prisma from "../db.server";
import { resolveSearchColor, colorSearchFilter } from "../utils/searchColor.js";
import {isProductCodeQuery,skuSearchWhere} from '../utils/skuSearch.js';
import {getSearchIndexContext} from './searchIndex.server.js';
import { extractQueryIntent } from '../utils/queryIntent.js';

export async function initializeParserCache(shop) {
  if (!shop) throw new Error("Query parser requires a shop");
  return getCached(`queryParserFacets:${shop}`, async () => {
    const index = meiliClient.index('products');
    const attributes = await index.getFilterableAttributes();
    const colorFields = attributes.filter(field => typeof field === 'string' && /^option_colou?r$/i.test(field));
    const search = await index.search('', {
      limit: 0, facets: [...colorFields, 'vendor', 'productType'],
      filter: [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'"]
    });
    const dist = search.facetDistribution || {};
    return {
      colors: [...new Set(colorFields.flatMap(field => Object.keys(dist[field] || {})))],
      colorFields, vendors: Object.keys(dist.vendor || {}), productTypes: Object.keys(dist.productType || {})
    };
  });
}

export async function parseQuery(query, shop) {
  if (!query || typeof query !== 'string') return null;
  const intent = extractQueryIntent(query);

  const context=await getSearchIndexContext(shop);
  const searchable=context.settings?.fields.filter(f=>f.search&&f.weight>0);
  if(isProductCodeQuery(query)&&(!searchable||searchable.some(f=>f.key==='sku'))){
    const ids=await getCached(`skuSearch:${shop}:${JSON.stringify(query.trim().toLowerCase())}`,async()=>{
      const rows=await prisma.product.findMany({where:skuSearchWhere(shop,query),select:{id:true}});
      return rows.map(row=>String(row.id).split('/').pop());
    },15);
    if(ids.length)return {originalQuery:query,remainingQuery:'',hasFilters:false,filters:{colors:[],vendors:[],types:[]},intent,
      queryColorWords:[],colorIntent:{requested:[],values:[]},colorFilter:null,skuProductIds:ids};
  }

  const cache = await initializeParserCache(shop);
  const lowerQuery = query.toLowerCase().trim();
  const tokens = lowerQuery.split(/\s+/);
  
  let detectedColors = [];
  let detectedVendors = [];
  let detectedTypes = [];

  const aliases = await getCached(`mergedValues:${shop}`, () => prisma.mergedValue.findMany({ where: { shop, isActive: true } }));
  const colorEnabled=!searchable||searchable.some(f=>f.key==='option:*'||/^option:colou?r$/i.test(f.key));
  const colorIntent = resolveSearchColor(query, colorEnabled?cache.colors:[], colorEnabled?aliases:[]);
  const queryColorWords = colorIntent.queryWords || colorIntent.requested;
  detectedColors = colorIntent.values;

  // Detect vendors
  for (const v of (!searchable||searchable.some(f=>f.key==='vendor')?cache.vendors:[])) {
    if (v.trim() === '') continue;
    const vLower = v.toLowerCase();
    // Use word boundaries so "Mac" doesn't match "Machine"
    const regex = new RegExp(`(^|[^a-z])${escapeRegExp(vLower)}([^a-z]|$)`);
    if (regex.test(lowerQuery)) {
      detectedVendors.push(v);
    }
  }

  // Detect types
  for (const t of (!searchable||searchable.some(f=>f.key==='productType')?cache.productTypes:[])) {
    if (t.trim() === '') continue;
    const tLower = t.toLowerCase();
    const regex = new RegExp(`(^|[^a-z])${escapeRegExp(tLower)}([^a-z]|$)`);
    if (regex.test(lowerQuery)) {
      detectedTypes.push(t);
    }
  }

  let remainingQuery = lowerQuery;

  if (queryColorWords.length === 1) {
    for (const cw of queryColorWords) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${cw}(\\s|$)`, 'ig'), ' ').trim();
    }
  }
  const colorQuery = remainingQuery.replace(/\s+/g, ' ').trim();

  if (detectedVendors.length > 0) {
    for (const v of detectedVendors) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${escapeRegExp(v)}(\\s|$)`, 'ig'), ' ').trim();
    }
  }

  if (detectedTypes.length > 0) {
    for (const t of detectedTypes) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${escapeRegExp(t)}(\\s|$)`, 'ig'), ' ').trim();
    }
  }

  // Clean up any double spaces left behind
  remainingQuery = remainingQuery.replace(/\s+/g, ' ').trim();

  return {
    originalQuery: query,
    remainingQuery,
    intent,
    hasFilters: detectedColors.length > 0 || detectedVendors.length > 0 || detectedTypes.length > 0 || queryColorWords.length > 0,
    filters: {
      colors: detectedColors,
      vendors: detectedVendors,
      types: detectedTypes
    },
    queryColorWords,
    colorQuery,
    colorIntent,
    colorFilter: colorSearchFilter(colorIntent, cache.colorFields),
    // A brand named in the query restricts results to that brand, so other
    // labels cannot rank ahead of it (exact facet values, safely quoted).
    vendorFilter: detectedVendors.length
      ? `vendor IN [${[...new Set(detectedVendors)].map(v => JSON.stringify(v)).join(',')}]` : null
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
