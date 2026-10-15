// Additive search-only fields. Keep the storefront document contract intact.
export const SEARCH_PROJECTION_VERSION = 1;
export const searchExactToken = value => Buffer.from(String(value), 'utf8').toString('hex');
export const decodeSearchFacet = token => JSON.parse(Buffer.from(token, 'hex').toString('utf8'));
export const SEARCH_FILTER_FIELDS = ['cfpSearchVersion', 'cfpSearchColors', 'cfpSearchAvailableColors',
  'cfpSearchHasStock', 'cfpSearchInventory', 'cfpSearchDiscount', 'cfpSearchPercentSales',
  'cfpSearchRating', 'cfpSearchSkus', 'cfpSearchPrice', 'cfpSearchOptionPhrases',
  'cfpSearchVendor', 'cfpSearchTitle', 'cfpSearchType', 'cfpSearchTags', 'cfpSearchCollections',
  'cfpSearchFacetValues', 'cfpSearchFacetUnsupported'];

export function searchIndexProjection(product) {
  const variants = product.variantPrices || product.variants || [];
  let options = product.options || [];
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = []; } }
  const colorPosition = options.findIndex(o => /^colou?r$/i.test(o.name || ''));
  const colorKey = `option${colorPosition + 1}`;
  const color = v => typeof v[colorKey] === 'string' ? v[colorKey].trim().toLowerCase() : '';
  const exact = value => searchExactToken(String(value || '').toLowerCase());
  const phrases = new Set();
  let complete = true;
  for (const value of new Set(variants.flatMap(v => [v.option1, v.option2, v.option3]).filter(v => typeof v === 'string' && v))) {
    const text = value.toLowerCase();
    const separators = [...text.matchAll(/[\s/\-_,.]/g)].map(m => m.index);
    if (text.length > 128 || separators.length > 16) { complete = false; break; }
    for (const start of [0, ...separators.map(i => i + 1)]) for (const end of [...separators, text.length]) {
      if (end <= start) continue;
      const term = text.slice(start, end).trim();
      if (term) phrases.add(term);
    }
    if (phrases.size > 4096) { complete = false; break; }
  }
  let discount = 0, percent = 0;
  for (const v of variants) {
    const price = parseFloat(v.price || 0), compare = parseFloat(v.compareAtPrice || 0);
    if (compare > price) { discount = Math.max(discount, compare - price); percent = Math.max(percent, (compare - price) / compare * 100); }
  }
  let rating = product.rating ?? product['metafield_reviews.rating'];
  if (typeof rating === 'string' && rating.startsWith('{')) { try { rating = JSON.parse(rating); } catch { rating = null; } }
  if (rating && typeof rating === 'object') rating = rating.value;
  rating = rating == null || rating === '' ? null : Number(rating);
  const facets = {vendor:product.vendor,productType:product.productType,tags:product.tags,priceMin:product.priceMin};
  for (const [key,value] of Object.entries(product)) if (/^(option_|metafield_)/.test(key)) facets[key]=value;
  for (const option of options) facets[`option_${option.name}`] ??= option.values;
  const facetValues=[], unsupported=[];
  for (const [field,value] of Object.entries(facets)) {
    const values=[...new Set((Array.isArray(value)?value.flat():[value]).filter(v=>v!=null&&v!=='').map(String))];
    if(values.length>1000||values.some(v=>v.length>4096)||values.reduce((n,v)=>n+v.length,0)>40000) {unsupported.push(field);continue;}
    for(const v of values)facetValues.push(searchExactToken(JSON.stringify([field,v])));
  }
  return {
    cfpSearchVersion: complete ? SEARCH_PROJECTION_VERSION : 0,
    cfpSearchOptionPhrases: complete ? [...phrases].map(searchExactToken) : [],
    cfpSearchColors: colorPosition < 0 ? [] : [...new Set(variants.map(color).filter(Boolean))].map(searchExactToken),
    cfpSearchAvailableColors: colorPosition < 0 ? [] : [...new Set(variants.filter(v => v.available === true).map(color).filter(Boolean))].map(searchExactToken),
    cfpSearchHasStock: variants.some(v => v.available === true),
    cfpSearchInventory: Number.isFinite(product.inventoryTotal) ? product.inventoryTotal : variants.reduce((sum, v) => sum + (v.inventory || 0), 0),
    cfpSearchDiscount: discount, cfpSearchPercentSales: percent,
    cfpSearchPrice: parseFloat(product.priceMin || 0),
    cfpSearchRating: Number.isFinite(rating) ? rating : null,
    cfpSearchSkus: [...new Set(variants.map(v => String(v.sku || '').trim().toLowerCase()).filter(Boolean))].map(searchExactToken),
    cfpSearchVendor: exact(product.vendor), cfpSearchTitle: exact(product.title), cfpSearchType: exact(product.productType),
    cfpSearchTags: (product.tags || []).map(exact), cfpSearchCollections: (product.collection_titles || []).map(exact),
    cfpSearchFacetValues: facetValues, cfpSearchFacetUnsupported: unsupported,
  };
}
