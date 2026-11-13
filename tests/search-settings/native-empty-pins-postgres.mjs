import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadModule} from '../search/helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';

const config=JSON.parse(await fs.readFile('scratch/redirect-db.json','utf8'));
const url=new URL(config.url);
assert.equal(url.hostname,'127.0.0.1');
assert.equal(Number(url.port),config.port);
assert.ok(path.resolve(config.directory).startsWith(path.resolve('scratch')+path.sep));
const require=createRequire(import.meta.url),{PrismaClient}=require('../../scratch/banner-prisma/index.js');
const db=new PrismaClient({datasources:{db:{url:config.url}}});
const shop='empty-fixture.myshopify.com',other='other-fixture.myshopify.com';
const product={id:'gid://shopify/Product/1',title:'Fixture dress',image:''};
const hooks={resetSearchIndexContext:async()=>{},scheduleSearchIndex:async()=>{},retireSearchIndexes:async()=>{}};
try{
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "SearchSetting" (shop TEXT PRIMARY KEY,config JSONB NOT NULL,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())');
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "PinnedProductRule" (id TEXT PRIMARY KEY,shop TEXT NOT NULL,products JSONB NOT NULL,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),status BOOLEAN NOT NULL DEFAULT true,"applyToAll" BOOLEAN NOT NULL DEFAULT false,collections TEXT[] DEFAULT ARRAY[]::TEXT[],name TEXT NOT NULL,"applyToSearchType" TEXT NOT NULL,"ruleType" TEXT NOT NULL,"searchQueries" TEXT[],"importOrder" TEXT,"collectionSortKey" TEXT,"collectionSortPosition" INTEGER,UNIQUE(shop,name,"ruleType"))');
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "Synonym" (id TEXT PRIMARY KEY,shop TEXT NOT NULL,word TEXT NOT NULL,synonyms TEXT NOT NULL,"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW())');
  const original={...structuredClone(schema.DEFAULT_SEARCH_SETTINGS),emptySearchProducts:[product],_index:{active:{uid:'unchanged'}}};
  for(const tenant of [shop,other])await db.searchSetting.upsert({where:{shop:tenant},create:{shop:tenant,config:original},update:{config:original}});
  const service=await loadModule('app/services/emptySearchPins.server.js',{'../db.server.js':{default:db},'../utils/searchSettings.js':schema,'./searchCollectionPicker.server.js':{validateSelectedSearchProducts:async(tenant,products)=>{assert.equal(tenant,shop);return products;}},'./searchIndex.server.js':hooks});
  const pin=await service.saveEmptySearchPin(shop,{id:'new',products:[product]});
  assert.equal(pin.name,'Empty search pin');assert.deepEqual(Array.from(pin.searchQueries),['']);
  assert.equal(pin.applyToSearchType,'instant');
  const settings=await db.searchSetting.findUnique({where:{shop}});
  assert.deepEqual(settings.config.emptySearchProducts,[]);assert.deepEqual(settings.config._index,original._index);
  assert.deepEqual((await db.searchSetting.findUnique({where:{shop:other}})).config,original);
  await assert.rejects(service.saveEmptySearchPin(shop,{id:'nonexistent',products:[product]}),/already exists/);
  await db.pinnedProductRule.update({where:{id:pin.id},data:{status:false}});
  assert.equal((await service.saveEmptySearchPin(shop,{id:'new',products:[product]})).status,false);
  const settingsService=await loadModule('app/services/searchSettings.server.js',{'../db.server':{default:db},'../utils/searchSettings.js':schema,'../utils/searchConfiguration.js':{requiresCustomSearchIndex:()=>false},'./searchIndex.server.js':hooks});
  // An older Settings form must not resurrect pins or overwrite index metadata.
  await settingsService.saveSearchSettings(shop,{...original,productLimit:9},{preserveEmptyPins:true});
  const saved=await db.searchSetting.findUnique({where:{shop}});
  assert.deepEqual(saved.config.emptySearchProducts,[]);assert.equal(saved.config.productLimit,9);assert.deepEqual(saved.config._index,original._index);
  const menu=[{id:'gid://shopify/Collection/10',title:'Evening',handle:'evening',image:'',groups:[{title:'Occasion',collections:[{id:'gid://shopify/Collection/11',title:'Prom',handle:'prom',image:''}]}]}];
  await db.searchSetting.update({where:{shop},data:{config:{...saved.config,compactCollections:menu}}});
  for(const enabled of [false,true]){
    const result=await settingsService.saveSearchSettings(shop,{...original,instantSearchEnabled:enabled},{preserveEmptyPins:true,preserveCompactCollections:true});
    assert.equal(result.instantSearchEnabled,enabled);assert.deepEqual(JSON.parse(JSON.stringify(result.compactCollections)),menu);
    assert.deepEqual((await db.searchSetting.findUnique({where:{shop}})).config._compactCollectionsBackup.collections,menu);
  }
  await assert.rejects(settingsService.saveSearchSettings(shop,{...original,compactCollections:[]},{preserveEmptyPins:true,compactCollectionsBase:[]}),/changed in another tab/);
  assert.deepEqual((await db.searchSetting.findUnique({where:{shop}})).config.compactCollections,menu);
  await settingsService.saveSearchSettings(shop,{...original,compactCollections:[]},{preserveEmptyPins:true,compactCollectionsBase:menu});
  const cleared=await db.searchSetting.findUnique({where:{shop}});assert.deepEqual(cleared.config.compactCollections,[]);assert.deepEqual(cleared.config._compactCollectionsBackup.collections,menu);assert.deepEqual(cleared.config._index,original._index);
  assert.deepEqual((await db.searchSetting.findUnique({where:{shop:other}})).config,original);
  await db.searchSetting.update({where:{shop},data:{config:original}});
  await settingsService.resetSearchSettings(shop);
  assert.deepEqual((await db.searchSetting.findUnique({where:{shop}})).config.emptySearchProducts,[product]);
  await service.saveEmptySearchPin(shop,{id:pin.id,products:[]});assert.equal(await db.pinnedProductRule.count({where:{shop}}),0);
  console.log('PASS isolated PostgreSQL: canonical pin, repeat save/status, tenant isolation, atomic legacy removal, settings stale-form protection/index metadata, reset preservation, delete fallback');
}finally{
  await db.pinnedProductRule.deleteMany({where:{shop:{in:[shop,other]}}});
  await db.searchSetting.deleteMany({where:{shop:{in:[shop,other]}}});
  await db.$disconnect();
}
