// Read-only: no workers, queue imports, sessions, preparations or repairs.
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import Redis from 'ioredis';
import {REDIS_URL} from '../app/services/redisConnection.server.js';
import meili from '../app/services/meiliClient.server.js';
import {createCollectionLoadingSnapshots} from '../app/utils/collectionLoadingSnapshots.js';
import {createCollectionCardStore} from '../app/utils/collectionCardStore.js';
import {createCardStateReader} from '../app/utils/collectionCardState.js';
import {readRankedCollectionPage} from '../app/utils/rankedCollectionPage.js';
import {collectionPageFingerprint} from '../app/utils/collectionResponse.js';
import {normalizeCollectionWarmup,warmupContextsKey} from '../app/utils/collectionPreparation.js';
import {readFile} from 'node:fs/promises';

const argument=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const shop=argument('--shop');
if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||''))throw Error('Pass --shop your-store.myshopify.com');
const requestedLimit=argument('--limit'),limit=requestedLimit==null?Infinity:Number(requestedLimit);
if(limit!==Infinity&&(!Number.isInteger(limit)||limit<1))throw Error('Invalid --limit');
const database=new PrismaClient(),client=new Redis(REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:5000,retryStrategy:()=>null});client.on('error',()=>{});
try{
 await client.connect();
 const redis={get:key=>client.get(key),mget:(...keys)=>client.mget(...keys),set:()=>{throw Error('Read-only audit cannot create a cache generation');}};
 const durable=createCollectionLoadingSnapshots({database,redis});
 const store=createCollectionCardStore({redis,readBudgetMs:10000,loadDurable:durable.load,readState:createCardStateReader(redis,database,Date.now,durable.load),
  validateCards:async(entry,prepared)=>{
   const page=await readRankedCollectionPage(meili.index('products'),{ids:prepared.ids,page:1,limit:25,shop,batchOwner:meili,attributes:entry.attributes});
   return collectionPageFingerprint(page.hits)===entry.validationFingerprint;
  },createSession:()=>{throw Error('Read-only audit must never create sessions');}});
 const seeds=JSON.parse(await readFile(new URL('../app/config/collection-prewarm.json',import.meta.url),'utf8'));
 const records=[...seeds.filter(s=>s.shop===shop).map(s=>({url:'https://ranking.internal/api/filter?'+new URLSearchParams({...s,page:'1',limit:'25'})})),
  ...(await client.zrange(warmupContextsKey(shop),-40,-1)).flatMap(raw=>{try{return [JSON.parse(raw)];}catch{return [];}})];
 const markets=new Map();
 for(const record of records){
  const normalized=normalizeCollectionWarmup(shop,record.url,record.collectionId);if(!normalized)continue;
  const p=new URL(normalized.url).searchParams,country=p.get('country'),locale=p.get('locale')||p.get('language');
  if(country&&locale&&!markets.has(country+':'+locale))markets.set(country+':'+locale,{country,locale});if(markets.size===4)break;
 }
 const collections=await database.collection.findMany({where:{shop},select:{id:true,handle:true},orderBy:{id:'asc'}});
 const result={shop,readOnly:true,knownLocalCollections:collections.length,markets:[...markets.values()],checked:0,verifiedReadyCardContexts:0,missingOrInvalidCardContexts:0,missing:[],allPublishedCoverageVerified:false};
 outer:for(const collection of collections)for(const market of markets.values()){
  if(result.checked===limit)break outer;
  const params=new URLSearchParams({shop,...market,collectionId:String(collection.id).split('/').pop(),sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-cards-v1'});
  const ready=await store.get(new Request('https://ranking.internal/api/filter?'+params),{probe:true});result.checked++;
  if(ready?.status===200)result.verifiedReadyCardContexts++;
  else {result.missingOrInvalidCardContexts++;result.missing.push({collectionId:collection.id,handle:collection.handle,...market});}
 }
 console.log(JSON.stringify(result,null,2));
}finally{await client.quit().catch(()=>client.disconnect());await database.$disconnect();}
