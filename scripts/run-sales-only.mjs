import prisma from '../app/db.server.js';
import { syncHistoricalOrders } from '../app/services/orders.server.js';

const shop = process.argv[2];
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || ''))
  throw Error('Pass one Shopify shop domain');

try {
  const active = await prisma.syncJob.findFirst({
    where: { shop, kind: 'ORDERS', status: 'IN_PROGRESS',
      updatedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    select: { id: true },
  });
  if (active) throw Error(`Sales sync already active for ${shop}`);
  console.log(`Starting sales-only sync for ${shop}`);
  if (await syncHistoricalOrders(shop) !== true) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
