import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const allRules = await prisma.merchandisingRule.findMany({
    include: { conditions: true }
  });
  console.log("Total Merchandising Rules:", allRules.length);
  for (const rule of allRules) {
     console.log(`Shop: ${rule.shop} | Collections: ${rule.collections}`);
  }

  const allPins = await prisma.pinnedProductRule.findMany();
  console.log("Total Pinning Rules:", allPins.length);
  for (const pin of allPins) {
     console.log(`Shop: ${pin.shop} | Collections: ${pin.collections} | ApplyToAll: ${pin.applyToAll}`);
  }

}
check().finally(() => prisma.$disconnect());
