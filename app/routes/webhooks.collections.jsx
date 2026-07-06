import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatAndPushToMeili } from "../services/sync.server";
import { withRetry } from "../utils/retry.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`CFP: Received ${topic} webhook for ${shop}`);

  const normalizedTopic = topic.toUpperCase();

  try {
    switch (normalizedTopic) {
      case "COLLECTIONS_CREATE":
      case "COLLECTIONS_UPDATE": {
        const collectionId = `gid://shopify/Collection/${payload.id}`;

        // FIRE AND FORGET WITH RETRY
        withRetry(() =>
          prisma.collection.upsert({
            where: { id: collectionId },
            update: {
              title: payload.title,
              handle: payload.handle,
            },
            create: {
              id: collectionId,
              shop,
              title: payload.title,
              handle: payload.handle,
            },
          }),
        )
          .then(() => {
            console.log(
              `CFP: Collection ${collectionId} successfully synced in background.`,
            );
          })
          .catch((err) => {
            console.error("CFP: Background collection upsert failed", err);
          });

        break;
      }
      case "COLLECTIONS_DELETE": {
        const collectionId = `gid://shopify/Collection/${payload.id}`;
        console.log(`CFP: Queuing delete for collection ${collectionId}...`);

        // FIRE AND FORGET
        (async () => {
          try {
            const linkedProducts = await prisma.productCollection.findMany({
              where: { collectionId },
              select: { productId: true },
            });
            const productIdsToUpdate = linkedProducts.map((lp) => lp.productId);

            await prisma.$transaction(async (tx) => {
              await tx.productCollection.deleteMany({
                where: { collectionId },
              });
              await tx.collection.deleteMany({ where: { id: collectionId } });
            });

            if (productIdsToUpdate.length > 0) {
              console.log(
                `CFP: Resyncing ${productIdsToUpdate.length} products to Meilisearch...`,
              );
              const dbProducts = await prisma.product.findMany({
                where: { id: { in: productIdsToUpdate } },
                include: {
                  variants: true,
                  collections: { select: { collectionId: true } },
                  metafields: true,
                },
              });
              if (dbProducts.length > 0) {
                await formatAndPushToMeili(dbProducts);
              }
            }
            console.log(
              `CFP: Collection ${collectionId} successfully deleted in background.`,
            );
          } catch (e) {
            console.error("CFP: Background collection delete failed", e);
          }
        })();
        break;
      }
      default:
        console.log(`CFP: Unhandled topic ${topic}`);
    }
  } catch (error) {
    console.error(`CFP: Error processing webhook ${topic} for ${shop}:`, error);
  }

  return new Response("Webhook received", { status: 200 });
};
