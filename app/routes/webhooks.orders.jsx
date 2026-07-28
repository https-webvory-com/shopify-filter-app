import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { calculateProductScores, pushScoresToMeili } from "../services/orders.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response("Unauthorized", { status: 401 });

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    if (topic === "ORDERS_PAID") {
      await handleOrderPaid(shop, payload);
    } else if (topic === "ORDERS_CANCELLED") {
      await handleOrderCancelled(shop, payload);
    }
  } catch (error) {
    console.error(`Error processing ${topic} webhook for ${shop}:`, error);
    return new Response("Error", { status: 500 });
  }

  return new Response("Success", { status: 200 });
};

async function handleOrderPaid(shop, orderPayload) {
  const lineItems = orderPayload.line_items || [];
  
  // Track unique products modified in this order
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true }
    });

    if (product) {
      const updated60 = (product.unitsSold60Days || 0) + qty;
      const updated7 = (product.unitsSold7Days || 0) + qty;
      
      const price = parseFloat(item.price || "0");
      const lineRevenue = price * qty;
      const updatedRevenue = (product.grossRevenue || 0.0) + lineRevenue;
      
      // If we haven't processed this product in this order yet, increment order count
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
        }
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    // Push the updated scores to Meilisearch
    await pushScoresToMeili(shop);
  }
}

async function handleOrderCancelled(shop, orderPayload) {
  // If order is cancelled, we might want to deduct the quantities
  const lineItems = orderPayload.line_items || [];
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true }
    });

    if (product) {
      const updated60 = Math.max(0, (product.unitsSold60Days || 0) - qty);
      const updated7 = Math.max(0, (product.unitsSold7Days || 0) - qty);
      
      const price = parseFloat(item.price || "0");
      const refundRevenue = price * qty;
      const updatedRevenue = Math.max(0, (product.grossRevenue || 0.0) - refundRevenue);
      
      // Order count deduction is tricky if partial refund, so we leave orderCount as is for simplicity
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
        }
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    await pushScoresToMeili(shop);
  }
}
