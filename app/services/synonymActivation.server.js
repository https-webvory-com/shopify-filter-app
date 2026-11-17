import {createHash, randomUUID} from 'node:crypto';
import prisma from '../db.server.js';
import redis from './redis.server.js';
import {synonymQueue} from './queue.server.js';
import {buildSynonymDictionary} from './synonyms.server.js';
import {syncConfiguredSearchSynonyms, resetSearchIndexContext} from './searchIndex.server.js';
import {DEFAULT_SEARCH_SETTINGS} from '../utils/searchSettings.js';

const key = (shop, kind) => `synonymActivation:${shop}:${kind}`;
const validShop = shop => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
async function snapshot(shop, rows) {
  if (!validShop(shop)) throw Error('Invalid shop');
  const [rules, setting] = await Promise.all([
    rows || prisma.synonym.findMany({where: {shop, isActive: true}}),
    prisma.searchSetting.findUnique({where: {shop}, select: {config: true}}),
  ]);
  const dictionary = buildSynonymDictionary(rules.filter(row => row.isActive !== false));
  const state = setting?.config?._index || {};
  const indexes = [...new Set([state.active?.uid, state.build?.initialized && state.build.uid].filter(Boolean))].sort();
  const canonical = Object.keys(dictionary).sort().map(word => [word, [...dictionary[word]].sort()]);
  return {dictionary, hasSettings: !!setting, indexes,
    revision: createHash('sha256').update(JSON.stringify([canonical, indexes])).digest('hex')};
}

export async function queueSynonymActivation(shop) {
  if (!validShop(shop)) throw Error('Invalid shop');
  // Also serializes workers during rolling deployments, preventing an older
  // dictionary from finishing after a newer one. No catalog jobs use this lane.
  await synonymQueue.setGlobalConcurrency(1);
  const job = await synonymQueue.add('APPLY_SYNONYMS', {shop}, {
    jobId: randomUUID(), delay: 1500, attempts: 5,
    backoff: {type: 'exponential', delay: 2000},
    removeOnComplete: {age: 86400, count: 1000}, removeOnFail: {age: 604800, count: 1000},
  });
  await redis.set(key(shop, 'job'), job.id);
  return job.id;
}

export async function getSynonymActivationStatus(shop, rows) {
  const current = await snapshot(shop, rows);
  const [applied, jobId] = await Promise.all([redis.get(key(shop, 'applied')), redis.get(key(shop, 'job'))]);
  const base = {revision: current.revision, jobId};
  if (applied === current.revision) return {...base, phase: 'active'};
  if (!jobId) return {...base, phase: 'idle'}; // Existing rules have no recorded background job.
  const job = await synonymQueue.getJob(jobId);
  const state = job && await job.getState();
  if (!state || ['failed', 'completed', 'unknown'].includes(state)) return {...base, phase: 'failed'};
  return {...base, phase: 'applying'};
}

export async function processSynonymActivation({shop}) {
  const current = await snapshot(shop);
  if (await redis.get(key(shop, 'applied')) === current.revision) return {unchanged: true};
  // Update settings on existing merchant indexes only. Never schedule a
  // product sync, catalog rebuild or a shared-index synonym update here.
  // A previous version must not appear active while an intervening update is
  // in flight (including an edit that reverts back to that previous version).
  await redis.del(key(shop, 'applied'));
  if (current.indexes.length) await syncConfiguredSearchSynonyms(shop, current.dictionary);
  else {
    // Shared-index searches already expand only this shop's saved rules into
    // tenant-filtered query branches. Enable that existing path for a first
    // synonym without changing shared settings or building a private catalog.
    if (!current.hasSettings) await prisma.searchSetting.upsert({where: {shop},
      create: {shop, config: DEFAULT_SEARCH_SETTINGS}, update: {}});
    await resetSearchIndexContext(shop);
  }
  if ((await snapshot(shop)).revision !== current.revision) throw Error('Synonyms changed during activation; retrying the latest saved version');
  await redis.set(key(shop, 'applied'), current.revision);
  return {applied: true};
}
