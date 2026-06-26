import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatAndPushToMeili } from "../services/sync.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`CFP: Received ${topic} webhook for ${shop}`);

  const normalizedTopic = topic.toUpperCase();

  try {
    switch (normalizedTopic) {
      case "COLLECTIONS_CREATE":
      case "COLLECTIONS_UPDATE": {
        const collectionId = `gid://shopify/Collection/${payload.id}`;
        
        await prisma.collection.upsert({
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
        });
        
        console.log(`CFP: Collection ${collectionId} successfully synced.`);
        break;
      }
      case "COLLECTIONS_DELETE": {
        const collectionId = `gid://shopify/Collection/${payload.id}`;
        console.log(`CFP: Deleting collection ${collectionId} from DB...`);

        // 1. Find all products associated with this collection before we delete the link
        const linkedProducts = await prisma.productCollection.findMany({
          where: { collectionId },
          select: { productId: true }
        });
        const productIdsToUpdate = linkedProducts.map(lp => lp.productId);

        // 2. Delete the collection and links from Prisma
        await prisma.$transaction(async (tx) => {
          await tx.productCollection.deleteMany({ where: { collectionId } });
          await tx.collection.deleteMany({ where: { id: collectionId } });
        });

        // 3. Resync those specific products to Meilisearch so their collections array is clean
        if (productIdsToUpdate.length > 0) {
          console.log(`CFP: Resyncing ${productIdsToUpdate.length} products to Meilisearch to remove stale collection ID...`);
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

        console.log(`CFP: Collection ${collectionId} successfully deleted and Meilisearch cleaned.`);
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
