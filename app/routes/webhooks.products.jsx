import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSingleProduct } from "../services/sync.server";
import meiliClient from "../services/meiliClient.server";

import { withRetry } from "../utils/retry.server";

export const action = async ({ request }) => {
  const { shop, payload, topic, admin } = await authenticate.webhook(request);

  console.log(`CFP: Received ${topic} webhook for ${shop}`);

  // Topic names can be PRODUCTS_CREATE, PRODUCTS_UPDATE, PRODUCTS_DELETE depending on Shopify context
  // We handle normalized uppercase names as well as the standard lowercase names.
  const normalizedTopic = topic.toUpperCase();

  try {
    switch (normalizedTopic) {
      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE": {
        const productId = `gid://shopify/Product/${payload.id}`;
        if (admin) {
          // FIRE AND FORGET WITH RETRY: Process in background, handle transient failures
          withRetry(() => syncSingleProduct(shop, admin, productId)).catch(
            (err) => {
              console.error(
                `CFP: Background webhook sync completely failed for ${productId} after retries.`,
                err,
              );
            },
          );
        } else {
          console.warn(`CFP: Admin client not available for ${shop}.`);
        }
        break;
      }
      case "PRODUCTS_DELETE": {
        const productId = `gid://shopify/Product/${payload.id}`;
        console.log(`CFP: Queuing delete for product ${productId}...`);

        // FIRE AND FORGET: Background deletion
        (async () => {
          try {
            await prisma.product.deleteMany({ where: { id: productId } });
            const numericId = payload.id.toString();
            await meiliClient.index("products").deleteDocument(numericId);
            console.log(
              `CFP: Product ${productId} successfully deleted in background.`,
            );
          } catch (e) {
            console.error("CFP: Background delete failed", e);
          }
        })();
        break;
      }
      default:
        console.log(`CFP: Unhandled topic ${topic}`);
    }
  } catch (error) {
    console.error(`CFP: Error processing webhook ${topic} for ${shop}:`, error);
    // Even if database operation fails, return a 200 OK so Shopify does not retry indefinitely
  }

  return new Response("Webhook received", { status: 200 });
};
