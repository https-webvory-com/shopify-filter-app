import {marketAvailabilityVersion} from '../../../app/utils/marketAvailability.js';
import * as productFilterFacts from '../../../app/utils/productFilterFacts.js';
import * as extraProductFilters from '../../../app/utils/extraProductFilters.js';
import * as percentSaleFilter from '../../../app/utils/percentSaleFilter.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import * as color from '../../../app/utils/searchColor.js';
import * as ranking from '../../../app/utils/rankedCollectionPage.js';
import * as collectionCards from '../../../app/utils/collectionCards.js';
import * as pinnedPrefix from '../../../app/utils/collectionPinnedPrefix.js';
import * as productTitleFilter from '../../../app/utils/productTitleFilter.js';
import * as collectionNavigation from '../../../app/utils/collectionNavigation.js';

export async function loadModule(file, mocks) {
  const context = { module: { exports: {} }, exports: {}, URL, Response, AbortSignal, console, process: {env:mocks.testEnv || {}}, testParsedQuery: mocks.testParsedQuery || null, require: name => {
    if(name==='../utils/productFilterFacts.js')return productFilterFacts;
    if(name==='../utils/productTitleFilter.js')return productTitleFilter;
    if(name==='../utils/extraProductFilters.js')return extraProductFilters;
    if(name==='../utils/percentSaleFilter.js')return percentSaleFilter;
    if(name==='../utils/collectionNavigation.js')return collectionNavigation;
    if (!(name in mocks)) {
      // Existing synthetic catalogs have no market restrictions; dedicated tests inject market proofs.
      if(name.endsWith('/marketAvailability.server.js'))return {getMarketAvailableProductIds:async()=>undefined,marketAvailabilityVersion};
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
