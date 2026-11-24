import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('app/routes/api.filter.jsx', 'utf8');
const facetQueries = source.slice(source.indexOf('    const neededFacetKeys ='), source.indexOf('    // Query C:'));
// Keep the full bounds/count calculation, including its page-only fallback.
const boundsStart = source.indexOf('    const priceFilter =');
const boundsEnd = source.indexOf('    const getTargetValue =', boundsStart);
const boundsCalculation = source.slice(boundsStart, boundsEnd);

function readBounds(facetRes, page) {
  const context = { activeGroupFilters: [], facetRes, allMatchedProducts: page };
  vm.runInNewContext(boundsCalculation + '\nresult = {min: absoluteMinPrice, max: absoluteMaxPrice};', context);
  return context.result;
}

test('initial and fallback queries request full-result price stats without a selected price', () => {
  const context = { activeGroupFilters: [], queries: [], searchQuery: '', textSearchQuery:'', tier1Filter: ['shop = "fixture"'],
    hasTier1StrictFilters: true, useCollectionPagination: false, useRankedCollectionPagination:false, allFiltersList: ['shop = "fixture"'],collectionFacetClause:null };
  vm.runInNewContext(facetQueries, context);
  for (const query of context.queries) {
    assert.ok(query.facets.includes('priceMin'));
    // Simulate an engine that only returns stats for requested numeric facets.
    const stats = query.facets.includes('priceMin') ? {facetStats: {priceMin: {min: 10, max: 1000}}} : {};
    const bounds = readBounds(stats, [{priceMin: 90, priceMax: 200}]);
    assert.equal(bounds.min, 10);
    assert.equal(bounds.max, 1000);
  }
});

test('ranked collection facets retain full-result price stats without an exhaustive hit-count query',()=>{
 const context={activeGroupFilters:[],queries:[],searchQuery:'',textSearchQuery:'',tier1Filter:['shop = "fixture"'],hasTier1StrictFilters:true,
  useCollectionPagination:true,useRankedCollectionPagination:true,allFiltersList:['shop = "fixture"'],tier2QueryIndex:0,collectionFacetClause:null};
 context.queries.push({filter:context.allFiltersList});
 vm.runInNewContext(facetQueries,context);
 for(const query of context.queries.slice(1)){
  assert.ok(query.facets.includes('priceMin'));assert.equal(query.limit,0);assert.equal(query.hitsPerPage,undefined);
  const bounds=readBounds({facetStats:{priceMin:{min:10,max:1000}}},[{priceMin:90}]);assert.equal(bounds.min,10);assert.equal(bounds.max,1000);
 }
});

test('slider bounds remain identical across pages with different product prices', () => {
  const stats = {facetStats: {priceMin: {min: 10, max: 1000}}};
  for (const page of [[{priceMin: 90, priceMax: 200}], [{priceMin: 500, priceMax: 600}], []]) {
    const bounds = readBounds(stats, page);
    assert.equal(bounds.min, 10);
    assert.equal(bounds.max, 1000);
  }
});

test('price bounds query excludes its own range while retaining other selections', () => {
  const start = source.indexOf('    const categoryQueryStartIndex =');
  const end = source.indexOf('    const saleCountQueryStart =', start);
  const context = { saleRangesConfig: [], queries: [], baseFilters: ['shop = "fixture"'], searchQuery: '', textSearchQuery:'',
    activeCategories: ['priceMin', 'option_Fabric'], categoryFilters: {
      priceMin: 'id IN ["price-qualified-variant"]', option_Fabric: 'option_Fabric = "Chiffon"',
    } };
  context.facetBaseFilters=context.baseFilters;
  vm.runInNewContext(source.slice(start, end), context);
  const priceQuery = context.queries.find(query => query.facets.includes('priceMin'));
  assert.ok(priceQuery.filter.includes('option_Fabric = "Chiffon"'));
  assert.ok(!priceQuery.filter.some(filter => filter.includes('priceMin')));
  assert.ok(!priceQuery.filter.some(filter => filter.includes('price-qualified-variant')));
});
