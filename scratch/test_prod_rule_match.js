import prisma from '../app/db.server.js';
import { getActiveRuleForCollection } from '../app/services/merchandising.server.js';

async function test() {
  const shop = 'thedressoutlet.myshopify.com';
  const rules = await prisma.merchandisingRule.findMany({
    where: { shop },
    include: { conditions: true }
  });
  console.log("Total Merchandising Rules in DB for shop:", rules.length);
  rules.forEach(r => {
    console.log(`Rule ID: ${r.id}, Name: ${r.name}, Status: ${r.status}, Collections:`, r.collections);
    console.log("  Conditions:", JSON.stringify(r.conditions, null, 2));
  });

  const activeRule = await getActiveRuleForCollection(shop, 'Black Tie Dresses');
  console.log("Active Rule for Black Tie Dresses:", activeRule ? activeRule.id : null);
}

test().catch(console.error);
