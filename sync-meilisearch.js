import { PrismaClient } from "@prisma/client";
import { Meilisearch } from "meilisearch";

const prisma = new PrismaClient();
const client = new Meilisearch({
  host: "http://127.0.0.1:7700",
  apiKey: "masterKey",
});

async function main() {
  const shop = process.argv[2] || "collection-filter-pro.myshopify.com";
  console.log(`Syncing products for shop: ${shop}`);

  const index = client.index("products");

  // Fetch all active products
  console.log("Fetching products from database...");
  const products = await prisma.product.findMany({
    where: { shop, status: "active" },
    include: {
      variants: true,
      collections: { select: { collectionId: true } },
      metafields: true,
    },
  });

  console.log(`Found ${products.length} products. Formatting for Meilisearch...`);

  const documents = products.map((p) => {
    // Determine overall availability
    const available = p.variants.some((v) => v.available);

    // Format options as option_Name: [values]
    const formattedOptions = {};
    p.options.forEach((opt) => {
      // Assuming values is an array or string
      const values = Array.isArray(opt.values) ? opt.values : [opt.values];
      formattedOptions[`option_${opt.name}`] = values;
    });

    // Format metafields as metafield_namespace_key: value
    const formattedMetafields = {};
    p.metafields.forEach((m) => {
      formattedMetafields[`metafield_${m.namespace}.${m.key}`] = m.value;
    });

    return {
      id: p.id.split("/").pop(),
      shop: p.shop,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      priceMin: parseFloat(p.priceMin),
      priceMax: parseFloat(p.priceMax),
      tags: p.tags,
      collections: p.collections.map((c) => c.collectionId),
      available,
      createdAt: p.createdAt.getTime(),
      bestSellingRank: p.bestSellingRank || 999999,
      ...formattedOptions,
      ...formattedMetafields,
    };
  });

  console.log("Pushing to Meilisearch...");
  const BATCH_SIZE = 5000;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const task = await index.addDocuments(batch);
    console.log(`Added batch ${i} to ${i + batch.length}. Task: ${task.taskUid}`);
  }

  // Update filterable attributes dynamically based on options/metafields
  console.log("Updating filterable attributes...");
  
  // Collect all unique option and metafield keys across all products
  const dynamicKeys = new Set();
  documents.forEach(doc => {
      Object.keys(doc).forEach(key => {
          if (key.startsWith('option_') || key.startsWith('metafield_')) {
              dynamicKeys.add(key);
          }
      });
  });

  const filterableAttributes = [
    "shop",
    "vendor",
    "productType",
    "tags",
    "collections",
    "available",
    "priceMin",
    ...Array.from(dynamicKeys)
  ];

  await index.updateFilterableAttributes(filterableAttributes);
  
  // Set Searchable Attributes to ensure all these fields are searched
  // The order determines relevance (e.g., Title matches rank higher than Tags)
  const searchableAttributes = [
    "title",
    "productType",
    "vendor",
    "collections",
    ...Array.from(dynamicKeys), // This includes option_Color, option_Size, etc.
    "tags"
  ];
  await index.updateSearchableAttributes(searchableAttributes);

  const sortableAttributes = ["priceMin", "createdAt", "bestSellingRank"];
  await index.updateSortableAttributes(sortableAttributes);

  await index.updateFaceting({ maxValuesPerFacet: 100000 });

  console.log("Sync complete! Check Meilisearch UI or wait for tasks to process.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
