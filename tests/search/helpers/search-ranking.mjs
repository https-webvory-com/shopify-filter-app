import * as productFilterFacts from '../../../app/utils/productFilterFacts.js';
import * as extraProductFilters from '../../../app/utils/extraProductFilters.js';
import * as percentSaleFilter from '../../../app/utils/percentSaleFilter.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import * as instantSearchCard from '../../../app/utils/instantSearchCard.js';
import * as searchCachePolicy from '../../../app/utils/searchCachePolicy.js';
import * as facetNormalization from '../../../app/utils/facetNormalization.js';
import * as color from '../../../app/utils/searchColor.js';
import * as ranking from '../../../app/utils/rankedCollectionPage.js';
import * as collectionCards from '../../../app/utils/collectionCards.js';
import * as pinnedPrefix from '../../../app/utils/collectionPinnedPrefix.js';
import * as productTitleFilter from '../../../app/utils/productTitleFilter.js';
import * as filterPresentation from '../../../app/utils/filterPresentation.js';
import * as collectionNavigation from '../../../app/utils/collectionNavigation.js';
import * as marketAvailability from '../../../app/utils/marketAvailability.js';
import * as collectionFilterMembership from '../../../app/utils/collectionFilterMembership.js';
import * as skuSearch from '../../../app/utils/skuSearch.js';
import * as searchConfiguration from '../../../app/utils/searchConfiguration.js';
import * as marketPricingIndex from '../../../app/utils/marketPricingIndex.js';
import * as variantSize from '../../../app/utils/variantSize.js';
import * as searchPinnedIntent from '../../../app/utils/searchPinnedIntent.js';
import * as emptySearchPins from '../../../app/utils/emptySearchPins.js';
import * as queryIntent from '../../../app/utils/queryIntent.js';
import * as filterWidths from '../../../app/utils/filterWidths.js';
import * as collectionSearchText from '../../../app/utils/collectionSearchText.js';
import * as savedMarketPricing from '../../../app/utils/savedMarketPricing.js';
import * as productMarketPrices from '../../../app/utils/readProductMarketPrices.js';

export async function loadModule(file, mocks) {
  const context = { module: { exports: {} }, exports: {}, URL, Request, Response, AbortSignal, setTimeout, console, process: {env:mocks.testEnv || {}}, testParsedQuery: mocks.testParsedQuery || null, require: name => {
    if(name==='../utils/savedMarketPricing.js')return savedMarketPricing;
    if(name==='../utils/readProductMarketPrices.js')return productMarketPrices;
    if(name==='../utils/productFilterFacts.js')return productFilterFacts;
    if(name==='../utils/filterWidths.js')return filterWidths;
    if(name==='../utils/collectionSearchText.js')return collectionSearchText;
    if(name==='../hooks/usePickerRequest')return {usePickerRequest:()=>({})};
    if(name==='../hooks/useCompletedSubmission')return {useCompletedSubmission:()=>{}};
    if(name==='../components/ui/AdminNoSearchResults')return {default:()=>null};
    if(name==='../utils/skuSearch.js')return skuSearch;
    if(name==='../utils/instantSearchCard.js')return instantSearchCard;
    if(name==='../utils/searchCachePolicy.js')return searchCachePolicy;
    if(name==='../utils/facetNormalization.js')return facetNormalization;
    if(name==='node:crypto')return {createHash};
    if(name==='../utils/searchConfiguration.js')return searchConfiguration;
    if(name==='../components/EmptySearchProducts')return mocks[name]||{default:()=>null};
    if(name==='../components/SearchIndexSettings')return mocks[name]||{default:()=>null};
    if(name==='../services/searchCollectionPicker.server.js')return mocks[name]||{listSearchCollections:async()=>({query:'',after:'',collections:[],hasMore:false,nextCursor:''}),getEmptySearchProductState:async(_shop,products)=>({products,stockOnly:false}),listSearchProducts:async()=>({query:'',products:[]}),validateSelectedSearchProducts:async(_shop,products)=>products};
    if(name==='../services/emptySearchPins.server.js')return mocks[name]||{isEmptySearchPin:rule=>!rule?.applyToAll&&rule?.searchQueries?.length===1&&rule.searchQueries[0]==='',legacyEmptySearchProducts:async()=>[],saveEmptySearchPin:async()=>null};
    if(name==='../utils/marketPricingIndex.js')return marketPricingIndex;
    if(name==='../utils/variantSize.js')return variantSize;
    if(name==='../utils/searchPinnedIntent.js')return searchPinnedIntent;
    if(name==='../utils/emptySearchPins.js')return emptySearchPins;
    if(name==='../utils/queryIntent.js')return queryIntent;
    if(!(name in mocks)&&(name==='./searchIndex.server.js'||name==='../services/searchIndex.server.js'))return {prepareConfiguredSearchQueries:async queries=>queries.map(({_cfpSearchSurface,...q})=>({...q,indexUid:q.indexUid||'products'})),getSearchIndexContext:async()=>({uid:'products',settings:null,custom:false}),scheduleSearchIndex:async()=>{},resetSearchIndexContext:async()=>{},retireSearchIndexes:async()=>{},syncConfiguredSearchSynonyms:async()=>{},getSearchIndexStatus:async()=>({phase:'default'}),configuredSuggestions:async()=>null};
    if(name==='../utils/productTitleFilter.js')return productTitleFilter;
    if(name==='../utils/filterPresentation.js')return filterPresentation;
    if(name==='../utils/extraProductFilters.js')return extraProductFilters;
    if(name==='../utils/percentSaleFilter.js')return percentSaleFilter;
    if(name==='../utils/collectionNavigation.js')return collectionNavigation;
    if (!(name in mocks)) {
      if(name==='../utils/marketAvailability.js')return marketAvailability;
      if(name==='../services/marketAvailability.server.js')return {getMarketAvailabilityState:async()=>({status:'disabled',version:null}),getMarketAvailableProductIds:async()=>null};
      if(name==='../services/marketPriceCoverage.server.js')return {marketPriceIntentReady:async()=>false};
      if(name==='./marketPriceCoverage.server.js')return {allMarketPriceCountries:async()=>[],marketPriceCountriesForShop:async()=>[]};
      if(name==='../utils/collectionFilterMembership.js')return collectionFilterMembership;
      if(name==='../services/collectionFilterMembership.server.js')return {collectionMembershipProof:async()=>null};
      if(name==='../utils/collectionCards.js')return collectionCards;
      if(name==='../utils/collectionPinnedPrefix.js')return pinnedPrefix;
      if(name==='../services/collectionCards.server.js')return {getPreparedCollectionCards:async()=>null,beginPreparedCollectionCards:async()=>null};
      throw Error('Unexpected import ' + name);
    }
    const value = mocks[name];
    return value && 'default' in value ? { __esModule: true, ...value } : value;
  } };
  const source = (await fs.readFile(file, 'utf8')).replace('await import("../services/queryParser.server.js")', '({parseQuery:async()=>testParsedQuery})');
  vm.runInNewContext((await transform(source, { loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs' })).code, context);
  return context.module.exports;
}
export async function loadRanking(prisma, semanticSearch, getCached = async (_key, read) => read(), keywordSearch = semanticSearch) {
  const merchandising = await loadModule('app/services/merchandising.server.js', { '../db.server.js': { default: prisma } });
  const service = await loadModule('app/services/searchRanking.server.js', {
    'node:crypto': { createHash }, './shopCache.server': { getCached },
    '../db.server': { default: prisma }, './semanticSearch.server': { semanticSearch, keywordSearch },
    './merchandising.server': merchandising, '../utils/searchColor.js': color,
    '../utils/rankedCollectionPage.js': ranking,
    './nativeSearchPage.server.js': { rankNativeSearchPage: async () => null },
  });
  return { ...service, merchandising };
}
