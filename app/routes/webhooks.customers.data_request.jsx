import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log("DATA REQUEST:", payload);

  // You must return customer data if you store any
  // For now, just acknowledge

  return new Response(null, { status: 200 });
};
