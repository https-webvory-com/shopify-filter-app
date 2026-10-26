import {createHash,randomUUID} from 'node:crypto';
import {Queue} from 'bullmq';
import prisma from '../db.server.js';
import redis from './redis.server.js';
import {redisOptions} from './queue.server.js';
import {getCached} from './shopCache.server.js';
import {readMarketAvailability,storefrontQuery,stockEpochKey,stockChangesKey,availabilityVersion,validateMarketContext} from '../utils/marketAvailability.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
if(!global.__marketAvailabilityQueue){
  global.__marketAvailabilityQueue=new Queue('marketAvailabilityQueueV1',{connection:redisOptions,defaultJobOptions:{attempts:10,backoff:{type:'exponential',delay:2000},removeOnComplete:{count:500},removeOnFail:{count:1000}}});
  global.__marketAvailabilityQueue.on('error',()=>console.error('CFP: Market availability queue unavailable'));
}
export const marketAvailabilityQueue=global.__marketAvailabilityQueue;
const connection=async shop=>{
  const revision=await redis.get(`marketConnectionRevision:${shop}`)||'0';
  return getCached(`marketConnection:${shop}:${revision}`,async()=>await prisma.marketStorefrontConnection.findUnique({where:{shop}})||{disabled:true},60);
};
async function context(shop){
  const record=await connection(shop);if(!record||record.disabled)return null;
  const generationKey=`marketStockGeneration:${shop}`;
  let generation=await redis.get(generationKey);
  if(!generation){await redis.set(generationKey,randomUUID(),'NX');generation=await redis.get(generationKey);}
  const epoch=Number(await redis.get(stockEpochKey(shop))||0);
  return {record,epoch,identity:hash(record.accessToken+':'+generation)};
}
const stateKey=(shop,country,identity,epoch)=>`marketStockState:${shop}:${country}:${identity}:${epoch}`;
export async function scheduleMarketAvailability(shop,country){
  validateMarketContext(shop,country);
  const epoch=await redis.get(stockEpochKey(shop))||'0';
  const jobId='country-stock-'+hash(shop+':'+country+':'+epoch),previous=await marketAvailabilityQueue.getJob(jobId);
  if(previous){
    const state=await previous.getState();
    if(['waiting','active','delayed','prioritized'].includes(state))return;
    if(state==='failed'&&Date.now()-(previous.finishedOn||0)<60000)return;
    await previous.remove();
  }
  await marketAvailabilityQueue.add('COUNTRY_STOCK',{shop,country},{jobId});
}
// Small metadata only. A published-page hit never downloads country ID lists.
export async function getMarketAvailabilityState(shop,country){
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))throw Error('Invalid shop');
  const current=await context(shop);if(!current)return {status:'disabled',version:null};
  validateMarketContext(shop,country);
  if(!current.record.countries.includes(country))throw Error('Country is not enabled in Shopify Markets');
  const key=stateKey(shop,country,current.identity,current.epoch);
  let state;try{state=JSON.parse(await redis.get(key));}catch{}
  if(state?.status!=='ready'||!/^[a-f0-9]{64}$/.test(state.version||'')||!Number.isFinite(state.at)||state.at>Date.now())state=null;
  if(!state){
    const saved=await prisma.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country}},select:{connection:true,epoch:true,version:true,updatedAt:true}});
    if(saved?.connection===current.identity&&saved.epoch===current.epoch&&/^[a-f0-9]{64}$/.test(saved.version)){state={status:'ready',version:saved.version,at:new Date(saved.updatedAt).getTime()};await redis.setex(key,900,JSON.stringify(state));}
  }
  if(!state||Date.now()-state.at>=900000){await scheduleMarketAvailability(shop,country);return {status:'pending',version:null};}
  return state||{status:'pending',version:null};
}
export async function getMarketAvailableProductIds(shop,country,version){
  const saved=await prisma.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country}}});
  const state=await getMarketAvailabilityState(shop,country);
  if(state.status!=='ready'||state.version!==version||saved?.version!==version)return null;
  return saved.ids;
}
export async function processMarketAvailability(input){
  validateMarketContext(input.shop,input.country);
  const key=`marketStockLock:${input.shop}:${input.country}`,owner=randomUUID();
  if(!await redis.set(key,owner,'NX','EX',1800))throw Error('Country availability is already preparing');
  try{return await prepareMarketAvailability(input);}
  finally{await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,key,owner);}
}
async function prepareMarketAvailability({shop,country,fullRefresh=false}){
  validateMarketContext(shop,country);
  const current=await context(shop);if(!current)return {disabled:true};
  if(!current.record.countries.includes(country))return {disabled:true};
  const previous=await prisma.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country}}});
  if(!fullRefresh&&previous?.connection===current.identity&&previous.epoch===current.epoch&&Date.now()-new Date(previous.updatedAt).getTime()<600000){
    await warmCountryCollections(shop,country,previous.version,current.record.locale);
    return {alreadyReady:true};
  }
  let changedIds;
  if(!fullRefresh&&previous?.connection===current.identity&&previous.epoch<current.epoch){
    changedIds=await redis.zrangebyscore(stockChangesKey(shop),previous.epoch+1,current.epoch);
    // A reset, missing history or large batch requires one complete scan.
    if(!changedIds.length||changedIds.includes('reset')||changedIds.length>1000)changedIds=undefined;
  }
  const ids=await readMarketAvailability({shop,country,token:current.record.accessToken,...(changedIds?{previousIds:previous.ids,changedIds}:{})});
  const latest=await context(shop);
  if(!latest||latest.identity!==current.identity)throw Error('Country connection changed during preparation; retry');
  const version=availabilityVersion([current.identity,country,...ids]);
  await prisma.marketAvailabilitySnapshot.upsert({where:{shop_country:{shop,country}},create:{shop,country,connection:current.identity,epoch:current.epoch,version,ids},update:{connection:current.identity,epoch:current.epoch,version,ids}});
  if(latest.epoch!==current.epoch)throw Error('Country stock changed during preparation; retry');
  await redis.setex(stateKey(shop,country,current.identity,current.epoch),900,JSON.stringify({status:'ready',version,at:Date.now()}));
  await warmCountryCollections(shop,country,version,current.record.locale);
  return {country,available:ids.length,incremental:Boolean(changedIds)};
}
async function warmCountryCollections(shop,country,version,locale){
  const key=`marketStockWarmVersion:${shop}:${country}`;
  if(await redis.get(key)===version)return;
  const {scheduleCatalogCollectionWarmups}=await import('./collectionPreparation.server.js');
  await scheduleCatalogCollectionWarmups(shop,null,10,{countries:[country],locale});
  await redis.set(key,version);
}
// Called after a verified stock/product webhook, including inventory moves
// which leave the shop-wide quantity unchanged. No storefront API work here.
export async function invalidateMarketAvailability(shop,productId){
  const record=await connection(shop);if(!record||record.disabled)return;
  const id=String(productId||'').split('/').pop();
  await redis.eval("local e=redis.call('INCR',KEYS[1]);redis.call('ZADD',KEYS[2],e,ARGV[1]);return e",2,stockEpochKey(shop),stockChangesKey(shop),/^\d+$/.test(id)?id:'reset');
  for(const country of record.countries)await scheduleMarketAvailability(shop,country);
}
export async function connectMarketAvailability(shop,admin){
  const read=await(await admin.graphql('query CountryStockPermission{currentAppInstallation{accessScopes{handle}} shop{storefrontAccessTokens(first:100){nodes{title accessToken}}}}')).json();
  if(read.errors?.length||!read.data?.currentAppInstallation?.accessScopes?.some(scope=>scope.handle==='unauthenticated_read_product_listings'))throw Error('Approve the Storefront product listings permission, then retry.');
  const title='Collection Filter Pro country availability';
  let token=read.data.shop?.storefrontAccessTokens?.nodes?.find(value=>value.title===title)?.accessToken;
  if(!token){
    const created=await(await admin.graphql('mutation CountryStockToken($input:StorefrontAccessTokenInput!){storefrontAccessTokenCreate(input:$input){storefrontAccessToken{accessToken}userErrors{message}}}',{variables:{input:{title}}})).json();
    token=created.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
    if(created.errors?.length||created.data?.storefrontAccessTokenCreate?.userErrors?.length||!token)throw Error('Unable to create the Storefront connection. Check Shopify permissions and retry.');
  }
  const data=await storefrontQuery(shop,token,'query CountryStockSetup{localization{language{isoCode} availableCountries{isoCode}} products(first:1){nodes{id}}}',{});
  const countries=data.localization?.availableCountries?.map(value=>value.isoCode);
  if(!countries?.length||countries.some(country=>!/^[A-Z]{2}$/.test(country)))throw Error('Unable to verify enabled Shopify countries.');
  if(!data.products?.nodes?.length&&await prisma.product.count({where:{shop,status:{equals:'active',mode:'insensitive'}}}))throw Error('The Storefront connection cannot see your products. Check their sales channel publication before enabling country stock.');
  await prisma.marketStorefrontConnection.upsert({where:{shop},create:{shop,accessToken:token,countries,locale:data.localization.language.isoCode.toLowerCase()},update:{accessToken:token,countries,locale:data.localization.language.isoCode.toLowerCase()}});
  await redis.incr(`marketConnectionRevision:${shop}`);
  await invalidateMarketAvailability(shop);
  for(const country of countries)await marketAvailabilityQueue.upsertJobScheduler('country-refresh-'+hash(shop+':'+country),{every:720000},{name:'COUNTRY_STOCK',data:{shop,country,fullRefresh:true}});
  await marketAvailabilityQueue.upsertJobScheduler('country-discovery-'+hash(shop),{every:720000},{name:'COUNTRY_DISCOVERY',data:{shop}});
  return {countries:countries.length};
}
export async function discoverMarketCountries({shop}){
  const record=await connection(shop);if(!record||record.disabled)return {disabled:true};
  const data=await storefrontQuery(shop,record.accessToken,'query CountryStockCountries{localization{availableCountries{isoCode}}}',{});
  const countries=data.localization?.availableCountries?.map(value=>value.isoCode);
  if(!countries?.length||countries.some(country=>!/^[A-Z]{2}$/.test(country)))throw Error('Unable to verify enabled Shopify countries');
  if(JSON.stringify([...countries].sort())===JSON.stringify([...record.countries].sort()))return {unchanged:true};
  await prisma.marketStorefrontConnection.updateMany({where:{shop,accessToken:record.accessToken},data:{countries}});
  await redis.incr(`marketConnectionRevision:${shop}`);
  for(const country of countries)if(!record.countries.includes(country)){
    await scheduleMarketAvailability(shop,country);
    await marketAvailabilityQueue.upsertJobScheduler('country-refresh-'+hash(shop+':'+country),{every:720000},{name:'COUNTRY_STOCK',data:{shop,country,fullRefresh:true}});
  }
  for(const country of record.countries)if(!countries.includes(country))await marketAvailabilityQueue.removeJobScheduler('country-refresh-'+hash(shop+':'+country));
  return {countries:countries.length};
}
