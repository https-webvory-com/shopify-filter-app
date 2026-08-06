import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const shop = "thedressoutlet.myshopify.com";
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop, status: true },
    include: { conditions: true },
    orderBy: { createdAt: "desc" }
  });

  console.log(`Total rules: ${rules.length}`);
  
  rules.forEach(r => {
    if (r.collections && r.collections.length > 0) {
      const match = r.collections.some(c => String(c).toLowerCase().includes("formal"));
      if (match) {
        console.log(`\nRule: ${r.name} (collections: ${JSON.stringify(r.collections)})`);
        console.log(`Conditions:`);
        r.conditions.forEach((c, i) => {
          console.log(`  ${i+1}. Action: ${c.action}, Type: ${c.type}, Value: ${c.value}, Operand: ${c.operand}, Operator: ${c.operator}`);
        });
      }
    }
  });
}

run().then(() => process.exit(0));
