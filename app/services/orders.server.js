import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import meiliClient from "./meiliClient.server.js";

/**
 * Syncs ALL historical orders (all-time) for the shop and updates bestSellingScore metrics.
 * Uses read_all_orders scope for complete lifetime sales data.
 */
export async function syncHistoricalOrders(shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    if (!admin) {
      console.error(`OrdersSync: Unauthenticated admin failed for ${shop}`);
      return false;
    }

    console.log(`OrdersSync: Starting ALL-TIME historical order sync for ${shop}...`);

    let cursor = null;
    let hasNextPage = true;
    let processedOrders = 0;
    let pageCount = 0;

    // Using a map to aggregate data per product (all-time lifetime)
    const productAggregations = {};

    // Calculate date thresholds for trending scores
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Fetch ALL orders (no date filter) using read_all_orders scope
    while (hasNextPage) {
      const query = `
        query getOrders($cursor: String) {
          orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
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
      pageCount++;

      if (pageCount % 10 === 0) {
        console.log(`OrdersSync: Processed ${processedOrders} orders so far (page ${pageCount})...`);
      }

      for (const order of orders) {
        const orderDate = new Date(order.createdAt);
        const isRecent7Days = orderDate >= sevenDaysAgo;
        const isRecent60Days = orderDate >= sixtyDaysAgo;

        // Track unique products in this order
        const uniqueProductsInOrder = new Set();

        // Process Line Items (Sales)
        for (const lineItem of order.lineItems.nodes) {
          const productId = lineItem.product?.id;
          if (!productId) continue;

          if (!productAggregations[productId]) {
            productAggregations[productId] = {
              unitsLifetime: 0,
              unitsSold60Days: 0,
              unitsSold7Days: 0,
              revenueLifetime: 0.0,
              grossRevenue: 0.0,
              orderCount: 0,
            };
          }

          const qty = lineItem.quantity || 0;
          const lineRevenue = parseFloat(lineItem.originalTotalSet?.shopMoney?.amount || "0");

          // Lifetime totals
          productAggregations[productId].unitsLifetime += qty;
          productAggregations[productId].revenueLifetime += lineRevenue;

          // 60-day window
          if (isRecent60Days) {
            productAggregations[productId].unitsSold60Days += qty;
            productAggregations[productId].grossRevenue += lineRevenue;
          }

          // 7-day window (trending)
          if (isRecent7Days) {
            productAggregations[productId].unitsSold7Days += qty;
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
              if (!productId || !productAggregations[productId]) continue;

              const refundQty = rli.quantity || 0;
              const refundUnitAmount = parseFloat(rli.lineItem?.originalUnitPriceSet?.shopMoney?.amount || "0");
              const refundTotal = refundUnitAmount * refundQty;

              // Deduct from lifetime
              productAggregations[productId].unitsLifetime = Math.max(0, productAggregations[productId].unitsLifetime - refundQty);
              productAggregations[productId].revenueLifetime = Math.max(0, productAggregations[productId].revenueLifetime - refundTotal);

              // Deduct from 60-day if applicable
              productAggregations[productId].unitsSold60Days = Math.max(0, productAggregations[productId].unitsSold60Days - refundQty);
              productAggregations[productId].grossRevenue = Math.max(0, productAggregations[productId].grossRevenue - refundTotal);

              if (isRecent7Days) {
                productAggregations[productId].unitsSold7Days = Math.max(0, productAggregations[productId].unitsSold7Days - refundQty);
              }
            }
          }
        }
        processedOrders++;
      }

      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;
    }

    console.log(`OrdersSync: Fetched ALL ${processedOrders} orders across ${pageCount} pages. Updating ${Object.keys(productAggregations).length} products...`);

    // Reset metrics for all products before applying fresh aggregations
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

    // Update Prisma and calculate scores using LIFETIME data
    let updatedCount = 0;
    const productIds = Object.keys(productAggregations);

    // Process in batches of 50 for efficiency
    const BATCH_SIZE = 50;
    for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
      const batch = productIds.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (productId) => {
        const stats = productAggregations[productId];

        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { id: true }
        });

        if (!product) return;

        const scores = calculateProductScores(
          stats.unitsLifetime,   // Use lifetime units for bestSellingScore
          stats.unitsSold7Days,
          stats.revenueLifetime, // Use lifetime revenue for bestSellingScore
          stats.orderCount
        );

        await prisma.product.update({
          where: { id: productId },
          data: {
            unitsSold60Days: stats.unitsSold60Days,
            unitsSold7Days: stats.unitsSold7Days,
            grossRevenue: stats.revenueLifetime,
            orderCount: stats.orderCount,
            bestSellingScore: scores.bestSellingScore,
            trendingScore: scores.trendingScore,
          }
        });
        updatedCount++;
      }));

      if (i % 500 === 0 && i > 0) {
        console.log(`OrdersSync: Updated ${updatedCount} products so far...`);
      }
    }

    console.log(`OrdersSync: Updated ${updatedCount} products with ALL-TIME order metrics.`);

    // Push updated scores to Meilisearch immediately
    await pushScoresToMeili(shop);

    return true;
  } catch (error) {
    console.error(`OrdersSync: Error syncing historical orders for ${shop}:`, error);
    return false;
  }
}

/**
 * Calculates Best Selling Score and Trending Score based on advanced metrics.
 * Uses lifetime sales data for bestSellingScore to get accurate ranking.
 */
export function calculateProductScores(unitsLifetime, unitsSold7Days, revenueLifetime, orderCount) {
  // Best Selling Score = (Lifetime Units × 0.6) + (Lifetime Revenue / 100 × 0.4)
  // Using lifetime data gives true bestseller ranking
  const bestSellingScore = (unitsLifetime * 0.6) + ((revenueLifetime / 100) * 0.4);

  // Trending Score = (Lifetime Units × 0.3) + (Revenue / 100 × 0.2) + (Order Count × 0.1) + (Recent 7-day Sales × 0.4)
  // Higher weight on recent sales for trending
  const trendingScore = (unitsLifetime * 0.3) + ((revenueLifetime / 100) * 0.2) + (orderCount * 0.1) + (unitsSold7Days * 0.4);

  return {
    bestSellingScore: parseFloat(bestSellingScore.toFixed(2)),
    trendingScore: parseFloat(trendingScore.toFixed(2))
  };
}

/**
 * Pushes updated scores to Meilisearch for the given shop.
 * Uses batch updates for efficiency.
 */
export async function pushScoresToMeili(shop) {
  try {
    // Fetch all products with their scores
    const products = await prisma.product.findMany({
      where: { shop },
      select: {
        id: true,
        bestSellingScore: true,
        trendingScore: true,
      }
    });

    if (products.length === 0) return;

    // Meilisearch uses numeric ID (last part of GID)
    const meiliDocs = products.map(p => ({
      id: p.id.includes("/") ? p.id.split("/").pop() : p.id,
      bestSellingScore: p.bestSellingScore,
      trendingScore: p.trendingScore,
    }));

    // Push in batches of 1000 to avoid timeouts
    const MEILI_BATCH = 1000;
    for (let i = 0; i < meiliDocs.length; i += MEILI_BATCH) {
      const batch = meiliDocs.slice(i, i + MEILI_BATCH);
      await meiliClient.index("products").updateDocuments(batch);
      console.log(`OrdersSync: Pushed batch ${Math.floor(i / MEILI_BATCH) + 1} to Meilisearch (${batch.length} products).`);
    }

    console.log(`OrdersSync: ✅ Pushed score updates to Meilisearch for ALL ${meiliDocs.length} products.`);
  } catch (error) {
    console.error("OrdersSync: Failed to push scores to Meilisearch:", error);
  }
}
