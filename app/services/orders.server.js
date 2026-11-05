import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import meiliClient from "./meiliClient.server.js";
import { replaceSalesMetrics } from './salesMetrics.server.js';
import { readOrderPage, validateOrderScanCount } from '../utils/orderPage.js';

/**
 * Syncs ALL historical orders (all-time) for the shop and updates bestSellingScore metrics.
 * Uses read_all_orders scope for complete lifetime sales data.
 * Tracks progress in DB so UI can poll for real-time updates.
 */
export async function syncHistoricalOrders(shop) {
  // Create a job record for progress tracking
  const job = await prisma.syncJob.create({
    data: {
      shop,
      kind: "ORDERS",
      status: "IN_PROGRESS",
      productsProcessed: 0,
      totalProducts: null,
    }
  });
  const jobId = job.id;
  const heartbeat = setInterval(() => {
    prisma.syncJob.updateMany({ where: { id: jobId, status: 'IN_PROGRESS' }, data: { updatedAt: new Date() } })
      .catch(error => console.error(`OrdersSync [${jobId}]: Heartbeat failed:`, error.name));
  }, 60000);
  heartbeat.unref?.();

  try {
    const { admin } = await unauthenticated.admin(shop);
    if (!admin) {
      await prisma.syncJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
      console.error(`OrdersSync: Unauthenticated admin failed for ${shop}`);
      return false;
    }

    console.log(`OrdersSync [${jobId}]: Starting ALL-TIME historical order sync for ${shop}...`);

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

      // An all-time scan can outlive an expiring Shopify offline token. Resolve
      // the client on each page so the app's session helper can refresh it.
      const page = await readOrderPage(async () => (await unauthenticated.admin(shop)).admin, query, cursor);
      const orders = page.nodes;
      const pageInfo = page.pageInfo;
      if (pageInfo.hasNextPage && (!pageInfo.endCursor || pageInfo.endCursor === cursor))
        throw Error('Shopify orders pagination did not advance');
      pageCount++;

      if (pageCount % 10 === 0) {
        console.log(`OrdersSync [${jobId}]: Processed ${processedOrders} orders so far (page ${pageCount})...`);
        // Update progress in DB every 10 pages (~1000 orders)
        await prisma.syncJob.update({
          where: { id: jobId },
          data: { productsProcessed: processedOrders, updatedAt: new Date() }
        });
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

    const previousComplete = await prisma.syncJob.findFirst({ where: {
      shop, kind: 'ORDERS', status: 'COMPLETED', id: { not: jobId },
    }, orderBy: { createdAt: 'desc' }, select: { productsProcessed: true } });
    validateOrderScanCount(processedOrders, previousComplete?.productsProcessed);
    console.log(`OrdersSync [${jobId}]: Fetched ALL ${processedOrders} orders across ${pageCount} pages. Updating ${Object.keys(productAggregations).length} products...`);

    // Update job status to show we're now in the DB update phase
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        productsProcessed: processedOrders,
        totalProducts: null, // Preserve the orders-job discriminator.
        status: "IN_PROGRESS",
      }
    });

    const updatedCount = await replaceSalesMetrics(shop, productAggregations);

    console.log(`OrdersSync [${jobId}]: Updated ${updatedCount} products with ALL-TIME order metrics.`);

    // Push updated scores to Meilisearch immediately
    await pushScoresToMeili(shop);

    // Mark job as COMPLETED
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        productsProcessed: processedOrders,
        totalProducts: null,
        completedAt: new Date(),
        lastError: null,
      }
    });

    return true;
  } catch (error) {
    console.error(`OrdersSync [${jobId}]: Error syncing historical orders for ${shop}:`, error);
    // Mark job as FAILED
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "FAILED", lastError: String(error.message || error.name).replace(/https?:\/\/\S+/g, '[url]').slice(0, 500) }
    }).catch(() => {}); // Ignore if DB is also down
    return false;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Calculates Best Selling Score and Trending Score based on advanced metrics.
 * Uses lifetime sales data for bestSellingScore to get accurate ranking.
 * Pure volume-based (units sold only) to match SoBooster's approach.
 */
export function calculateProductScores(unitsLifetime, unitsSold7Days, revenueLifetime, orderCount) {
  // Best Selling Score = pure lifetime units sold (volume-based, matches SoBooster)
  // NOT weighted by revenue - revenue-weighting unfairly boosts expensive low-volume products
  const bestSellingScore = unitsLifetime;

  // Trending Score = recency-weighted: recent 7-day sales get 60% weight, lifetime 40%
  // Higher weight on recent sales for trending to surface newly popular items
  const trendingScore = (unitsLifetime * 0.4) + (unitsSold7Days * 0.6);

  return {
    bestSellingScore: parseFloat(bestSellingScore.toFixed(2)),
    trendingScore: parseFloat(trendingScore.toFixed(2))
  };
}

/**
 * Pushes updated scores to Meilisearch for the given shop.
 * Uses batch updates for efficiency.
 */
export async function pushScoresToMeili(shop, changedProductIds=null) {
  try {
    // Fetch all products with their scores
    const products = await prisma.product.findMany({
      where: { shop,...(changedProductIds?{id:{in:[...new Set(changedProductIds)]}}:{}) },
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
    const scoreTasks=[];
    for (let i = 0; i < meiliDocs.length; i += MEILI_BATCH) {
      const batch = meiliDocs.slice(i, i + MEILI_BATCH);
      const task=await meiliClient.index("products").updateDocuments(batch);
      if(task?.taskUid!=null)scoreTasks.push(task.taskUid);
      console.log(`OrdersSync: Pushed batch ${Math.floor(i / MEILI_BATCH) + 1} to Meilisearch (${batch.length} products).`);
    }

    // Let Meili batch queued writes efficiently; bound completion polling.
    // Partial success still changes ranking inputs and must invalidate caches.
    let succeeded=0,failed=false;
    for(let offset=0;offset<scoreTasks.length;offset+=8){
      const results=await Promise.allSettled(scoreTasks.slice(offset,offset+8).map(id=>meiliClient.tasks.waitForTask(id,{timeout:120000,interval:100})));
      for(const result of results)if(result.status==='fulfilled'&&result.value.status==='succeeded')succeeded++;else failed=true;
    }
    if(succeeded||!scoreTasks.length){
      const {invalidateShop}=await import('./shopCache.server.js');
      const memberships=await prisma.productCollection.findMany({where:{product:{shop},...(changedProductIds?{productId:{in:[...new Set(changedProductIds)]}}:{})},select:{collectionId:true},distinct:['collectionId']});
      // Use visible index tags, which may differ from a concurrent DB sync.
      // An unavailable/incomplete proof retains broad invalidation.
      let externalProof;const scoreIndex=meiliClient.index('products');
      if(changedProductIds&&meiliDocs.length<=2000&&typeof scoreIndex.getDocuments==='function')try{
        const tags=new Set(),ids=[];
        for(let offset=0;offset<meiliDocs.length;offset+=250){
          const wanted=new Set(meiliDocs.slice(offset,offset+250).map(p=>p.id));
          const response=await scoreIndex.getDocuments({filter:'id IN '+JSON.stringify([...wanted]),fields:['id','shop','tags'],limit:wanted.size,offset:0});
          if(!Array.isArray(response.results)||response.results.length!==wanted.size)throw Error('Incomplete sales dependency proof');
          for(const p of response.results){
            if(p.shop!==shop||!wanted.delete(String(p.id))||!Array.isArray(p.tags)||p.tags.some(t=>typeof t!=='string'))throw Error('Invalid sales dependency proof');
            ids.push(String(p.id));for(const tag of p.tags)tags.add(tag);
          }
        }
        externalProof={tags:[...tags],ids};
      }catch(error){console.error('OrdersSync: Using broad dependency invalidation:',error.name);}
      await invalidateShop(shop,{kind:'scores',collectionIds:memberships.map(row=>row.collectionId),externalProof});
    }
    if(failed)throw Error('Some sales-score indexing tasks failed');
    console.log(`OrdersSync: ✅ Pushed score updates to Meilisearch for ALL ${meiliDocs.length} products.`);
  } catch (error) {
    console.error("OrdersSync: Failed to push scores to Meilisearch:", error);
    throw error;
  }
}
