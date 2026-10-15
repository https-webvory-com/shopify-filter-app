import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import * as color from '../../../app/utils/searchColor.js';
import * as ranking from '../../../app/utils/rankedCollectionPage.js';

export async function loadModule(file, mocks) {
  const context = { module: { exports: {} }, exports: {}, URL, Response, console, testParsedQuery: mocks.testParsedQuery || null, require: name => {
    if (!(name in mocks)) throw Error('Unexpected import ' + name);
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
  });
  return { ...service, merchandising };
}
