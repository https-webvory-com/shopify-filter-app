const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop: 'thedressoutlet.myshopify.com' }
  });
  console.log(JSON.stringify(rules, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
