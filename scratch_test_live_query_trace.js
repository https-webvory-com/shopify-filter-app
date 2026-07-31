import prisma from "./app/db.server.js";
import { Meilisearch } from "meilisearch";
import { 
  getActiveRuleForCollection, 
  buildMeiliRuleFilter,
  applyMerchandisingRules 
} from "./app/services/merchandising.server.js";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";
const meiliClient = new Meilisearch({ host: meiliHost, apiKey: meiliKey });

async function run() {
  const shop = "thedressoutlet.myshopify.com";
  const collectionTitle = "Red Formal Dresses";

  const activeRule = await getActiveRuleForCollection(shop, collectionTitle, []);
  console.log("=== ACTIVE RULE FOR COLLECTION ===");
  console.log("Rule Name:", activeRule?.name);
  console.log("Rule Conditions:", JSON.stringify(activeRule?.conditions, null, 2));

  const ruleMeiliFilters = buildMeiliRuleFilter(activeRule?.conditions);
  console.log("\n=== RULE MEILI FILTERS ===");
  console.log(ruleMeiliFilters);

  const baseFilters = [`collection_titles IN ['Red Formal Dresses']`];
  const tier1Filter = ruleMeiliFilters.length > 0 ? [...baseFilters, ...ruleMeiliFilters] : baseFilters;

  console.log("\n=== TIER 1 MEILISEARCH FILTER ===");
  console.log(tier1Filter);

  const index = meiliClient.index("products");
  const res = await index.search("", {
    filter: tier1Filter,
    limit: 25,
    offset: 0
  });

  console.log("\n=== MEILISEARCH HITS ===");
  console.log("Hits returned:", res.hits.length);
  res.hits.slice(0, 10).forEach((h, i) => {
    console.log(`${i+1}. [${h.id}] ${h.title}`);
  });

  const formattedHits = res.hits.map(h => ({
    ...h,
    id: `gid://shopify/Product/${h.id}`,
    variants: (h.variantPrices || []).map(v => ({ ...v }))
  }));

  const sorted = applyMerchandisingRules(formattedHits, activeRule, "best-selling", null, [], {});

  console.log("\n=== AFTER APPLYING MERCHANDISING RULES (TOP 10) ===");
  sorted.slice(0, 10).forEach((p, i) => {
    console.log(`${i+1}. [${p.id}] ${p.title} -> Score: ${p.merchandisingScore}`);
  });

  await prisma.$disconnect();
}

run().catch(e => {
  console.error("Error:", e);
  prisma.$disconnect();
});
