import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

        await prisma.$transaction(async (tx) => {
          await tx.productCollection.deleteMany({ where: { collectionId } });
          await tx.collection.deleteMany({ where: { id: collectionId } });
        });

        console.log(`CFP: Collection ${collectionId} successfully deleted.`);
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
