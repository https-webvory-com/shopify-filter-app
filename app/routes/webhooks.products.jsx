import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSingleProduct } from "../services/sync.server";

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
        // Ensure admin client exists. If the webhook is triggered out of band without a valid token, we fallback safely.
        if (admin) {
          await syncSingleProduct(shop, admin, productId);
        } else {
          console.warn(
            `CFP: Admin client not available in webhook for ${shop}. Skipping real-time fetch.`,
          );
        }
        break;
      }
      case "PRODUCTS_DELETE": {
        const productId = `gid://shopify/Product/${payload.id}`;
        console.log(`CFP: Deleting product ${productId} from DB...`);

        await prisma.$transaction(async (tx) => {
          await tx.variant.deleteMany({ where: { productId } });
          await tx.productCollection.deleteMany({ where: { productId } });
          await tx.productMetafield.deleteMany({ where: { productId } });
          await tx.product.deleteMany({ where: { id: productId } });
        });

        console.log(`CFP: Product ${productId} successfully deleted.`);
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
