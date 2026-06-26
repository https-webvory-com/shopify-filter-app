import { PrismaClient } from "@prisma/client";
import { Meilisearch } from "meilisearch";

const prisma = new PrismaClient();
const client = new Meilisearch({
  host: "http://127.0.0.1:7700",
  apiKey: "masterKey",
});

async function main() {
  const index = client.index("products");
  const meiliRes = await index.search("", {
    facets: ["*"],
    limit: 1,
  });
  
  console.log("Total tags returned:", Object.keys(meiliRes.facetDistribution.tags || {}).length);
  const lengthTags = Object.keys(meiliRes.facetDistribution.tags || {}).filter(t => t.toLowerCase().includes('length'));
  console.log("Length tags:", lengthTags);

  const sleeveTags = Object.keys(meiliRes.facetDistribution.tags || {}).filter(t => t.toLowerCase().includes('sleeve'));
  console.log("Sleeve tags:", sleeveTags);

  const skirtTags = Object.keys(meiliRes.facetDistribution.tags || {}).filter(t => t.toLowerCase().includes('skirt'));
  console.log("Skirt tags:", skirtTags);
}

main().catch(console.error).finally(() => prisma.$disconnect());
