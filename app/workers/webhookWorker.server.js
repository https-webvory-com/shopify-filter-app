import { Worker } from "bullmq";
import { redisOptions } from "../services/queue.server.js";
import prisma from "../db.server.js";
import { calculateProductScores, pushScoresToMeili } from "../services/orders.server.js";
import meiliClient from "../services/meiliClient.server.js";
import {productRankingFingerprint,productContentFingerprint} from '../utils/shopCacheInvalidation.js';
import {processCollectionRankingJob} from '../utils/processCollectionRankingJob.js';

let webhookWorker;

async function processWebhookJob(job) {
  const { name: topic, data } = job;
  const { shop, payload } = data;
  const normalizedTopic = (topic || "").replaceAll("/", "_").toUpperCase();

  console.log(`CFP Worker: Processing job #${job.id} - Topic: ${normalizedTopic} for Shop: ${shop}`);

  try {
    switch (normalizedTopic) {
      case "COLLECTION_BEST_SELLING_REFRESH": {
        const { refreshCollectionBestSelling } = await import("../services/collectionBestSelling.server.js");
        await refreshCollectionBestSelling(shop, data.collectionId);
        break;
      }
      case "ORDERS_PAID":
        await handleOrderPaid(shop, payload);
        break;

      case "ORDERS_CANCELLED":
        await handleOrderCancelled(shop, payload);
        break;

      case "INVENTORY_LEVELS_UPDATE":
      case "INVENTORY_ITEMS_UPDATE": {
        const {unauthenticated}=await import('../shopify.server.js');
        const {admin}=await unauthenticated.admin(shop);
        const itemId=payload.inventory_item_id || payload.id;
        if(!itemId)throw Error('Inventory webhook is missing its inventory item ID');
        const response=await(await admin.graphql(`query FilterInventoryProduct($id:ID!){inventoryItem(id:$id){variant{product{id}}}}`,{variables:{id:`gid://shopify/InventoryItem/${String(itemId).split('/').pop()}`}})).json();
        if(response.errors||!response.data||!Object.hasOwn(response.data,'inventoryItem'))throw Error('Could not resolve inventory webhook product');
        const id=response.data?.inventoryItem?.variant?.product?.id;
        if(id){
          await handleProductUpdate(shop,{id:String(id).split('/').pop(),admin_graphql_api_id:id},job);
          await (await import('../services/marketAvailability.server.js')).invalidateMarketAvailability(shop,id);
        }
        break;
      }
      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE":
        await handleProductUpdate(shop, payload, job);
        await (await import('../services/marketAvailability.server.js')).invalidateMarketAvailability(shop,payload.admin_graphql_api_id||payload.id);
        break;

      case "PRODUCTS_DELETE":
        await handleProductDelete(shop, payload, job);
        await (await import('../services/marketAvailability.server.js')).invalidateMarketAvailability(shop,payload.admin_graphql_api_id||payload.id);
        break;

      case "COLLECTIONS_CREATE":
      case "COLLECTIONS_UPDATE":
        await handleCollectionUpdate(shop, payload);
        break;

      case "COLLECTIONS_DELETE":
        await handleCollectionDelete(shop, payload);
        break;

      case "APP_UNINSTALLED":
        await handleAppUninstalled(shop);
        break;

      default:
        console.log(`CFP Worker: Topic ${normalizedTopic} processed.`);
        break;
    }
  } catch (error) {
    console.error(`CFP Worker Error processing job #${job.id} (${normalizedTopic}):`, error);
    throw error; // Re-throw to trigger BullMQ automatic retry!
  }
}

async function handleOrderPaid(shop, orderPayload) {
  const lineItems = orderPayload.line_items || [];
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true },
    });

    if (product) {
      const updated60 = (product.unitsSold60Days || 0) + qty;
      const updated7 = (product.unitsSold7Days || 0) + qty;

      const price = parseFloat(item.price || "0");
      const lineRevenue = price * qty;
      const updatedRevenue = (product.grossRevenue || 0.0) + lineRevenue;

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
        },
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    await pushScoresToMeili(shop,[...modifiedProductIds]);
  }
}

async function handleOrderCancelled(shop, orderPayload) {
  const lineItems = orderPayload.line_items || [];
  const modifiedProductIds = new Set();

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, unitsSold60Days: true, unitsSold7Days: true, grossRevenue: true, orderCount: true },
    });

    if (product) {
      const updated60 = Math.max(0, (product.unitsSold60Days || 0) - qty);
      const updated7 = Math.max(0, (product.unitsSold7Days || 0) - qty);

      const price = parseFloat(item.price || "0");
      const refundRevenue = price * qty;
      const updatedRevenue = Math.max(0, (product.grossRevenue || 0.0) - refundRevenue);

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
        },
      });
      modifiedProductIds.add(productId);
    }
  }

  if (modifiedProductIds.size > 0) {
    await pushScoresToMeili(shop,[...modifiedProductIds]);
  }
}

async function handleProductUpdate(shop, payload, job) {
  if (!payload.id) throw new Error("Product webhook is missing its product ID");
  const productId = payload.admin_graphql_api_id || `gid://shopify/Product/${payload.id}`;
  // Load at processing time to avoid the Redis -> worker -> sync -> Redis cycle.
  const { unauthenticated } = await import("../shopify.server.js");
  const { syncSingleProduct } = await import("../services/sync.server.js");
  const { invalidateShop } = await import("../services/shopCache.server.js");
  const { admin } = await unauthenticated.admin(shop);
  const beforeLinks=await prisma.productCollection.findMany({where:{productId,product:{shop}},select:{collectionId:true}});
  const index=meiliClient.index('products');
  const read=async()=>{try{const doc=await index.getDocument(String(productId).split('/').pop());if(doc.shop!==shop)throw Error('Product tenant mismatch');return doc;}catch(error){if(error.code==='document_not_found')return null;throw error;}};
  const before=await read();
  // Preserve the original comparison across BullMQ retries. Indexing may finish
  // before cache invalidation fails; the next attempt must not mistake that for
  // an unchanged webhook and permanently skip the invalidation.
  if (!job.data.rankingBefore) {
    await job.updateData({...job.data, rankingBefore: {
      fingerprint: productRankingFingerprint(before),
      contentFingerprint: productContentFingerprint(before),
      scoreFingerprint: JSON.stringify([before?.bestSellingScore,before?.trendingScore]),
      tags: before==null?[]:Array.isArray(before.tags)&&before.tags.every(t=>typeof t==='string')?before.tags:null,
      collectionIds: [...new Set([...beforeLinks.map(link=>link.collectionId),...(before?.collections||[])])],
    }});
  }
  await syncSingleProduct(shop, admin, productId, { retrySearchErrors: true });
  const after=await read();
  if(job.data.rankingBefore.fingerprint!==productRankingFingerprint(after)) {
    const collectionIds=[...new Set([...job.data.rankingBefore.collectionIds,...beforeLinks.map(link=>link.collectionId),...(after?.collections||[])])];
    const beforeTags=job.data.rankingBefore.tags,afterTags=after==null?[]:after.tags;
    const externalProof=Array.isArray(beforeTags)&&Array.isArray(afterTags)?{tags:[...new Set([...beforeTags,...afterTags])],ids:[String(productId).split('/').pop()]}:undefined;
    const contentChanged=typeof job.data.rankingBefore.contentFingerprint!=='string'||job.data.rankingBefore.contentFingerprint!==productContentFingerprint(after);
    const scoresChanged=job.data.rankingBefore.scoreFingerprint!==JSON.stringify([after?.bestSellingScore,after?.trendingScore]);
    if(contentChanged||scoresChanged)await invalidateShop(shop,{kind:contentChanged?'products':'scores',collectionIds,externalProof});
  }
  console.log(`CFP Worker: Product update synced for ${productId}`);
}

async function handleProductDelete(shop, payload, job) {
  if (!payload.id) throw new Error('Product webhook is missing its product ID');
  const productId = `gid://shopify/Product/${payload.id}`;
  const links=await prisma.productCollection.findMany({where:{productId,product:{shop}},select:{collectionId:true}});
  if (!job.data.deletedCollectionIds) await job.updateData({...job.data,deletedCollectionIds:links.map(link=>link.collectionId)});
  if(job.data.deletedProductTags===undefined){
    let tags=null;try{const p=await meiliClient.index('products').getDocument(String(payload.id));if(p.shop===shop&&Array.isArray(p.tags))tags=p.tags;}catch{}
    await job.updateData({...job.data,deletedProductTags:tags});
  }
  await prisma.product.deleteMany({ where: { id: productId, shop } });
  const numericId = payload.id.toString();
  const task=await meiliClient.index("products").deleteDocument(numericId);
  const completed=await meiliClient.tasks.waitForTask(task.taskUid,{timeout:120000});
  if(completed.status!=='succeeded')throw Error('Product deletion indexing failed');
  const {scheduleSearchIndexProducts}=await import('../services/searchIndex.server.js');
  await scheduleSearchIndexProducts(shop,[numericId],task.taskUid);
  const { invalidateShop } = await import("../services/shopCache.server.js");
  await invalidateShop(shop,{kind:'products',collectionIds:job.data.deletedCollectionIds,
    externalProof:Array.isArray(job.data.deletedProductTags)?{tags:job.data.deletedProductTags,ids:[numericId]}:undefined});
  console.log(`CFP Worker: Product ${productId} deleted from DB & Meilisearch.`);
}

async function handleCollectionUpdate(shop, payload) {
  const collectionId = `gid://shopify/Collection/${payload.id}`;
  await prisma.collection.upsert({
    where: { id: collectionId },
    update: { title: payload.title, handle: payload.handle },
    create: { id: collectionId, shop, title: payload.title, handle: payload.handle },
  });
  const { unauthenticated } = await import("../shopify.server.js");
  const { syncCollectionProducts } = await import("../services/sync.server.js");
  const { invalidateShop } = await import("../services/shopCache.server.js");
  const { invalidateCollectionBestSelling, refreshCollectionBestSelling } = await import("../services/collectionBestSelling.server.js");
  await invalidateCollectionBestSelling(shop, collectionId);
  const { admin } = await unauthenticated.admin(shop);
  await syncCollectionProducts(shop, admin, collectionId, { throwOnError: true });
  await invalidateShop(shop,{kind:'catalog',collectionIds:[collectionId]});
  await refreshCollectionBestSelling(shop, collectionId);
  console.log(`CFP Worker: Collection ${collectionId} updated.`);
}

async function handleCollectionDelete(shop, payload) {
  const collectionId = `gid://shopify/Collection/${payload.id}`;
  await prisma.collection.deleteMany({ where: { id: collectionId } });
  const { invalidateShop } = await import("../services/shopCache.server.js");
  await invalidateShop(shop,{kind:'catalog',collectionIds:[collectionId]});
  console.log(`CFP Worker: Collection ${collectionId} deleted.`);
}

async function handleAppUninstalled(shop) {
  await prisma.marketStorefrontConnection.deleteMany({where:{shop}});
  await prisma.marketAvailabilitySnapshot.deleteMany({where:{shop}});
  await prisma.session.deleteMany({ where: { shop } });
  console.log(`CFP Worker: App uninstalled cleanup completed for ${shop}.`);
}

export function initWebhookWorker() {
  // These callbacks are bundled with the worker. The raw Node launcher cannot
  // import source modules that rely on the app bundler's extension resolution.
  global.__scheduleCatalogDriftAudits = async () => {
    const {scheduleCatalogDriftAudits}=await import('../services/catalogDriftAudit.server.js');
    return scheduleCatalogDriftAudits();
  };
  global.__refreshConnectedMarketPriceCoverage = async () => {
    const {refreshConnectedMarketPriceCoverage}=await import('../services/marketPriceCoverage.server.js');
    return refreshConnectedMarketPriceCoverage();
  };
  if(!global.__marketAvailabilityWorker){
    global.__marketAvailabilityWorker=new Worker('marketAvailabilityQueueV1',async job=>{
      if(job.name==='COUNTRY_DISCOVERY')return (await import('../services/marketAvailability.server.js')).discoverMarketCountries(job.data);
      if(job.name!=='COUNTRY_STOCK')throw Error('Unknown country availability job');
      return (await import('../services/marketAvailability.server.js')).processMarketAvailability({...job.data,fullRefresh:job.data.fullRefresh&&job.attemptsMade===0});
    },{connection:{...redisOptions,maxRetriesPerRequest:null},concurrency:2});
    global.__marketAvailabilityWorker.on('error',()=>console.error('CFP: Country availability worker unavailable'));
    global.__marketAvailabilityWorker.on('failed',()=>console.error('CFP: Country availability refresh failed; retrying'));
  }
  global.__scheduleMembershipAudits = async () => {
    const {scheduleMembershipAudits} = await import('../services/collectionMembershipAudit.server.js');
    return scheduleMembershipAudits();
  };
  global.__reconcileLegacySynonymIndexes = async () =>
    (await import('../services/searchIndex.server.js')).reconcileLegacySynonymIndexes();
  if (!global.__collectionMembershipWorker) {
    global.__collectionMembershipWorker = new Worker('collectionMembershipQueueV1', async job => {
      if(job.name!=='VERIFY_COLLECTION_MEMBERSHIP')throw Error('Unknown membership audit job');
      const {processMembershipAudit}=await import('../services/collectionMembershipAudit.server.js');
      return processMembershipAudit(job.data);
    }, {connection:{...redisOptions,maxRetriesPerRequest:null},concurrency:1});
    global.__collectionMembershipWorker.on('error',error=>console.error('CFP Membership Worker:',error.message));
    global.__collectionMembershipWorker.on('failed',(job,error)=>console.error('CFP Membership audit failed:',job?.id,error.message));
  }
  global.__schedulePublicCollectionWarmups = async () => {
    const { scheduleRegisteredCollectionWarmups } = await import('../services/collectionPreparation.server.js');
    return scheduleRegisteredCollectionWarmups();
  };
  if (!global.__collectionOrderWorker) {
    // An independent, bounded lane for first visits without a saved Shopify
    // order. Keep the legacy webhook handler above for already queued jobs.
    global.__collectionOrderWorker = new Worker('collectionOrderQueueV1', async job => {
      if (job.name !== 'COLLECTION_BEST_SELLING_REFRESH') throw new Error('Unknown collection order job');
      const { refreshCollectionBestSelling } = await import('../services/collectionBestSelling.server.js');
      await refreshCollectionBestSelling(job.data.shop, job.data.collectionId);
    }, { connection: { ...redisOptions, maxRetriesPerRequest: null }, concurrency: 1 });
    global.__collectionOrderWorker.on('error', error => console.error('CFP Collection Order Worker:', error.message));
    global.__collectionOrderWorker.on('failed', (job, error) => console.error('CFP Collection Order Worker failed:', job?.id, error.message));
  }
  if (!global.__collectionRankingWorker) {
    global.__collectionRankingWorker = new Worker('collectionRankingQueueV2', async job => {
      const { processCollectionPreparation, processCollectionWarmups, scheduleCollectionWarmup } = await import('../services/collectionPreparation.server.js');
      return processCollectionRankingJob(job,{prepare:processCollectionPreparation,warm:processCollectionWarmups,schedule:scheduleCollectionWarmup,
        facts:async data=>(await import('../services/collectionRuleFacts.server.js')).processCollectionFactRefresh(data)});
    }, { connection: { ...redisOptions, maxRetriesPerRequest: null }, concurrency: 1 });
    global.__collectionRankingWorker.on('error', error => console.error('CFP Ranking Worker:', error.message));
    global.__collectionRankingWorker.on('failed', (job, error) => console.error('CFP Ranking Worker failed:', job?.id, error.message));
  }
  if (!global.__synonymWorker) {
    global.__synonymWorker = new Worker('synonymActivationQueueV1', async job => {
      if (job.name !== 'APPLY_SYNONYMS') throw Error('Unknown synonym job');
      return (await import('../services/synonymActivation.server.js')).processSynonymActivation(job.data);
    }, {connection: {...redisOptions, maxRetriesPerRequest: null}, concurrency: 1, lockDuration: 300000});
    global.__synonymWorker.on('error', error => console.error('CFP Synonym Worker:', error.message));
    global.__synonymWorker.on('failed', (job, error) => console.error('CFP Synonym activation failed:', job?.id, error.message));
  }
  if (!global.__searchIndexWorker) {
    global.__searchIndexWorker = new Worker('searchIndexQueueV1', async job => {
      if (!['SEARCH_INDEX_BUILD','SEARCH_INDEX_PRODUCTS','SEARCH_INDEX_RETIRE'].includes(job.name))
        throw Error('Unknown search index job');
      return (await import('../services/searchIndex.server.js')).processSearchIndexJob(job.data);
    }, { connection: { ...redisOptions, maxRetriesPerRequest: null }, concurrency: 1 });
    global.__searchIndexWorker.on('error', error => console.error('CFP Search Index Worker:', error.message));
    global.__searchIndexWorker.on('failed', (job, error) => console.error('CFP Search index failed:', job?.id, error.message));
  }
  if (!global.__webhookWorker) {
    global.__webhookWorker = new Worker("webhookQueue", processWebhookJob, {
      connection: { ...redisOptions, maxRetriesPerRequest: null },
      concurrency: Math.max(1, Math.min(10, parseInt(process.env.CFP_WEBHOOK_CONCURRENCY, 10) || 5)),
    });

    global.__webhookWorker.on("completed", (job) => {
      console.log(`CFP Worker: Job #${job.id} (${job.name}) completed successfully!`);
    });

    global.__webhookWorker.on("failed", (job, err) => {
      console.error(`CFP Worker: Job #${job?.id} (${job?.name}) failed:`, err.message);
    });

    global.__webhookWorker.on("error", (err) => {
      console.error("CFP Worker: Redis/worker error:", err);
    });

    console.log("CFP Worker: BullMQ Webhook Worker initialized (concurrency: " + global.__webhookWorker.opts.concurrency + ").");
  }
  webhookWorker = global.__webhookWorker;
  return webhookWorker;
}
