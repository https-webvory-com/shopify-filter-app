import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const shop = "thedressoutlet.myshopify.com";
  const count = await prisma.product.count({
    where: { shop, bestSellingScore: { gt: 0 } }
  });

  console.log(`Products with bestSellingScore > 0: ${count}`);

  const topProducts = await prisma.product.findMany({
    where: { shop },
    orderBy: { bestSellingScore: "desc" },
    take: 5,
    select: { title: true, bestSellingScore: true }
  });

  console.log("Top 5 products by score:");
  topProducts.forEach(p => console.log(`${p.title}: ${p.bestSellingScore}`));
}

run().then(() => process.exit(0));
