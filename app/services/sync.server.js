import prisma from "../db.server";
import meiliClient from "./meiliClient.server";

/**
 * Format products and push to Meilisearch index.
 * Expects products to have variants, collections, and metafields included.
 */
export async function formatAndPushToMeili(products) {
  if (!products || products.length === 0) return;

  const documents = products.map((p) => {
    // Determine overall availability
    const available = p.variants ? p.variants.some((v) => v.available) : false;

    // Format options as option_Name: [values]
    const formattedOptions = {};
    if (p.options) {
      p.options.forEach((opt) => {
        const values = Array.isArray(opt.values) ? opt.values : [opt.values];
        formattedOptions[`option_${opt.name}`] = values;
      });
    }

    // Format metafields as metafield_namespace_key: value
    const formattedMetafields = {};
    if (p.metafields) {
      p.metafields.forEach((m) => {
        formattedMetafields[`metafield_${m.namespace}.${m.key}`] = m.value;
      });
    }

    return {
      id: p.id.split("/").pop(),
      shop: p.shop,
      title: p.title || "",
      handle: p.handle || "",
      vendor: p.vendor || "",
      productType: p.productType || "",
      priceMin: parseFloat(p.priceMin),
      priceMax: parseFloat(p.priceMax),
      tags: p.tags || [],
      collections: p.collections
        ? p.collections.map((c) => c.collectionId)
        : [],
      available,
      status: p.status ? p.status.toUpperCase() : "ACTIVE",
      createdAt: p.createdAt ? p.createdAt.getTime() : Date.now(),
      // ✅ All product images — no limit, full gallery
      images: Array.isArray(p.images) ? p.images : [],
      // ✅ Product options array for storefront swatch rendering
      options: p.options
        ? p.options.map((opt) => ({
            name: opt.name,
            values: Array.isArray(opt.values) ? opt.values : [opt.values],
          }))
        : [],
      // ✅ Variant prices + options for price display and swatch rendering
      // This eliminates the need for a second Postgres query on every filter/search request
      variantPrices: p.variants
        ? p.variants.map((v) => ({
            id: v.id ? v.id.split("/").pop() : "",
            price: parseFloat(v.price),
            compareAtPrice: v.compareAtPrice
              ? parseFloat(v.compareAtPrice)
              : null,
            available: v.available !== undefined ? v.available : true,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
            imageUrl: v.imageUrl || null,
          }))
        : [],
      ...formattedOptions,
      ...formattedMetafields,
    };
  });

  try {
    const index = meiliClient.index("products");
    const task = await index.addDocuments(documents);
    console.log(
      `CFP: Pushed ${documents.length} products to Meilisearch (Task ID: ${task.taskUid})`,
    );
  } catch (error) {
    console.error("CFP: Failed to push to Meilisearch", error);
  }
}

/**
 * Extract dynamic keys from Prisma and update Meilisearch index settings.
 */
async function updateMeiliSettings(shop) {
  try {
    const index = meiliClient.index("products");
    const dynamicKeys = new Set();

    // Get all options
    const products = await prisma.product.findMany({
      where: { shop },
      select: { options: true },
    });
    for (const p of products) {
      for (const opt of p.options || []) {
        if (opt.name) dynamicKeys.add(`option_${opt.name}`);
      }
    }

    // Get all metafields
    const metafields = await prisma.productMetafield.findMany({
      where: { product: { shop } },
      select: { namespace: true, key: true },
    });
    for (const m of metafields) {
      if (m.namespace && m.key) {
        dynamicKeys.add(`metafield_${m.namespace}.${m.key}`);
      }
    }

    const filterableAttributes = [
      "shop",
      "vendor",
      "productType",
      "tags",
      "collections",
      "collection_titles",
      "available",
      "status",
      "priceMin",
      ...Array.from(dynamicKeys),
    ];

    const searchableAttributes = [
      "title",
      "handle",
      "productType",
      "vendor",
      "tags",
      ...Array.from(dynamicKeys),
    ];

    const sortableAttributes = ["priceMin", "createdAt", "title"];

    await index.updateFilterableAttributes(filterableAttributes);
    await index.updateSearchableAttributes(searchableAttributes);
    await index.updateSortableAttributes(sortableAttributes);
    await index.updateFaceting({ maxValuesPerFacet: 100000 });

    if (process.env.GEMINI_API_KEY) {
      try {
        await index.updateEmbedders({
          default: {
            source: "rest",
            url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${process.env.GEMINI_API_KEY}`,
            request: {
              model: "models/gemini-embedding-2",
              content: {
                parts: [{ text: "{{text}}" }],
              },
            },
            response: {
              embedding: {
                values: "{{embedding}}",
              },
            },
            documentTemplate:
              "A {{productType}} named {{title}} by {{vendor}}. Tags: {{tags | join: ', '}}",
          },
        });
        console.log(`CFP: AI Vector embedder (Gemini) configured for ${shop}`);
      } catch (embedErr) {
        // vector store experimental feature not enabled on this Meilisearch instance — skip silently
        if (embedErr?.cause?.code === 'feature_not_enabled') {
          console.warn(`CFP: Meilisearch vector store not enabled — skipping embedder config. Enable with --experimental-enable-vector-store`);
        } else {
          throw embedErr; // re-throw unexpected errors
        }
      }
    }

    console.log(`CFP: Meilisearch settings updated successfully for ${shop}`);
  } catch (error) {
    console.error(
      `CFP: Failed to update Meilisearch settings for ${shop}`,
      error,
    );
  }
}

/**
 * Auto-seed FilterSetting records for every unique product option name found in the shop.
 * Called after every sync so new options (Color, Size, etc.) appear in admin automatically.
 */
async function autoSeedOptionFilters(shop) {
  const products = await prisma.product.findMany({
    where: { shop },
    select: { options: true },
  });

  const seen = new Set();
  for (const p of products) {
    for (const opt of p.options || []) {
      if (opt.name) seen.add(opt.name);
    }
  }

  if (seen.size === 0) return;

  // ✅ OPTIMIZED: Single query to find ALL existing option filters at once (no N+1 loop)
  const existingFilters = await prisma.filterSetting.findMany({
    where: { shop, type: "option" },
    select: { key: true },
  });
  const existingKeys = new Set(existingFilters.map((f) => f.key));

  const newOptions = Array.from(seen).filter((name) => !existingKeys.has(name));
  if (newOptions.length === 0) return;

  const lastSetting = await prisma.filterSetting.findFirst({
    where: { shop },
    orderBy: { order: "desc" },
  });
  let nextOrder = (lastSetting?.order ?? 5) + 1;

  // ✅ OPTIMIZED: Single createMany instead of N individual creates
  await prisma.filterSetting.createMany({
    data: newOptions.map((optName, i) => ({
      shop,
      type: "option",
      key: optName,
      label: optName,
      order: nextOrder + i,
      isEnabled: true,
    })),
    skipDuplicates: true,
  });

  console.log(`CFP: Auto-seeded ${newOptions.length} new option filters for ${shop}`);
}

/**
 * Sync all products, variants, collections, and metafields for a shop from Shopify to PostgreSQL.
 * @param {string} shop - The shop domain
 * @param {object} admin - The authenticated Shopify Admin API client
 */
export async function syncProducts(shop, admin) {
  console.log(`CFP: Initializing background product sync for ${shop}...`);

  // Delete previous sync jobs for this shop to keep the database clean
  await prisma.syncJob.deleteMany({
    where: { shop },
  });

  // Create a pending sync job
  const job = await prisma.syncJob.create({
    data: {
      shop,
      status: "IN_PROGRESS",
    },
  });

  // Start background processing without awaiting it
  processSyncChunk(job.id, shop, admin).catch((err) => {
    console.error(`CFP: Background sync failed for ${shop}`, err);
  });

  return { jobId: job.id, message: "Sync started in background" };
}

async function processSyncChunk(jobId, shop, admin) {
  let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "IN_PROGRESS") return;

  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  let publishedCollectionIds = null;
  try {
    publishedCollectionIds = new Set();
    let hasNext = true;
    let colCursor = null;
    while (hasNext) {
      const colQuery = `#graphql
         query getPublishedCollections($cursor: String) {
           collections(first: 250, after: $cursor, query: "published_status:published") {
             pageInfo { hasNextPage endCursor }
             nodes { id }
           }
         }
       `;
      const colRes = await admin.graphql(colQuery, {
        variables: { cursor: colCursor },
      });
      const colData = await colRes.json();
      for (const c of colData.data.collections.nodes) {
        publishedCollectionIds.add(c.id);
      }
      hasNext = colData.data.collections.pageInfo.hasNextPage;
      colCursor = colData.data.collections.pageInfo.endCursor;
    }
    console.log(
      `CFP: Found ${publishedCollectionIds.size} published collections for ${shop}`,
    );
  } catch (e) {
    console.error(
      "CFP: Error fetching published collections, skipping filter",
      e,
    );
    publishedCollectionIds = null;
  }

  const query = `#graphql
    query getProducts($cursor: String) {
      products(first: 50, after: $cursor, query: "status:active") {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          vendor
          productType
          tags
          totalInventory
          status
          onlineStoreUrl
          images(first: 250) {
            nodes {
              url
            }
          }
          options {
            name
            values
          }
          collections(first: 250) {
            nodes {
              id
              title
              handle
            }
          }
          variants(first: 250) {
            nodes {
              id
              sku
              price
              compareAtPrice
              inventoryQuantity
              availableForSale
              image {
                url
              }
              selectedOptions {
                name
                value
              }
            }
          }
          plusSizeMetafield: metafield(namespace: "custom", key: "plus_size_collection_image") {
            id
            namespace
            key
            value
            type
            reference {
              ... on MediaImage { image { url } }
              ... on GenericFile { url }
            }
          }
          motbMetafield: metafield(namespace: "custom", key: "mother_of_the_bride_collection_image") {
            id
            namespace
            key
            value
            type
            reference {
              ... on MediaImage { image { url } }
              ... on GenericFile { url }
            }
          }
          weddingMetafield: metafield(namespace: "custom", key: "wedding_collection_image") {
            id
            namespace
            key
            value
            type
            reference {
              ... on MediaImage { image { url } }
              ... on GenericFile { url }
            }
          }
          metafields(first: 250) {
            nodes {
              id
              namespace
              key
              value
              type
              reference {
                ... on MediaImage {
                  image {
                    url
                  }
                }
                ... on GenericFile {
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor = job.cursor;

  // We process in a while loop but we save state every chunk
  while (hasNextPage) {
    try {
      const variables = { cursor };

      const response = await admin.graphql(query, { variables });
      const responseJson = await response.json();

      if (responseJson.errors) {
        throw new Error(
          "GraphQL Errors: " + JSON.stringify(responseJson.errors),
        );
      }

      const productsData = responseJson.data?.products;
      if (!productsData || productsData.nodes.length === 0) break;
      const products = productsData.nodes.filter((p) => p.status === "ACTIVE");
      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

      // ✅ OPTIMIZED: Build Meilisearch docs directly from Shopify data (no re-read from DB)
      // and parallelize DB upserts + Meili push for speed
      const meiliDocs = products.map((p) => {
        const available = p.variants.nodes.some((v) => v.availableForSale);
        const prices = p.variants.nodes.map((v) => parseFloat(v.price));
        const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
        const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

        const formattedOptions = {};
        p.options.forEach((opt) => {
          formattedOptions[`option_${opt.name}`] = Array.isArray(opt.values)
            ? opt.values
            : [opt.values];
        });

        const formattedMetafields = {};
        if (p.metafields) {
          if (!p.metafields.nodes) p.metafields.nodes = [];
          if (p.plusSizeMetafield) p.metafields.nodes.push(p.plusSizeMetafield);
          if (p.motbMetafield) p.metafields.nodes.push(p.motbMetafield);
          if (p.weddingMetafield) p.metafields.nodes.push(p.weddingMetafield);

          p.metafields.nodes.forEach((m) => {
            if (m && m.value) {
              let val = m.value;
              if (m.reference && m.reference.image && m.reference.image.url) {
                val = m.reference.image.url;
              } else if (m.reference && m.reference.url) {
                // Fallback if it's a GenericFile instead of MediaImage
                val = m.reference.url;
              }
              formattedMetafields[`metafield_${m.namespace}.${m.key}`] = val;
            }
          });
        }

        return {
          id: p.id.split("/").pop(),
          shop,
          title: p.title || "",
          handle: p.handle || "",
          vendor: p.vendor || "",
          productType: p.productType || "",
          priceMin,
          priceMax,
          tags: p.tags || [],
          collections: p.collections.nodes
            .filter(
              (c) =>
                publishedCollectionIds === null ||
                publishedCollectionIds.has(c.id),
            )
            .map((c) => c.id),
          collection_titles: p.collections.nodes
            .filter(
              (c) =>
                publishedCollectionIds === null ||
                publishedCollectionIds.has(c.id),
            )
            .map((c) => c.title),
          available,
          status: (p.status || "ACTIVE").toUpperCase(),
          createdAt: Date.now(),
          images: p.images.nodes.map((img) => img.url), // all images, no limit
          variantPrices: p.variants.nodes.map((v) => {
            const optionsList = p.options || [];
            let option1 = null,
              option2 = null,
              option3 = null;
            (v.selectedOptions || []).forEach((selOpt) => {
              const idx = optionsList.findIndex((o) => o.name === selOpt.name);
              if (idx === 0) option1 = selOpt.value;
              else if (idx === 1) option2 = selOpt.value;
              else if (idx === 2) option3 = selOpt.value;
            });
            return {
              id: v.id.split("/").pop(),
              price: parseFloat(v.price),
              compareAtPrice: v.compareAtPrice
                ? parseFloat(v.compareAtPrice)
                : null,
              available: v.availableForSale === true,
              option1,
              option2,
              option3,
              imageUrl: v.image?.url || null,
            };
          }),
          ...formattedOptions,
          ...formattedMetafields,
        };
      });

      // ✅ Run DB upserts and Meilisearch push in PARALLEL (not serial)
      await Promise.all([
        // DB upserts sequentially to prevent connection pool exhaustion (Prisma P2028 timeout)
        (async () => {
          for (const product of products) {
            await smartUpsertProduct(shop, product, prisma);
          }
        })(),
        // Meili push (no DB re-read needed anymore!)
        meiliClient
          .index("products")
          .addDocuments(meiliDocs)
          .then((task) => {
            console.log(
              `CFP: Pushed ${meiliDocs.length} docs to Meilisearch (Task ID: ${task.taskUid})`,
            );
          })
          .catch((e) => {
            console.error("CFP: Meilisearch push failed", e);
          }),
      ]);

      // Update Job State
      job = await prisma.syncJob.update({
        where: { id: jobId },
        data: {
          cursor: cursor,
          productsProcessed: { increment: products.length },
          status: hasNextPage ? "IN_PROGRESS" : "COMPLETED",
        },
      });

      console.log(
        `CFP: SyncJob ${jobId} processed ${job.productsProcessed} products so far.`,
      );

      // Small delay to yield event loop and avoid Shopify rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      console.error(`CFP: Error processing chunk for job ${jobId}`, err);
      await prisma.syncJob.update({
        where: { id: jobId },
        data: { status: "FAILED" },
      });
      break;
    }
  }

  if (!hasNextPage) {
    await autoSeedOptionFilters(shop);
    await updateMeiliSettings(shop);
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED" },
    });
    console.log(`CFP: Background sync complete for ${shop}. Job ID: ${jobId}`);
  }
}

// Function for smart upserting — OPTIMIZED to use batch operations and avoid P2028 transaction timeouts
export async function smartUpsertProduct(shop, product, prismaClient) {
  const optionsList = product.options.map((opt) => ({
    name: opt.name,
    values: opt.values,
  }));

  const prices = product.variants.nodes.map((v) => parseFloat(v.price));
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const imageUrls = product.images.nodes.map((img) => img.url);

  // ✅ OPTIMIZATION: Use short, focused transactions instead of one giant transaction
  // This prevents P2028 timeouts that were causing 57,666 failures

  // Step 1: Upsert core product (fast, single-row operation)
  await prismaClient.product.upsert({
    where: { id: product.id },
    update: {
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      priceMin,
      priceMax,
      tags: product.tags,
      images: imageUrls,
      options: optionsList,
      status: product.status.toLowerCase(),
      updatedAt: new Date(),
    },
    create: {
      id: product.id,
      shop,
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      priceMin,
      priceMax,
      tags: product.tags,
      images: imageUrls,
      options: optionsList,
      status: product.status.toLowerCase(),
    },
  });

  // Step 2: Batch sync variants (delete stale, then upsert all at once)
  const incomingVariantIds = product.variants.nodes.map((v) => v.id);

  // Delete variants no longer in Shopify
  await prismaClient.variant.deleteMany({
    where: { productId: product.id, id: { notIn: incomingVariantIds } },
  });

  // Prepare all variant data
  const variantData = product.variants.nodes.map((variant) => {
    let option1 = null, option2 = null, option3 = null;
    variant.selectedOptions.forEach((selOpt) => {
      const optIndex = optionsList.findIndex((o) => o.name === selOpt.name);
      if (optIndex === 0) option1 = selOpt.value;
      else if (optIndex === 1) option2 = selOpt.value;
      else if (optIndex === 2) option3 = selOpt.value;
    });
    return {
      id: variant.id,
      productId: product.id,
      sku: variant.sku || null,
      price: parseFloat(variant.price),
      compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
      available: variant.availableForSale === true,
      inventory: variant.inventoryQuantity || 0,
      imageUrl: variant.image?.url || null,
      option1,
      option2,
      option3,
    };
  });

  // ✅ Batch upsert all variants in one transaction (much faster than N individual upserts)
  await prismaClient.$transaction(
    variantData.map((v) =>
      prismaClient.variant.upsert({
        where: { id: v.id },
        update: {
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          available: v.available,
          inventory: v.inventory,
          imageUrl: v.imageUrl,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
        },
        create: v,
      })
    ),
    { timeout: 15000 } // 15s timeout for large variant sets
  );

  // Step 3: Batch sync collections
  const incomingCollectionIds = product.collections.nodes.map((c) => c.id);

  // Upsert all collections in a single transaction
  if (product.collections.nodes.length > 0) {
    await prismaClient.$transaction(
      product.collections.nodes.map((collection) =>
        prismaClient.collection.upsert({
          where: { id: collection.id },
          update: { title: collection.title, handle: collection.handle },
          create: { id: collection.id, shop, title: collection.title, handle: collection.handle },
        })
      ),
      { timeout: 10000 }
    );
  }

  // Get existing links and remove stale ones, add new ones
  const existingLinks = await prismaClient.productCollection.findMany({
    where: { productId: product.id },
    select: { collectionId: true },
  });
  const existingIds = new Set(existingLinks.map((l) => l.collectionId));
  const toAdd = incomingCollectionIds.filter((id) => !existingIds.has(id));
  const toRemove = Array.from(existingIds).filter((id) => !incomingCollectionIds.includes(id));

  if (toRemove.length > 0) {
    await prismaClient.productCollection.deleteMany({
      where: { productId: product.id, collectionId: { in: toRemove } },
    });
  }
  if (toAdd.length > 0) {
    await prismaClient.productCollection.createMany({
      data: toAdd.map((collectionId) => ({ productId: product.id, collectionId })),
      skipDuplicates: true,
    });
  }

  // Step 4: Batch sync metafields
  if (product.metafields?.nodes) {
    const validMetafields = product.metafields.nodes.filter((m) => m?.value);
    const incomingMetafieldIds = validMetafields.map((m) => m.id);

    // Delete removed metafields
    await prismaClient.productMetafield.deleteMany({
      where: { productId: product.id, id: { notIn: incomingMetafieldIds } },
    });

    // Batch upsert all metafields
    if (validMetafields.length > 0) {
      await prismaClient.$transaction(
        validMetafields.map((m) =>
          prismaClient.productMetafield.upsert({
            where: { id: m.id },
            update: { value: m.value, type: m.type, namespace: m.namespace, key: m.key },
            create: { id: m.id, productId: product.id, namespace: m.namespace, key: m.key, value: m.value, type: m.type },
          })
        ),
        { timeout: 10000 }
      );
    }
  }
}


/**
 * Sync a single product from Shopify to PostgreSQL.
 * Useful for real-time webhooks (create/update).
 * @param {string} shop - The shop domain
 * @param {object} admin - The authenticated Shopify Admin API client
 * @param {string} productId - The Shopify Product GID
 */
export async function syncSingleProduct(shop, admin, productId) {
  console.log(`CFP: Syncing single product ${productId} for ${shop}...`);

  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  const query = `#graphql
    query getProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        vendor
        productType
        tags
        status
        onlineStoreUrl
        images(first: 250) {
          nodes {
            url
          }
        }
        options {
          name
          values
        }
        collections(first: 250) {
          nodes {
            id
            title
            handle
          }
        }
        variants(first: 250) {
          nodes {
            id
            sku
            price
            compareAtPrice
            inventoryQuantity
            availableForSale
            image {
              url
            }
            selectedOptions {
              name
              value
            }
          }
        }
        plusSizeMetafield: metafield(namespace: "custom", key: "plus_size_collection_image") {
          id
          namespace
          key
          value
          type
          reference {
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
        motbMetafield: metafield(namespace: "custom", key: "mother_of_the_bride_collection_image") {
          id
          namespace
          key
          value
          type
          reference {
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
        weddingMetafield: metafield(namespace: "custom", key: "wedding_collection_image") {
          id
          namespace
          key
          value
          type
          reference {
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
        metafields(first: 250) {
          nodes {
            id
            namespace
            key
            value
            type
            reference {
              ... on MediaImage {
                image {
                  url
                }
              }
              ... on GenericFile {
                url
              }
            }
          }
        }
      }
    }
  `;

  const variables = { id: productId };

  const response = await admin.graphql(query, { variables });
  const responseJson = await response.json();

  if (responseJson.errors) {
    console.error(
      `CFP: GraphQL Errors syncing product ${productId}:`,
      responseJson.errors,
    );
    throw new Error(`Failed to fetch product ${productId} from Shopify`);
  }

  const product = responseJson.data?.product;
  if (!product || product.status !== "ACTIVE") {
    console.warn(
      `CFP: Product ${productId} not found or not ACTIVE. Deleting from DB/Meili.`,
    );
    await prisma.product.deleteMany({ where: { id: productId } });
    // Also remove from Meilisearch
    try {
      const numericId = productId.split("/").pop();
      await meiliClient.index("products").deleteDocument(numericId);
      console.log(`CFP: Deleted document ${numericId} from Meilisearch`);
    } catch (e) {
      console.error("CFP: Failed to delete document from Meilisearch", e);
    }
    return null;
  }

  // ✅ Run DB upsert and build Meilisearch doc in parallel from Shopify data
  // No need to re-read from Postgres — we have all the data from the API response
  const available = product.variants.nodes.some((v) => v.availableForSale);
  const prices = product.variants.nodes.map((v) => parseFloat(v.price));
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

  const formattedOptions = {};
  product.options.forEach((opt) => {
    formattedOptions[`option_${opt.name}`] = Array.isArray(opt.values)
      ? opt.values
      : [opt.values];
  });

  const formattedMetafields = {};
  if (product.metafields) {
    if (!product.metafields.nodes) product.metafields.nodes = [];
    if (product.plusSizeMetafield)
      product.metafields.nodes.push(product.plusSizeMetafield);
    if (product.motbMetafield)
      product.metafields.nodes.push(product.motbMetafield);
    if (product.weddingMetafield)
      product.metafields.nodes.push(product.weddingMetafield);

    product.metafields.nodes.forEach((m) => {
      if (m && m.value) {
        let val = m.value;
        if (m.reference && m.reference.image && m.reference.image.url) {
          val = m.reference.image.url;
        } else if (m.reference && m.reference.url) {
          val = m.reference.url;
        }
        formattedMetafields[`metafield_${m.namespace}.${m.key}`] = val;
      }
    });
  }

  const meiliDoc = {
    id: product.id.split("/").pop(),
    shop,
    title: product.title || "",
    handle: product.handle || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    priceMin,
    priceMax,
    tags: product.tags || [],
    collections: product.collections.nodes.map((c) => c.id),
    collection_titles: product.collections.nodes.map((c) => c.title),
    available,
    status: (product.status || "ACTIVE").toUpperCase(),
    createdAt: Date.now(),
    images: product.images.nodes.map((img) => img.url), // all images, no limit
    variantPrices: product.variants.nodes.map((v) => {
      const optionsList = product.options || [];
      let option1 = null,
        option2 = null,
        option3 = null;
      (v.selectedOptions || []).forEach((selOpt) => {
        const idx = optionsList.findIndex((o) => o.name === selOpt.name);
        if (idx === 0) option1 = selOpt.value;
        else if (idx === 1) option2 = selOpt.value;
        else if (idx === 2) option3 = selOpt.value;
      });
      return {
        id: v.id.split("/").pop(),
        price: parseFloat(v.price),
        compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
        available: v.availableForSale === true,
        option1,
        option2,
        option3,
        imageUrl: v.image?.url || null,
      };
    }),
    ...formattedOptions,
    ...formattedMetafields,
  };

  // ✅ Parallel: DB upsert + Meilisearch push at the same time
  await Promise.all([
    smartUpsertProduct(shop, product, prisma),
    meiliClient
      .index("products")
      .addDocuments([meiliDoc])
      .then((task) => {
        console.log(
          `CFP: Pushed product ${meiliDoc.id} to Meilisearch (Task ID: ${task.taskUid})`,
        );
      })
      .catch((e) => {
        console.error("CFP: Failed to push product to Meilisearch", e);
      }),
  ]);

  await autoSeedOptionFilters(shop);

  console.log(`CFP: Webhook sync complete for product ${productId}.`);
  return productId;
}

/**
 * Synchronize the products of a specific collection.
 * Detects products that were added or removed from the collection and syncs them.
 * Useful for COLLECTIONS_UPDATE webhooks where product lists might change.
 */
export async function syncCollectionProducts(shop, admin, collectionId) {
  console.log(
    `CFP: Syncing products for collection ${collectionId} in background...`,
  );

  // 1. Fetch all product IDs from Shopify for this collection
  let hasNextPage = true;
  let cursor = null;
  const shopifyProductIds = new Set();

  while (hasNextPage) {
    const query = `#graphql
      query getCollectionProducts($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id }
          }
        }
      }
    `;
    try {
      const response = await admin.graphql(query, {
        variables: { id: collectionId, cursor },
      });
      const responseJson = await response.json();
      if (responseJson.errors) {
        console.error(
          "CFP: GraphQL error fetching collection products",
          responseJson.errors,
        );
        break;
      }

      const products = responseJson.data?.collection?.products;
      if (!products) break;

      products.nodes.forEach((n) => shopifyProductIds.add(n.id));
      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.pageInfo.endCursor;
    } catch (e) {
      console.error("CFP: Error fetching collection products", e);
      break;
    }
  }

  // 2. Fetch all product IDs currently linked to this collection in DB
  const dbLinks = await prisma.productCollection.findMany({
    where: { collectionId },
    select: { productId: true },
  });
  const dbProductIds = new Set(dbLinks.map((link) => link.productId));

  // 3. Find differences
  const productsToSync = new Set();

  // Added to collection
  for (const id of shopifyProductIds) {
    if (!dbProductIds.has(id)) productsToSync.add(id);
  }

  // Removed from collection
  for (const id of dbProductIds) {
    if (!shopifyProductIds.has(id)) productsToSync.add(id);
  }

  // 4. Sync affected products
  if (productsToSync.size > 0) {
    console.log(
      `CFP: Found ${productsToSync.size} product differences for collection ${collectionId}. Syncing...`,
    );
    for (const productId of productsToSync) {
      try {
        await syncSingleProduct(shop, admin, productId);
      } catch (e) {
        console.error(
          `CFP: Error syncing product ${productId} during collection update`,
          e,
        );
      }
    }
    console.log(
      `CFP: Finished syncing product differences for collection ${collectionId}.`,
    );
  } else {
    console.log(
      `CFP: No product differences found for collection ${collectionId}.`,
    );
  }
}
