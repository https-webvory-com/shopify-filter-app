import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '../../scratch/banner-prisma/index.js';
import { Script } from 'node:vm';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import * as schema from '../../app/utils/customization.js';
const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
if (new URL(config.url).hostname !== '127.0.0.1' || Number(new URL(config.url).port) !== config.port || !path.resolve(config.directory).startsWith(path.resolve('scratch') + path.sep)) throw Error('Customization tests require an isolated local database');
export const db = new PrismaClient({ datasources: { db: { url: config.url } } });
export const shop = 'customization-fixture.myshopify.com';
export const service = await loadModule('app/services/customization.server.js', { '../db.server': { default: db }, 'node:vm': { Script }, '../utils/customization.js': schema });
export const themes = [{ node: { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Draft theme', role: 'UNPUBLISHED' } }, { node: { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Published theme', role: 'MAIN' } }];
export const admin = await loadModule('app/routes/app.settings.customization.jsx', {
  react: {}, 'react-router': {}, '@shopify/shopify-app-react-router/server': { boundary: {} },
  '../utils/customization.js': schema, '../services/customization.server.js': service, '../graphql/queries': { GET_THEME: 'themes' },
  '../shopify.server': { authenticate: { admin: async () => ({ session: { shop }, admin: { graphql: async () => ({ json: async () => ({ data: { themes: { edges: themes } } }) }) } }) } },
});
export const state = { fail: false, slow: false };
export const api = await loadModule('app/routes/api.customization.jsx', {
  '../utils/customization.js': schema, '../services/rateLimiter.server': { rateLimit: async () => true },
  '../services/customization.server.js': { getCustomization: async (...args) => { if (state.fail) throw Error('Fixture API unavailable'); return service.getCustomization(...args); } },
});
export function sql(args) {
  const result = spawnSync(path.join(config.bin, process.platform === 'win32' ? 'psql.exe' : 'psql'), ['-h', '127.0.0.1', '-p', String(config.port), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.error?.message);
}
