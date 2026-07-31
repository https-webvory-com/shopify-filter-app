import { authenticate } from "../shopify.server";
import { enqueueWebhookJob } from "../services/queue.server";

export const action = async ({ request }) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response("Unauthorized", { status: 401 });

  console.log(`Received ${topic} webhook for ${shop}. Enqueuing to BullMQ...`);

  try {
    // Enqueue job into BullMQ for asynchronous background processing
    await enqueueWebhookJob(topic, { shop, payload });
  } catch (error) {
    console.error(`Error enqueuing ${topic} webhook for ${shop}:`, error);
    return new Response("Error", { status: 500 });
  }

  // Immediately respond to Shopify with 200 OK (< 10ms)
  return new Response("Success", { status: 200 });
};
