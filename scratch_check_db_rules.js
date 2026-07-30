import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  try {
    console.log("Checking collections in DB...");
    const colles = await prisma.collection.findMany({
      where: { shop: "thedressoutlet.myshopify.com" },
      select: { id: true, handle: true, title: true }
    });
    console.log(`Found ${colles.length} collections.`);
    const redColl = colles.find(c => c.handle === "red-formal-dresses" || c.title.toLowerCase().includes("red formal"));
    console.log("Red collection in DB:", redColl);

    console.log("\nChecking PinnedProductRules in DB...");
    const pinRules = await prisma.pinnedProductRule.findMany({
      where: { shop: "thedressoutlet.myshopify.com" }
    });
    console.log(`Found ${pinRules.length} pin rules.`);
    pinRules.forEach(r => {
      console.log(`PinRule: "${r.name}" | Type: ${r.ruleType} | Status: ${r.status} | Collections:`, r.collections);
      if (r.products) {
        try {
          const prods = typeof r.products === "string" ? JSON.parse(r.products) : r.products;
          console.log(`   Pinned products count: ${prods.length}, First 5 IDs:`, prods.slice(0, 5).map(p => p.id));
        } catch(e) {}
      }
    });

    console.log("\nChecking MerchandisingRules in DB...");
    const merchRules = await prisma.merchandisingRule.findMany({
      where: { shop: "thedressoutlet.myshopify.com" },
      include: { conditions: true }
    });
    console.log(`Found ${merchRules.length} merch rules.`);
    merchRules.forEach(r => {
      console.log(`MerchRule: "${r.name}" | Status: ${r.status} | Collections:`, r.collections);
      console.log(`   Conditions:`, r.conditions);
    });

  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
