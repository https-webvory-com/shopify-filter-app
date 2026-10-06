import { Worker } from "bullmq";
import { redisOptions } from "../services/queue.server.js";
import prisma from "../db.server.js";
import { calculateProductScores, pushScoresToMeili } from "../services/orders.server.js";
import meiliClient from "../services/meiliClient.server.js";

let webhookWorker;

async function processWebhookJob(job) {
  const { name: topic, data } = job;
  const { shop, payload } = data;
  const normalizedTopic = (topic || "").replaceAll("/", "_").toUpperCase();

  console.log(`CFP Worker: Processing job #${job.id} - Topic: ${normalizedTopic} for Shop: ${shop}`);

  try {
    switch (normalizedTopic) {
      case "ORDERS_PAID":
        await handleOrderPaid(shop, payload);
        break;

      case "ORDERS_CANCELLED":
        await handleOrderCancelled(shop, payload);
        break;

      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE":
        await handleProductUpdate(shop, payload);
        break;

      case "PRODUCTS_DELETE":
        await handleProductDelete(shop, payload);
        break;

      case "COLLECTIONS_CREATE":
      case "COLLECTIONS_UPDATE":
        await handleCollectionUpdate(shop, payload);
        break;

      case "COLLECTIONS_DELETE":
        await handleCollectionDelete(shop, payload);
        break;

      case "APP_UNINSTALLED":
        await handleAppUninstalled(shop);
        break;

      default:
        console.log(`CFP Worker: Topic ${normalizedTopic} processed.`);
        break;
    }
  } catch (error) {
    console.error(`CFP Worker Error processing job #${job.id} (${normalizedTopic}):`, error);
    throw error; // Re-throw to trigger BullMQ automatic retry!
  }
}

async function handleOrderPaid(shop, orderPayload) {
  const lineItems = orderPayload.line_items || [];
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true },
    });

    if (product) {
      const updated60 = (product.unitsSold60Days || 0) + qty;
      const updated7 = (product.unitsSold7Days || 0) + qty;

      const price = parseFloat(item.price || "0");
      const lineRevenue = price * qty;
      const updatedRevenue = (product.grossRevenue || 0.0) + lineRevenue;

      const updatedOrderCount = (product.orderCount || 0) + (modifiedProductIds.has(productId) ? 0 : 1);

      const scores = calculateProductScores(updated60, updated7, updatedRevenue, updatedOrderCount);

      await prisma.product.update({
        where: { id: productId },
        data: {
          unitsSold60Days: updated60,
          unitsSold7Days: updated7,
          grossRevenue: updatedRevenue,
          orderCount: updatedOrderCount,
          bestSellingScore: scores.bestSellingScore,
          trendingScore: scores.trendingScore,
        },
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    await pushScoresToMeili(shop);
  }
}

async function handleOrderCancelled(shop, orderPayload) {
  const lineItems = orderPayload.line_items || [];
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true },
    });

    if (product) {
      const updated60 = Math.max(0, (product.unitsSold60Days || 0) - qty);
      const updated7 = Math.max(0, (product.unitsSold7Days || 0) - qty);

      const price = parseFloat(item.price || "0");
      const refundRevenue = price * qty;
      const updatedRevenue = Math.max(0, (product.grossRevenue || 0.0) - refundRevenue);

      const updatedOrderCount = product.orderCount || 0;

      const scores = calculateProductScores(updated60, updated7, updatedRevenue, updatedOrderCount);

      await prisma.product.update({
        where: { id: productId },
        data: {
          unitsSold60Days: updated60,
          unitsSold7Days: updated7,
          grossRevenue: updatedRevenue,
          orderCount: updatedOrderCount,
          bestSellingScore: scores.bestSellingScore,
          trendingScore: scores.trendingScore,
        },
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    await pushScoresToMeili(shop);
  }
}

async function handleProductUpdate(shop, payload) {
  if (!payload.id) throw new Error("Product webhook is missing its product ID");
  const productId = payload.admin_graphql_api_id || `gid://shopify/Product/${payload.id}`;
  // Load at processing time to avoid the Redis -> worker -> sync -> Redis cycle.
  const { unauthenticated } = await import("../shopify.server.js");
  const { syncSingleProduct } = await import("../services/sync.server.js");
  const { invalidateShop } = await import("../services/shopCache.server.js");
  const { admin } = await unauthenticated.admin(shop);
  await syncSingleProduct(shop, admin, productId, { retrySearchErrors: true });
  await invalidateShop(shop);
  console.log(`CFP Worker: Product update synced for ${productId}`);
}

async function handleProductDelete(shop, payload) {
  const productId = `gid://shopify/Product/${payload.id}`;
  await prisma.product.deleteMany({ where: { id: productId } });
  const numericId = payload.id.toString();
  await meiliClient.index("products").deleteDocument(numericId);
  console.log(`CFP Worker: Product ${productId} deleted from DB & Meilisearch.`);
}

async function handleCollectionUpdate(shop, payload) {
  const collectionId = `gid://shopify/Collection/${payload.id}`;
  await prisma.collection.upsert({
    where: { id: collectionId },
    update: { title: payload.title, handle: payload.handle },
    create: { id: collectionId, shop, title: payload.title, handle: payload.handle },
  });
  console.log(`CFP Worker: Collection ${collectionId} updated.`);
}

async function handleCollectionDelete(shop, payload) {
  const collectionId = `gid://shopify/Collection/${payload.id}`;
  await prisma.collection.deleteMany({ where: { id: collectionId } });
  console.log(`CFP Worker: Collection ${collectionId} deleted.`);
}

async function handleAppUninstalled(shop) {
  await prisma.session.deleteMany({ where: { shop } });
  console.log(`CFP Worker: App uninstalled cleanup completed for ${shop}.`);
}

export function initWebhookWorker() {
  if (!global.__webhookWorker) {
    global.__webhookWorker = new Worker("webhookQueue", processWebhookJob, {
      connection: { ...redisOptions, maxRetriesPerRequest: null },
      concurrency: 5,
    });

    global.__webhookWorker.on("completed", (job) => {
      console.log(`CFP Worker: Job #${job.id} (${job.name}) completed successfully!`);
    });

    global.__webhookWorker.on("failed", (job, err) => {
      console.error(`CFP Worker: Job #${job?.id} (${job?.name}) failed:`, err.message);
    });

    global.__webhookWorker.on("error", (err) => {
      console.error("CFP Worker: Redis/worker error:", err);
    });

    console.log("CFP Worker: BullMQ Webhook Worker initialized for ALL webhooks (concurrency: 5).");
  }
  webhookWorker = global.__webhookWorker;
  return webhookWorker;
}
