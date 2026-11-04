import prisma from '../db.server.js';

export function analyticsRetentionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
  return cutoff;
}

export async function expireSearchAnalytics(database = prisma, now = new Date()) {
  const cutoff = analyticsRetentionCutoff(now);
  let deleted = 0;
  // Bounded batches avoid one long delete transaction on a busy storefront DB.
  for (let batch = 0; batch < 10; batch++) {
    const count = await database.$executeRaw`
      WITH expired AS (
        SELECT "eventId" FROM "SearchAnalyticsEvent"
        WHERE "at" < ${cutoff}
        ORDER BY "at" ASC LIMIT 10000
      )
      DELETE FROM "SearchAnalyticsEvent" event
      USING expired WHERE event."eventId" = expired."eventId"
    `;
    deleted += count;
    if (count < 10000) break;
  }
  return { cutoff, deleted };
}
