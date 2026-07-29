import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const shop = 'thedressoutlet.myshopify.com';
  
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop, collections: { has: "Red Formal Dresses" } },
    include: { conditions: true }
  });
  console.log("Rules for Red Formal Dresses:", JSON.stringify(rules, null, 2));

  const rulesBlack = await prisma.merchandisingRule.findMany({
    where: { shop, collections: { has: "Black Formal Dresses" } },
    include: { conditions: true }
  });
  console.log("Rules for Black Formal Dresses:", JSON.stringify(rulesBlack, null, 2));

  const allRules = await prisma.merchandisingRule.findMany({
    where: { shop },
    include: { conditions: true }
  });
  console.log("Total Merchandising Rules:", allRules.length);
  
  // Find the specific product to check its variants in DB
  const product = await prisma.product.findUnique({
    where: { id: "gid://shopify/Product/15023349465459" },
    include: { variants: true }
  });
  console.log("Product variants:", JSON.stringify(product?.variants.map(v => ({ title: v.title, option1: v.option1, imageUrl: v.imageUrl })), null, 2));

}
check().finally(() => prisma.$disconnect());
