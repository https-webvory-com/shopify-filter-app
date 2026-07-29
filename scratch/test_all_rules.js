import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop: "thedressoutlet.myshopify.com", status: true },
    include: { conditions: true }
  });

  console.log("Found Active Rules:", rules.length);
  for (const r of rules) {
    console.log(`Rule: "${r.name}", Collections:`, r.collections);
    console.log("  Conditions:", r.conditions);
  }
}

main().catch(console.error);
