import { createHash } from 'node:crypto';

const validShop = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const pendingStates = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export const sizeMappingBackfillJobId = shop =>
  'size-mapping-backfill-' + createHash('sha256').update(shop).digest('hex');

export async function scheduleUnclassifiedSizeMappings(database, queue) {
  const sessions = await database.session.findMany({ where: { isOnline: false },
    select: { shop: true }, distinct: ['shop'] });
  let queued = 0, pending = 0;
  for (const { shop } of sessions) {
    if (!validShop.test(shop || '')) continue;
    const unclassified = await database.variant.findFirst({ where: {
      product: { shop, status: 'active' }, OR: [
        { sizeUsNumeric: null, sizeMappingFlag: null },
        { sizeMappingFlag: 'REQUIRES_REINDEX' },
      ],
    }, select: { id: true } });
    if (!unclassified) continue;
    const id = sizeMappingBackfillJobId(shop);
    const existing = await queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (pendingStates.has(state)) { pending++; continue; }
      await existing.remove();
    }
    await queue.add('SIZE_MAPPING_REBUILD', { shop, cursor: null }, { jobId: id, attempts: 5,
      backoff: { type: 'exponential', delay: 15000 }, removeOnComplete: true });
    queued++;
  }
  return { checked: sessions.length, queued, pending };
}
