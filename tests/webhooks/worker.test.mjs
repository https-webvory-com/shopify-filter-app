import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {productRankingFingerprint,productContentFingerprint} from '../../app/utils/shopCacheInvalidation.js';

async function loadWorker(syncError, unchanged=false, invalidationFailsOnce=false,changeMode='content') {
  const calls = [],invalidations=[],marketChanges=[];
  const admin = {graphql:async()=>({json:async()=>({data:{inventoryItem:{variant:{product:{id:'gid://shopify/Product/1'}}}}})})};
  let synced=false,deleted=false,activeShop='fixture.myshopify.com';
  const source = (await fs.readFile("app/workers/webhookWorker.server.js", "utf8"))
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("await import(", "await loadModule(")
    .replace("export function initWebhookWorker", "function initWebhookWorker");
  const context = vm.createContext({
    productRankingFingerprint,productContentFingerprint,
    meiliClient:{index:()=>({getDocument:async()=>({shop:activeShop,priceMin:synced&&!unchanged&&changeMode==='content'?2:1,tags:synced&&!unchanged&&changeMode==='content'?['NewTag']:['OldTag'],bestSellingScore:synced&&changeMode==='scores'?2:1,cfpCollectionInputSource:synced&&changeMode==='derived'?'new-derived':'original-derived',cfpFilterFacts:{weights:[synced&&changeMode==='filterFacts'?200:100]},collections:['gid://shopify/Collection/1']}),deleteDocument:async()=>({taskUid:1})}),tasks:{waitForTask:async()=>({status:'succeeded'})}},
    console: { log() {}, error() {} },
    prisma: {marketStorefrontConnection:{deleteMany:async({where})=>marketChanges.push(['connection-deleted',where.shop])},marketAvailabilitySnapshot:{deleteMany:async({where})=>marketChanges.push(['snapshots-deleted',where.shop])},product:{deleteMany:async({where})=>{assert.equal(where.shop,activeShop);deleted=true;}},productCollection:{findMany:async()=>deleted?[]:[{collectionId:'gid://shopify/Collection/1'}]}, collection: { upsert: async () => calls.push(["collection-metadata"]) }, session: { deleteMany: async (query) => calls.push(["uninstall", query.where.shop]) } },
    async loadModule(path) {
      if(path.includes('marketAvailability'))return {invalidateMarketAvailability:async(shop,id)=>marketChanges.push(['stock',shop,id])};
      if (path.includes("collectionBestSelling")) return { invalidateCollectionBestSelling: async (shop, collectionId) => calls.push(["collection-stale", shop, collectionId]), refreshCollectionBestSelling: async (shop, collectionId) => {
        calls.push(["collection-order", shop, collectionId]);
        if (syncError) throw syncError;
      } };
      if (path.includes("shopify.server")) return { unauthenticated: { admin: async (shop) => {
        activeShop=shop;
        calls.push(["admin", shop]); return { admin };
      } } };
      if (path.includes("sync.server")) return { syncCollectionProducts: async (shop, client, id, options) => {
        assert.equal(client, admin); assert.equal(options.throwOnError, true);
        calls.push(["collection-membership", shop, id]);
        if (syncError) throw syncError;
      }, syncSingleProduct: async (shop, client, id, options) => {
        assert.equal(client, admin);
        assert.equal(options.retrySearchErrors, true);
        calls.push(["sync", shop, id]);
        if (syncError) throw syncError;
        synced=true;
      } };
      if (path.includes("shopCache")) return { invalidateShop: async (shop,options) => {invalidations.push(options);calls.push(["invalidate", shop]);if(invalidationFailsOnce){invalidationFailsOnce=false;throw Error('Invalidation unavailable');}} };
      throw new Error(`Unexpected module: ${path}`);
    },
  });
  vm.runInContext(source, context);
  const processor=vm.runInContext("processWebhookJob", context);
  return { process:job=>{job.updateData=async data=>{job.data=data;};return processor(job);}, calls,invalidations,marketChanges };
}

test("collection updates synchronize eligibility and refresh Shopify ordering", async () => {
  const worker = await loadWorker();
  const job = { name: "COLLECTIONS_UPDATE", data: { shop: "fixture", payload: { id: 1, title: "Collection", handle: "collection" } } };
  await worker.process(job);
  assert.deepEqual(worker.calls, [["collection-metadata"], ["collection-stale", "fixture", "gid://shopify/Collection/1"], ["admin", "fixture"], ["collection-membership", "fixture", "gid://shopify/Collection/1"], ["invalidate", "fixture"], ["collection-order", "fixture", "gid://shopify/Collection/1"]]);
  const error = new Error("Membership unavailable");
  await assert.rejects((await loadWorker(error)).process(job), error);
});

test("collection order refreshes run in the worker and failures trigger queue retries", async () => {
  const job = { name: "COLLECTION_BEST_SELLING_REFRESH", data: { shop: "fixture", collectionId: "gid://shopify/Collection/1" } };
  const worker = await loadWorker();
  await worker.process(job);
  assert.deepEqual(worker.calls, [["collection-order", "fixture", "gid://shopify/Collection/1"]]);
  const error = new Error("Shopify unavailable");
  await assert.rejects((await loadWorker(error)).process(job), error);
});

for (const topic of ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "products/update"]) {
  test(`${topic} syncs the product and invalidates the shop cache`, async () => {
    const worker = await loadWorker();
    await worker.process({ name: topic, data: { shop: "fixture.myshopify.com", payload: { id: 123 } } });
    assert.deepEqual(worker.calls, [
      ["admin", "fixture.myshopify.com"],
      ["sync", "fixture.myshopify.com", "gid://shopify/Product/123"],
      ["invalidate", "fixture.myshopify.com"],
    ]);
  });
}

test("sync errors escape the processor so BullMQ retries the job", async () => {
  const error = new Error("Search unavailable");
  const worker = await loadWorker(error);
  await assert.rejects(worker.process({ name: "PRODUCTS_UPDATE", data: { shop: "fixture", payload: { id: 123 } } }), error);
  assert.equal(worker.calls.some(([type]) => type === "invalidate"), false);
});

test("uninstall cleanup deletes only the shop's sessions", async () => {
  const worker = await loadWorker();
  await worker.process({ name: "APP_UNINSTALLED", data: { shop: "fixture", payload: {} } });
  assert.deepEqual(worker.calls, [["uninstall", "fixture"]]);
  assert.deepEqual(worker.marketChanges,[['connection-deleted','fixture'],['snapshots-deleted','fixture']]);
});

test('unchanged indexed product updates do not invalidate or rebuild collection rankings',async()=>{
  const worker=await loadWorker(undefined,true);
  await worker.process({name:'PRODUCTS_UPDATE',data:{shop:'fixture.myshopify.com',payload:{id:123}}});
  assert.equal(worker.calls.some(([type])=>type==='sync'),true);
  assert.equal(worker.calls.some(([type])=>type==='invalidate'),false);
});

test('score-only webhooks use score invalidation and derived index metadata cannot pretend to be product edits',async()=>{
 for(const mode of ['scores','derived']){
  const worker=await loadWorker(null,false,false,mode);
  await worker.process({name:'PRODUCTS_UPDATE',data:{shop:'fixture.myshopify.com',payload:{id:1}}});
  assert.equal(worker.invalidations.length,mode==='scores'?1:0);
  if(mode==='scores')assert.equal(worker.invalidations[0].kind,'scores');
 }
});

test('a retry after successful indexing and failed invalidation still refreshes the affected ranking',async()=>{
  const worker=await loadWorker(undefined,false,true);
  const job={name:'PRODUCTS_UPDATE',data:{shop:'fixture.myshopify.com',payload:{id:123}}};
  await assert.rejects(worker.process(job),/Invalidation unavailable/);
  assert.ok(job.data.rankingBefore.fingerprint);
  await worker.process(job);
  assert.equal(worker.calls.filter(([type])=>type==='invalidate').length,2);
  assert.deepEqual(Array.from(worker.invalidations[1].externalProof.tags),['OldTag','NewTag']);
});

test('product deletion retries retain affected collections after DB memberships disappear',async()=>{
  const worker=await loadWorker(undefined,false,true);
  const job={name:'PRODUCTS_DELETE',data:{shop:'fixture.myshopify.com',payload:{id:123}}};
  await assert.rejects(worker.process(job),/Invalidation unavailable/);
  assert.deepEqual(Array.from(job.data.deletedCollectionIds),['gid://shopify/Collection/1']);
  await worker.process(job);
  assert.equal(worker.calls.filter(([type])=>type==='invalidate').length,2);
  assert.deepEqual(Array.from(job.data.deletedCollectionIds),['gid://shopify/Collection/1']);
  assert.deepEqual(Array.from(worker.invalidations[1].externalProof.tags),['OldTag']);
});

for(const topic of ['INVENTORY_LEVELS_UPDATE','INVENTORY_ITEMS_UPDATE'])test(`${topic} refreshes filter facts and invalidates only after successful sync`,async()=>{
 const worker=await loadWorker(undefined,false,false,'filterFacts');
 const payload={id:2,inventory_item_id:2};
 await worker.process({name:topic,data:{shop:'fixture.myshopify.com',payload}});
 assert.ok(worker.calls.some(call=>call[0]==='sync'&&call[2]==='gid://shopify/Product/1'));assert.equal(worker.invalidations[0].kind,'products');
 await assert.rejects((await loadWorker(Error('Sync failed'))).process({name:topic,data:{shop:'fixture.myshopify.com',payload}}),/Sync failed/);
});

test('app subscriptions use supported product and inventory topics, never metafield value topics',async()=>{
 const config=await fs.readFile('shopify.app.toml','utf8');
 assert.doesNotMatch(config,/"metafields\/(?:create|update|delete)"/);
 const subscription=config.match(/uri = "\/webhooks\/products"\s+topics = \[([^\]]+)\]/)?.[1];
 assert.ok(subscription);
 const topics=[...subscription.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(topics,['products/update','products/create','products/delete','inventory_levels/update','inventory_items/update']);
});
