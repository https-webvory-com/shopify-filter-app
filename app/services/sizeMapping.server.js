import { createHash, randomUUID } from 'node:crypto';
import prisma from '../db.server.js';
import { productSyncQueue } from './productSyncQueue.server.js';
import { rebuildSizeMappingPage as rebuildPage } from '../utils/sizeMappingRebuild.js';
import { scheduleUnclassifiedSizeMappings } from '../utils/sizeMappingScheduler.js';
export { normalizedSizeSource } from '../utils/sizeMappingRebuild.js';

const jobId = shop => 'size-mapping-' + createHash('sha256').update(shop).digest('hex') + '-' + randomUUID();

export async function enqueueSizeMappingRebuild(shop) {
  return productSyncQueue.add('SIZE_MAPPING_REBUILD', { shop, cursor: null }, { jobId: jobId(shop), attempts: 5,
    backoff: { type: 'exponential', delay: 15000 }, removeOnComplete: true });
}

export async function rebuildSizeMappingPage(job, database = prisma) {
  return rebuildPage(job, database);
}

export async function scheduleUnclassifiedSizeMappingRebuilds() {
  return scheduleUnclassifiedSizeMappings(prisma, productSyncQueue);
}
