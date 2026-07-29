import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const count = await prisma.product.count();
  console.log("Total Products:", count);
  const shops = await prisma.product.groupBy({
    by: ['shop'],
    _count: true
  });
  console.log("Shops in Product:", JSON.stringify(shops, null, 2));

  const rules = await prisma.merchandisingRule.findMany({
    include: { conditions: true }
  });
  console.log("Rules:", JSON.stringify(rules, null, 2));

  const pins = await prisma.pinnedProductRule.findMany();
  console.log("Pins:", JSON.stringify(pins, null, 2));
}

check().finally(() => prisma.$disconnect());
