import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSingleProduct } from "../services/sync.server";
import meiliClient from "../services/meiliClient.server";
import { enqueueWebhookJob } from "../utils/webhookQueue.server";

export const action = async ({ request }) => {
  const { shop, payload, topic, admin } = await authenticate.webhook(request);

  console.log(`CFP: Received ${topic} webhook for ${shop}`);

  const normalizedTopic = topic.toUpperCase();

  switch (normalizedTopic) {
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE": {
      const productId = `gid://shopify/Product/${payload.id}`;
      if (admin) {
        // ✅ QUEUE: Enqueue job instead of running immediately
        // - Returns 200 to Shopify instantly (prevents Shopify retries)
        // - Queue processes with max 3 concurrent (DB pool never exhausted)
        // - Deduplication: if same product webhook arrives 5x, only 1 DB write
        enqueueWebhookJob(
          productId,
          () => syncSingleProduct(shop, admin, productId),
          `${normalizedTopic}:${payload.id}`
        );
      } else {
        console.warn(`CFP: Admin client not available for ${shop}.`);
      }
      break;
    }

    case "PRODUCTS_DELETE": {
      const productId = `gid://shopify/Product/${payload.id}`;
      console.log(`CFP: Queuing delete for product ${productId}...`);

      // ✅ QUEUE: Delete also goes through queue for consistency
      enqueueWebhookJob(
        productId,
        async () => {
          await prisma.product.deleteMany({ where: { id: productId } });
          const numericId = payload.id.toString();
          await meiliClient.index("products").deleteDocument(numericId);
          console.log(`CFP: Product ${productId} successfully deleted.`);
        },
        `PRODUCTS_DELETE:${payload.id}`
      );
      break;
    }

    default:
      console.log(`CFP: Unhandled topic ${topic}`);
  }

  // ✅ Always return 200 immediately — queue handles the rest in background
  return new Response("Webhook received", { status: 200 });
};
