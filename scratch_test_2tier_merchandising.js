import { Meilisearch } from "meilisearch";
import { buildMeiliRuleFilter } from "./app/services/merchandising.server.js";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function test2Tier(page = 1, limit = 25) {
  const index = client.index("products");
  
  const activeRuleConditions = [
    { action: "Dynamic", field: "Color (product option)", value: "Red", operator: "Add", operand: "99999" }
  ];
  const baseFilters = ["collection_titles IN ['Red Formal Dresses']"];
  const ruleFilters = buildMeiliRuleFilter(activeRuleConditions);

  console.log(`\n=== TESTING PAGE ${page} ===`);
  console.log("Rule Filters:", ruleFilters);

  // 1. Fetch Tier 1 hits (Matching Rule)
  const tier1Res = await index.search("", {
    filter: [...baseFilters, ...ruleFilters],
    limit: limit,
    offset: (page - 1) * limit,
  });

  console.log("Tier 1 Hits Length:", tier1Res.hits.length);
  console.log("Tier 1 Estimated Total Hits:", tier1Res.estimatedTotalHits);

  let finalHits = [...tier1Res.hits];

  // If Tier 1 didn't fill the page (e.g. on last page of rule items), fill with Tier 2
  if (finalHits.length < limit) {
    const remainingSlots = limit - finalHits.length;
    const tier2Offset = Math.max(0, (page - 1) * limit - (tier1Res.estimatedTotalHits || 0));
    console.log(`Fetching ${remainingSlots} items from Tier 2 at offset ${tier2Offset}...`);
    
    const tier2Res = await index.search("", {
      filter: baseFilters,
      limit: remainingSlots,
      offset: tier2Offset,
    });
    finalHits = [...finalHits, ...tier2Res.hits];
  }

  console.log(`Total Hits for Page ${page}:`, finalHits.length);
  console.log("Top 5 Hits on Page", page, ":");
  finalHits.slice(0, 5).forEach((h, i) => console.log(` ${i+1}. [${h.id}] ${h.title}`));
}

async function run() {
  await test2Tier(1, 25);
  await test2Tier(2, 25);
  await test2Tier(3, 25);
}

run();
