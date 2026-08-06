import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const lineItems = await prisma.syncJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1
  });
  console.log("Latest Sync Job:", lineItems);
}

run();
