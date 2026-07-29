import fetch from 'node-fetch';
import prisma from '../app/db.server.js';
import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

async function test() {
  const shop = 'thedressoutlet.myshopify.com';
  const collectionTitle = 'Black Tie Dresses';

  // 1. Fetch all matching rules for Black Tie Dresses from DB
  const now = new Date();
  const allRules = await prisma.merchandisingRule.findMany({
    where: {
      shop,
      status: true,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  const targetLower = collectionTitle.toLowerCase().trim();
  const targetHandle = targetLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const matchingRules = allRules.filter((rule) => {
    if (!rule.collections || rule.collections.length === 0) return true;
    return rule.collections.some((c) => {
      if (!c) return false;
      const cLower = c.toLowerCase().trim();
      const cHandle = cLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return cLower === targetLower || cHandle === targetHandle || cLower === targetHandle || cHandle === targetLower;
    });
  });

  console.log("Matching Rules count for Black Tie Dresses:", matchingRules.length);
  matchingRules.forEach(r => console.log(" - Rule:", r.name, "Conditions count:", r.conditions.length));

  // Merge conditions across all matching rules
  const combinedConditions = [];
  matchingRules.forEach(r => combinedConditions.push(...r.conditions));
  const combinedRule = { conditions: combinedConditions };

  // Fetch live API products payload
  const res = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now());
  const apiData = await res.json();

  const sorted = applyMerchandisingRules(apiData.products, combinedRule, "best-selling", null, []);
  
  console.log("\n--- Top 10 Products After Combined Rules ---");
  sorted.slice(0, 10).forEach((p, i) => {
    console.log(`${i+1}. ${p.title} | Score: ${p.merchandisingScore} | merchImg: ${p.merchandisingImage ? 'YES' : 'null'}`);
  });
}

test().catch(console.error);
