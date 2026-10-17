import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '../../scratch/banner-prisma/index.js';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';
import * as blacklist from '../../app/utils/suggestionBlacklist.js';
const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
if (new URL(config.url).hostname !== '127.0.0.1' || Number(new URL(config.url).port) !== config.port || !path.resolve(config.directory).startsWith(path.resolve('scratch') + path.sep)) throw Error('Settings tests require an isolated local database');
export const db = new PrismaClient({ datasources: { db: { url: config.url } } });
export const shop = 'settings-fixture.myshopify.com';
export const service = await loadModule('app/services/searchSettings.server.js', { '../db.server': { default: db }, '../utils/searchSettings.js': schema });
export const admin = await loadModule('app/routes/app.search.settings.jsx', { '../components/SearchConfigurationLayout': { default: () => null }, 'react-router': {}, react: {}, '@shopify/shopify-app-react-router/server': { boundary: {} }, '../shopify.server': { authenticate: { admin: async () => ({ session: { shop } }) } }, '../services/searchSettings.server.js': service, '../utils/searchSettings.js': schema });
export const state = { fail: false, slow: false, blacklist: [] };
export const api = await loadModule('app/routes/api.search-settings.jsx', {
  'react-router': { data: (v, options) => Response.json(v, options) },
  '../services/searchSettings.server.js': { getSearchSettings: async (...args) => { if (state.fail) throw Error('Fixture API failure'); return service.getSearchSettings(...args); } },
  '../services/suggestionBlacklist.server.js': { getActiveSuggestionBlacklist: async () => state.blacklist },
  '../utils/suggestionBlacklist.js': blacklist, '../services/rateLimiter.server': { rateLimit: async () => true },
});
export function sql(args) {
  const result = spawnSync(path.join(config.bin, process.platform === 'win32' ? 'psql.exe' : 'psql'), ['-h', '127.0.0.1', '-p', String(config.port), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.error?.message);
}
