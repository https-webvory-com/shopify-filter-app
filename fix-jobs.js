import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const jobs = await prisma.syncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 5
  });
  console.log("Recent jobs:", jobs);

  for (const job of jobs) {
    if (job.totalProducts === null) {
      console.log(`Setting job ${job.id} cursor to ORDER_SYNC`);
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { cursor: "ORDER_SYNC" }
      });
    } else {
      console.log(`Setting job ${job.id} cursor to PRODUCT_SYNC`);
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { cursor: "PRODUCT_SYNC" }
      });
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch(console.error);
