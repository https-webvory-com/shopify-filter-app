import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const shop = 'thedressoutlet.myshopify.com';
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop },
    include: { conditions: true }
  });
  console.log("Merchandising Rules:", JSON.stringify(rules, null, 2));

  const pinningRules = await prisma.pinnedProductRule.findMany({
    where: { shop }
  });
  console.log("Pinning Rules:", JSON.stringify(pinningRules, null, 2));
}
check().finally(() => prisma.$disconnect());
