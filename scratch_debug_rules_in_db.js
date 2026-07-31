import prisma from "./app/db.server.js";

async function run() {
  const shop = "thedressoutlet.myshopify.com";

  const rules = await prisma.merchandisingRule.findMany({
    where: { shop },
    include: { conditions: true }
  });

  console.log(`Found ${rules.length} total Merchandising Rules in database:`);
  rules.forEach((r, idx) => {
    console.log(`\nRule ${idx + 1}: ID=${r.id}, Name="${r.name}", Status=${r.status}`);
    console.log("  Collections:", JSON.stringify(r.collections));
    console.log("  Conditions Count:", r.conditions?.length);
    (r.conditions || []).forEach(c => {
      console.log(`    - Action: ${c.action}, Field: ${c.field}, Value: ${c.value}, Op: ${c.operator}, Operand: ${c.operand}`);
    });
  });

  await prisma.$disconnect();
}

run().catch(e => {
  console.error("Error:", e);
  prisma.$disconnect();
});
