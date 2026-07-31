import { authenticate } from "../shopify.server";
import { enqueueWebhookJob } from "../services/queue.server";

export const action = async ({ request }) => {
  const { shop, payload, topic, admin } = await authenticate.webhook(request);

  console.log(`CFP: Received ${topic} webhook for ${shop}. Enqueuing to BullMQ...`);

  try {
    await enqueueWebhookJob(topic, { shop, payload });
  } catch (error) {
    console.error(`CFP: Error enqueuing ${topic} webhook for ${shop}:`, error);
    return new Response("Error", { status: 500 });
  }

  return new Response("Success", { status: 200 });
};
