import prisma from "../db.server";
import { completeProductCollections, verifyMembershipWrites } from "./productCollections.server.js";
import { reconcileCollectionMembership } from "../utils/reconcileCollectionMembership.js";
import { semanticEmbedderSettings, semanticProvider } from "../utils/semanticSearch.js";
import meiliClient from "./meiliClient.server";
import { invalidateShop } from "./shopCache.server";
import { isStorefrontProduct } from "../utils/storefrontProduct.js";
import { syncErrorMessage, productSyncJobWhere } from "../utils/syncError.js";
import { searchIndexProjection, SEARCH_FILTER_FIELDS } from '../utils/searchIndexProjection.js';
import {withCollectionRuleFacts} from './collectionRuleFacts.server.js';

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
      inventoryTotal: (p.variants || []).reduce((sum, v) => sum + (v.inventory || 0), 0),
      status: p.status ? p.status.toUpperCase() : "ACTIVE",
      createdAt: p.createdAt ? p.createdAt.getTime() : Date.now(),
      bestSellingRank: p.bestSellingRank !== undefined ? p.bestSellingRank : 999999,
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
            sku: v.sku || null,
            imageUrl: v.imageUrl || null,
          }))
        : [],
      ...formattedOptions,
      ...formattedMetafields,
    };
  });

  try {
    const index = meiliClient.index("products");
    const task = await index.addDocuments(await withCollectionRuleFacts(documents.map(p => ({ ...p, ...searchIndexProjection(p) }))));
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
export async function updateMeiliSettings(shop, { throwOnError = false } = {}) {
  try {
    const index = meiliClient.index("products");
    const dynamicKeys = new Set();

    // Get unique option names efficiently via raw SQL
    const optionsRaw = await prisma.$queryRaw`
      SELECT DISTINCT opt->>'name' as name
      FROM "Product" p,
      jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.options) = 'array' THEN p.options ELSE '[]'::jsonb END
      ) as opt
      WHERE p.shop = ${shop}
    `;
    for (const opt of optionsRaw) {
      if (opt.name) dynamicKeys.add(`option_${opt.name}`);
    }

    // Get unique metafields efficiently
    const metafieldsRaw = await prisma.$queryRaw`
      SELECT DISTINCT namespace, key
      FROM "ProductMetafield" pm
      JOIN "Product" p ON p.id = pm."productId"
      WHERE p.shop = ${shop}
    `;
    for (const m of metafieldsRaw) {
      if (m.namespace && m.key) {
        dynamicKeys.add(`metafield_${m.namespace}.${m.key}`);
      }
    }

    const filterableAttributes = [
      "id",
      "shop",
      "vendor",
      "title",
      "productType",
      "tags",
      "collections",
      "collection_titles",
      "available",
      "status",
      "priceMin",
      "createdAt",
      ...SEARCH_FILTER_FIELDS,
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

    const sortableAttributes = ["priceMin", "createdAt", "title", "bestSellingScore", "trendingScore"];

    await index.updateFilterableAttributes(filterableAttributes);
    await index.updateSearchableAttributes(searchableAttributes);
    await index.updateSortableAttributes(sortableAttributes);
    await index.updateFaceting({ maxValuesPerFacet: 100000 });
    // ✅ FIX: Increase maxTotalHits from default 1000 → 100000
    // Without this, estimatedTotalHits is capped at 1000 even with 48k+ products
    // This is why storefront showed "X of 1000 products" instead of actual count
    await index.updatePagination({ maxTotalHits: 100000 });

    // Catalog sync must not restart a full embedding migration that is on hold.
    // The manual semantic setup workflow owns initial embedder provisioning.
    if (process.env.SEMANTIC_EMBEDDING_SETUP_ENABLED === "true") {
      try {
        const task = await index.updateEmbedders(semanticEmbedderSettings());
        const completed = await meiliClient.tasks.waitForTask(task.taskUid, { timeout: 600000 });
        if (completed.status !== "succeeded") throw new Error("Semantic embedding configuration failed: " + (completed.error?.code || completed.status));
        console.log(`CFP: AI Vector embedder (${semanticProvider()}) configured for ${shop}`);
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
    if (throwOnError) throw error;
  }
}

/**
 * Auto-seed FilterSetting records for every unique product option name found in the shop.
 * Called after every sync so new options (Color, Size, etc.) appear in admin automatically.
 */
async function autoSeedOptionFilters(shop) {
  const optionsRaw = await prisma.$queryRaw`
    SELECT DISTINCT opt->>'name' as name
    FROM "Product" p,
    jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.options) = 'array' THEN p.options ELSE '[]'::jsonb END
    ) as opt
    WHERE p.shop = ${shop}
  `;

  const seen = new Set();
  for (const opt of optionsRaw) {
    if (opt.name) seen.add(opt.name);
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
const activeProductSyncs = new Map();
const startingProductSyncs = new Map();

export function syncProducts(shop, admin, session = null, forceFresh = false) {
  if (startingProductSyncs.has(shop)) return startingProductSyncs.get(shop);
  const starting = initializeProductSync(shop, admin, session, forceFresh)
    .finally(() => startingProductSyncs.delete(shop));
  startingProductSyncs.set(shop, starting);
  return starting;
}

async function initializeProductSync(shop, admin, session, forceFresh) {
  if (activeProductSyncs.has(shop)) {
    return { jobId: activeProductSyncs.get(shop), message: "Product sync is already running" };
  }
  console.log(`CFP: Initializing background product sync for ${shop} (forceFresh=${forceFresh})...`);

  // ── Resume or Fresh Start ──────────────────────────────────────────
  let job = null;
  const latestJob = await prisma.syncJob.findFirst({
    where: productSyncJobWhere(shop),
    orderBy: { createdAt: "desc" },
  });
  if (latestJob?.status === "IN_PROGRESS" || (!forceFresh && (latestJob?.status === "FAILED" || (latestJob?.status === "COMPLETED" && !latestJob.completedAt)))) job = latestJob;

  if (job) {
    // Resume from where it stopped
    console.log(`CFP: Resuming failed sync for ${shop} from cursor (${job.productsProcessed} already done)`);
    job = await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "IN_PROGRESS", kind: "PRODUCTS", completedAt: null, lastError: null, retryCount: 0, updatedAt: new Date() },
    });
  } else {
    // Keep earlier jobs so sync history remains available.

    let totalProducts = 0;
    try { totalProducts = await shopifyProductCount(admin); } catch (error) {
      console.warn("CFP: Product count unavailable; verifying it at completion:", error.message);
    }

    job = await prisma.syncJob.create({
      data: {
        shop,
        kind: "PRODUCTS",
        status: "IN_PROGRESS",
        totalProducts: totalProducts ?? 0,
      },
    });
    console.log(`CFP: Starting fresh sync for ${shop} — ${totalProducts ?? "?"} total active products`);
  }

  // Persist the work in Redis before returning; a restarted worker resumes it.
  try {
    const { enqueueProductSync } = await import("./productSyncQueue.server.js");
    await enqueueProductSync(job.id, shop);
  } catch (error) {
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: syncErrorMessage(error) } });
    throw error;
  }

  return {
    jobId: job.id,
    message: !forceFresh && job.cursor
      ? `Resuming sync from product ${job.productsProcessed}...`
      : "Full sync started in background",
  };
}

export async function runProductSync(jobId, shop, admin, { markFailure = true, maxBatches = Infinity } = {}) {
  activeProductSyncs.set(shop, jobId);
  // Batch persistence can take several minutes on products with many variants.
  // Keep the job alive independently of when the cursor is committed.
  let heartbeatPending = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try {
      await prisma.syncJob.updateMany({
        where: { id: jobId, status: "IN_PROGRESS" },
        data: { updatedAt: new Date() },
      });
    } catch (error) {
      console.error("CFP: Product sync heartbeat failed:", error.message);
    } finally { heartbeatPending = false; }
  }, 15000);
  heartbeat.unref?.();
  try {
    return await processSyncChunk(jobId, shop, admin, maxBatches);
  } catch (error) {
    if (markFailure) await prisma.syncJob.update({ where: { id: jobId }, data: { status: "FAILED", lastError: syncErrorMessage(error) } });
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (activeProductSyncs.get(shop) === jobId) activeProductSyncs.delete(shop);
  }
}

async function processSyncChunk(jobId, shop, admin, maxBatches = Infinity) {
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
      products(first: 10, after: $cursor) {
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
          publishedAt
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
            pageInfo { hasNextPage endCursor }
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

  let batchesProcessed = 0;
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
      if (!productsData) throw new Error("Shopify returned no product connection");
      if (typeof productsData.pageInfo?.hasNextPage !== "boolean" || (productsData.pageInfo.hasNextPage && (!productsData.pageInfo.endCursor || productsData.pageInfo.endCursor === cursor))) {
        throw new Error("Shopify pagination stopped returning a valid next cursor");
      }
      if (productsData.nodes.length === 0 && productsData.pageInfo.hasNextPage) throw new Error("Shopify pagination stopped with an empty intermediate page");
      if (productsData.nodes.length === 0) {
        hasNextPage = false;
        break;
      }
      // Filter: only ACTIVE status AND published to Online Store (publishedAt is not null)
      const products = productsData.nodes.filter(isStorefrontProduct);

      // Complete membership reads before any DB/index writes for this batch.
      for (const product of products) await completeProductCollections(admin, product);

      // Remove stale drafts, archived products, and products unpublished from the Online Store.
      const unpublishedProducts = productsData.nodes.filter((p) => !isStorefrontProduct(p));
      if (unpublishedProducts.length > 0) {
        for (const p of unpublishedProducts) {
          const numericId = p.id.split("/").pop();
          await meiliClient.index("products").deleteDocument(numericId);
          await prisma.product.deleteMany({ where: { shop, id: p.id } });
          console.log(`CFP: Removed unpublished product ${p.id} from DB/Meili`);
        }
      }
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
          inventoryTotal: p.variants.nodes.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0),
          status: (p.status || "ACTIVE").toUpperCase(),
          createdAt: p.publishedAt ? new Date(p.publishedAt).getTime() : Date.now(),
          bestSellingScore: p.bestSellingScore || 0.0,
          trendingScore: p.trendingScore || 0.0,
          images: p.images.nodes.map((img) => img.url), // all images, no limit
          options: p.options
            ? p.options.map((opt) => ({
                name: opt.name,
                values: Array.isArray(opt.values) ? opt.values : [opt.values],
              }))
            : [],
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
              sku: v.sku || null,
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
        // Meili push (gracefully handled if remote VPS disk is full)
        (async () => {
          try {
            const task = await meiliClient.index("products").addDocuments(await withCollectionRuleFacts(meiliDocs.map(p => ({ ...p, ...searchIndexProjection(p) }))));
            const indexed = await meiliClient.tasks.waitForTask(task.taskUid, { timeout: 120000, interval: 500 });
            if (indexed.status !== "succeeded") throw new Error("Product indexing failed: " + (indexed.error?.code || indexed.status));
            console.log(
              `CFP: Pushed ${meiliDocs.length} docs to Meilisearch (Task ID: ${task.taskUid})`,
            );
          } catch (e) {
            console.error("CFP: Meilisearch push failed:", e.message || e);
            throw e;
          }
        })(),
      ]);

      // Do not advance past a batch with missing DB links or indexed membership.
      if (products.length) await verifyMembershipWrites(prisma, meiliClient.index('products'), shop, products, meiliDocs);

      // Update Job State
      job = await prisma.syncJob.update({
        where: { id: jobId },
        data: {
          cursor: cursor,
          productsProcessed: { increment: productsData.nodes.length },
          status: "IN_PROGRESS",
          lastError: null,
        },
      });

      console.log(
        `CFP: SyncJob ${jobId} processed ${job.productsProcessed} products so far.`,
      );

      if (++batchesProcessed >= maxBatches && hasNextPage) return { needsContinuation: true };

      // Small delay to yield event loop and avoid Shopify rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      console.error(`CFP: Error processing chunk for job ${jobId}`, err);
      throw err;
    }
  }

  if (!hasNextPage) {
    try {
      // Exhausting a cursor alone is insufficient when a saved scan is incomplete.
      // Recount to allow legitimate catalog deletions while rejecting an early end.
      const currentTotal = await shopifyProductCount(admin);
      if ((job.productsProcessed || 0) < currentTotal) {
        throw new Error(`Shopify pagination stopped with unread products: ${job.productsProcessed || 0} / ${currentTotal}`);
      }
      await prisma.syncJob.update({ where: { id: jobId }, data: { totalProducts: currentTotal } });
      await autoSeedOptionFilters(shop);
      await updateMeiliSettings(shop, { throwOnError: true });
      
      // Calculate and update Trending/BestSelling scores
      const { syncHistoricalOrders } = await import("./orders.server.js");
      const scoresSynced = await syncHistoricalOrders(shop);
      if (scoresSynced === false) throw new Error("Sales data sync failed; retrying finalization");

      await invalidateShop(shop);
      await prisma.syncJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", completedAt: new Date(), lastError: null },
      });
      console.log(`CFP: Background sync complete for ${shop}. Job ID: ${jobId}`);
    } catch (finalErr) {
      console.error(`CFP: Final sync steps failed for ${shop}`, finalErr);
      throw finalErr;
    }
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
export async function syncSingleProduct(shop, admin, productId, { retrySearchErrors = false } = {}) {
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
        publishedAt
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
          pageInfo { hasNextPage endCursor }
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

  const shouldDelete = !isStorefrontProduct(product);

  if (shouldDelete) {
    const reason = !product
      ? "not found"
      : product.status !== "ACTIVE"
      ? `status=${product.status}`
      : "removed from Online Store channel";
    console.warn(
      `CFP: Product ${productId} should be removed (${reason}). Deleting from DB/Meili.`,
    );
    await prisma.product.deleteMany({ where: { shop, id: productId } });
    // Also remove from Meilisearch
    try {
      const numericId = productId.split("/").pop();
      const task=await meiliClient.index("products").deleteDocument(numericId);
      if(retrySearchErrors){const completed=await meiliClient.tasks.waitForTask(task.taskUid,{timeout:120000});if(completed.status!=='succeeded')throw Error('Product removal indexing failed');}
      console.log(`CFP: Deleted document ${numericId} from Meilisearch`);
    } catch (e) {
      console.error("CFP: Failed to delete document from Meilisearch", e);
      if (retrySearchErrors) throw e;
    }
    return null;
  }

  // ✅ Run DB upsert and build Meilisearch doc in parallel from Shopify data
  // No need to re-read from Postgres — we have all the data from the API response
  await completeProductCollections(admin, product);

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

    const existingDbProduct = await prisma.product.findUnique({
      where: { id: product.id },
      select: { bestSellingScore: true, trendingScore: true }
    });

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
      inventoryTotal: product.variants.nodes.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0),
      status: (product.status || "ACTIVE").toUpperCase(),
      createdAt: product.publishedAt ? new Date(product.publishedAt).getTime() : Date.now(),
      bestSellingScore: existingDbProduct?.bestSellingScore || 0.0,
      trendingScore: existingDbProduct?.trendingScore || 0.0,
      images: product.images.nodes.map((img) => img.url), // all images, no limit
    options: product.options
      ? product.options.map((opt) => ({
          name: opt.name,
          values: Array.isArray(opt.values) ? opt.values : [opt.values],
        }))
      : [],
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
        sku: v.sku || null,
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
      .addDocuments(await withCollectionRuleFacts([{ ...meiliDoc, ...searchIndexProjection(meiliDoc) }]))
      .then(async (task) => {
        if(retrySearchErrors){const completed=await meiliClient.tasks.waitForTask(task.taskUid,{timeout:120000});if(completed.status!=='succeeded')throw Error('Product indexing failed');}
        console.log(
          `CFP: Pushed product ${meiliDoc.id} to Meilisearch (Task ID: ${task.taskUid})`,
        );
      })
      .catch((e) => {
        console.error("CFP: Failed to push product to Meilisearch", e);
        if (retrySearchErrors) throw e;
      }),
  ]);

  if (retrySearchErrors) await verifyMembershipWrites(prisma, meiliClient.index('products'), shop, [product], [meiliDoc]);
  await autoSeedOptionFilters(shop);

  console.log(`CFP: Webhook sync complete for product ${productId}.`);
  return productId;
}

/**
 * Synchronize the products of a specific collection.
 * Detects products that were added or removed from the collection and syncs them.
 * Useful for COLLECTIONS_UPDATE webhooks where product lists might change.
 */
export async function syncCollectionProducts(shop, admin, collectionId, { throwOnError = false } = {}) {
  let attemptedWrites = false;
  try {
    return await reconcileCollectionMembership({db:prisma,index:meiliClient.index('products'),shop,collectionId,admin,
      syncProduct:async id=>{attemptedWrites=true;await syncSingleProduct(shop,admin,id,{retrySearchErrors:true});}});
  } catch (error) {
    console.error('CFP: Collection membership reconciliation failed:', error.message);
    if (throwOnError) throw error;
    return {verified:false,error:'Collection membership reconciliation failed'};
  } finally {
    // DB and index are separate systems. Failed partial repairs must not leave
    // cached eligibility behind; durable retries re-read Shopify before writing.
    if (attemptedWrites) await invalidateShop(shop);
  }
}

async function shopifyProductCount(admin) {
  const response = await admin.graphql(`#graphql
    query verifyProductSyncCount { productsCount(limit: null) { count precision } }
  `);
  const json = await response.json();
  const result = json.data?.productsCount;
  if (json.errors?.length || !Number.isSafeInteger(result?.count) || result.count < 0 || result.precision !== "EXACT") {
    throw new Error("Shopify product count could not be verified");
  }
  return result.count;
}
