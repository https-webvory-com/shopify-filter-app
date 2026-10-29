// Shopper-equivalent publication audit. It creates no catalog/stock jobs or
// shopper sessions. Run after a catalog sweep; exit 1 if a page is pending.
import 'dotenv/config';
import prisma from '../app/db.server.js';
import redis from '../app/services/redis.server.js';
import {getPreparedCollectionCards} from '../app/services/collectionCards.server.js';
import {getMarketAvailabilityState,marketAvailabilityQueue} from '../app/services/marketAvailability.server.js';
import {collectionRankingQueue} from '../app/services/queue.server.js';
import {warmupContextsKey} from '../app/utils/collectionPreparation.js';
import configuredWarmups from '../app/config/collection-prewarm.json' with {type:'json'};

const shopArg=process.argv.find(arg=>arg.startsWith('--shop='))?.slice(7);
const countryArg=process.argv.find(arg=>arg.startsWith('--country='))?.slice(10)?.toUpperCase();
if(shopArg&&!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopArg))throw Error('Invalid --shop');
if(countryArg&&!/^[A-Z]{2}$/.test(countryArg))throw Error('Invalid --country');
const installed=await prisma.session.findMany({where:{isOnline:false,...(shopArg?{shop:shopArg}:{})},select:{shop:true},distinct:['shop'],orderBy:{shop:'asc'}});
const report={at:new Date().toISOString(),definition:'Shopper-usable published first pages, including current settings and country stock proofs',shops:[],unresolved:0,unknownMarketShops:0};
try{
 for(const {shop} of installed){
  const markets=new Map();
  const add=(country,locale='en')=>{if(/^[A-Z]{2}$/.test(country||'')&&locale)markets.set(`${country}:${locale}`,{country,locale});};
  const connection=await prisma.marketStorefrontConnection.findUnique({where:{shop},select:{countries:true,locale:true}});
  for(const country of connection?.countries||[])add(country,connection.locale);
  for(const record of configuredWarmups)if(record.shop===shop&&(!connection||connection.countries.includes(record.country)))add(record.country,record.locale);
  try{for(const value of await redis.zrange(warmupContextsKey(shop),0,-1)){
   const url=new URL(JSON.parse(value).url);if(url.searchParams.get('shop')===shop&&(!connection||connection.countries.includes(url.searchParams.get('country'))))add(url.searchParams.get('country'),url.searchParams.get('locale')||'en');
  }}catch{}
  try{const primary=JSON.parse(await redis.get(`collectionPrimaryMarket:${shop}`)||'null');if(primary&&(!connection||connection.countries.includes(primary.country)))add(primary.country,primary.locale);}catch{}
  if(countryArg){const selected=[...markets.values()].filter(m=>m.country===countryArg);markets.clear();for(const market of selected)markets.set(`${market.country}:${market.locale}`,market);if(!selected.length)add(countryArg);}
  const collections=await prisma.collection.findMany({where:{shop},select:{id:true},orderBy:{id:'asc'}});
  const store={shop,collections:collections.length,marketScope:countryArg?'explicit-country':connection?'connected-countries':'observed-and-primary-only',markets:[]};report.shops.push(store);
  if(!connection&&!countryArg)report.unknownMarketShops++;
  if(!markets.size){store.marketDiscovery='missing';report.unresolved+=collections.length+1;continue;}
  for(const market of markets.values()){
   const row={...market,expected:collections.length+1,ready:0,missing:0,stockPending:0,sampleMissing:[]};store.markets.push(row);
   const stock=await getMarketAvailabilityState(shop,market.country,{probe:true});
   if(stock.status==='pending'){row.stockPending=row.expected;report.unresolved+=row.expected;continue;}
   const ids=['all',...collections.map(c=>c.id.split('/').pop())];
   // Bounded read concurrency protects Redis/PostgreSQL during a full audit.
   for(let start=0;start<ids.length;start+=4)await Promise.all(ids.slice(start,start+4).map(async id=>{
    const url=new URL('https://ranking.internal/api/filter');
    for(const [key,value]of Object.entries({shop,country:market.country,locale:market.locale,sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1'}))url.searchParams.set(key,value);
    if(id==='all')url.searchParams.set('collectionHandle','all');else url.searchParams.set('collectionId',id);
    try{
     const response=await getPreparedCollectionCards(new Request(url),{probe:true,publishedOnly:true,marketAvailabilityVersion:stock.version});
     if(response?.status===200&&response.headers.get('X-CFP-Collection-Cards')==='published'){row.ready++;return;}
    }catch{}
    row.missing++;if(row.sampleMissing.length<10)row.sampleMissing.push(id);
   }));
   report.unresolved+=row.missing;
  }
 }
 console.log(JSON.stringify(report));
 if(report.unresolved||report.unknownMarketShops)process.exitCode=1;
}finally{await Promise.allSettled([prisma.$disconnect(),redis.quit(),marketAvailabilityQueue.close(),collectionRankingQueue.close()]);}
