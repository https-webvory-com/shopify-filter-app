import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import meiliClient from "./meiliClient.server";

const SCORE_WEIGHTS = {
  bestSellingLifetime: 0.7,
  bestSellingRecent: 0.3,
};

/**
 * Syncs the last 60 days of orders for the shop and updates unitsSold metrics.
 */
export async function syncHistoricalOrders(shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    if (!admin) {
      console.error(`OrdersSync: Unauthenticated admin failed for ${shop}`);
      return false;
    }

    console.log(`OrdersSync: Starting historical order sync for ${shop}...`);

    let cursor = null;
    let hasNextPage = true;
    let processedOrders = 0;
    
    // Using a map to aggregate data per product
    const productAggregations = {};

    // Calculate dates
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Use only YYYY-MM-DD to prevent colons from breaking Shopify GraphQL search syntax
    const sixtyDaysAgoStr = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    while (hasNextPage) {
      const query = `
        query getOrders($cursor: String) {
          orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true, query: "created_at:>=${sixtyDaysAgoStr}") {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              createdAt
              lineItems(first: 50) {
                nodes {
                  product {
                    id
                  }
                  quantity
                  originalTotalSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
              refunds {
                refundLineItems(first: 50) {
                  nodes {
                    lineItem {
                      product {
                        id
                      }
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                    quantity
                  }
                }
              }
            }
          }
        }
      `;

      const response = await admin.graphql(query, {
        variables: { cursor },
      });

      const json = await response.json();
      if (json.errors) {
        console.error("OrdersSync: GraphQL Errors:", JSON.stringify(json.errors, null, 2));
        break;
      }

      const orders = json.data?.orders?.nodes || [];
      const pageInfo = json.data?.orders?.pageInfo;

      for (const order of orders) {
        const orderDate = new Date(order.createdAt);
        const isRecent = orderDate >= sevenDaysAgo;

        // Track unique products in this order
        const uniqueProductsInOrder = new Set();

        // Process Line Items (Sales)
        for (const lineItem of order.lineItems.nodes) {
          const productId = lineItem.product?.id;
          if (!productId) continue;

          if (!productAggregations[productId]) {
            productAggregations[productId] = { unitsSold60Days: 0, unitsSold7Days: 0, grossRevenue: 0.0, orderCount: 0 };
          }

          productAggregations[productId].unitsSold60Days += lineItem.quantity;
          
          const lineRevenue = parseFloat(lineItem.originalTotalSet?.shopMoney?.amount || "0");
          productAggregations[productId].grossRevenue += lineRevenue;

          if (isRecent) {
            productAggregations[productId].unitsSold7Days += lineItem.quantity;
          }

          uniqueProductsInOrder.add(productId);
        }

        // Increment orderCount for all products in this order
        uniqueProductsInOrder.forEach(productId => {
          productAggregations[productId].orderCount += 1;
        });

        // Process Refunds (Deductions)
        if (order.refunds && order.refunds.length > 0) {
          for (const refund of order.refunds) {
            for (const rli of refund.refundLineItems.nodes) {
              const productId = rli.lineItem?.product?.id;
              if (!productId) continue;

              if (!productAggregations[productId]) {
                productAggregations[productId] = { unitsSold60Days: 0, unitsSold7Days: 0, grossRevenue: 0.0, orderCount: 0 };
              }

              // Safely deduct units without going below 0
              productAggregations[productId].unitsSold60Days = Math.max(0, productAggregations[productId].unitsSold60Days - rli.quantity);
              
              const refundUnitAmount = parseFloat(rli.lineItem?.originalUnitPriceSet?.shopMoney?.amount || "0");
              const refundTotal = refundUnitAmount * rli.quantity;
              productAggregations[productId].grossRevenue = Math.max(0, productAggregations[productId].grossRevenue - refundTotal);

              if (isRecent) {
                productAggregations[productId].unitsSold7Days = Math.max(0, productAggregations[productId].unitsSold7Days - rli.quantity);
              }
            }
          }
        }
        processedOrders++;
      }

      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;
    }

    console.log(`OrdersSync: Fetched ${processedOrders} orders. Updating products...`);

    // Reset metrics for all products before applying the new 60-day aggregations
    await prisma.product.updateMany({
      where: { shop },
      data: {
        unitsSold60Days: 0,
        unitsSold7Days: 0,
        grossRevenue: 0.0,
        orderCount: 0,
        bestSellingScore: 0.0,
        trendingScore: 0.0,
      }
    });

    // Update Prisma and calculate scores
    let updatedCount = 0;
    for (const [productId, stats] of Object.entries(productAggregations)) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, createdAt: true }
      });

      if (!product) continue;

      const scores = calculateProductScores(
        stats.unitsSold60Days,
        stats.unitsSold7Days,
        stats.grossRevenue,
        stats.orderCount
      );

      await prisma.product.update({
        where: { id: productId },
        data: {
          unitsSold60Days: stats.unitsSold60Days,
          unitsSold7Days: stats.unitsSold7Days,
          grossRevenue: stats.grossRevenue,
          orderCount: stats.orderCount,
          bestSellingScore: scores.bestSellingScore,
          trendingScore: scores.trendingScore,
        }
      });
      updatedCount++;
    }

    console.log(`OrdersSync: Updated ${updatedCount} products with order metrics.`);
    
    // We should ideally sync these score updates to Meilisearch now
    await pushScoresToMeili(shop);

    return true;
  } catch (error) {
    console.error(`OrdersSync: Error syncing historical orders for ${shop}:`, error);
    return false;
  }
}

/**
 * Calculates Best Selling Score and Trending Score based on advanced metrics.
 */
export function calculateProductScores(unitsSold60Days, unitsSold7Days, grossRevenue, orderCount) {
  // Best Selling Score = (Units Sold × 0.7) + (Gross Revenue / 100 × 0.3)
  const bestSellingScore = (unitsSold60Days * 0.7) + ((grossRevenue / 100) * 0.3);

  // Trending Score = (Units Sold × 0.5) + (Revenue / 100 × 0.2) + (Order Count × 0.2) + (Recent Sales × 0.1)
  const trendingScore = (unitsSold60Days * 0.5) + ((grossRevenue / 100) * 0.2) + (orderCount * 0.2) + (unitsSold7Days * 0.1);

  return {
    bestSellingScore: parseFloat(bestSellingScore.toFixed(2)),
    trendingScore: parseFloat(trendingScore.toFixed(2))
  };
}

/**
 * Pushes updated scores to Meilisearch for the given shop.
 */
export async function pushScoresToMeili(shop) {
  try {
    const products = await prisma.product.findMany({
      where: { shop, status: "active" },
      select: {
        id: true,
        bestSellingScore: true,
        trendingScore: true,
      }
    });

    if (products.length === 0) return;

    const meiliDocs = products.map(p => ({
      id: p.id,
      bestSellingScore: p.bestSellingScore,
      trendingScore: p.trendingScore,
    }));

    // Update documents in Meilisearch
    await meiliClient.index("products").updateDocuments(meiliDocs);
    console.log(`OrdersSync: Pushed score updates to Meilisearch for ${meiliDocs.length} products.`);
  } catch (error) {
    console.error("OrdersSync: Failed to push scores to Meilisearch:", error);
  }
}
