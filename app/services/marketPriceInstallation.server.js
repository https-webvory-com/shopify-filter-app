import prisma from '../db.server.js';
import {productSyncQueue} from './productSyncQueue.server.js';
import {createHash} from 'node:crypto';

const validShop=shop=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'');

export async function discoverPriceCountries(shop,fetcher=fetch){
 if(!validShop(shop))throw Error('Invalid shop');
 const response=await fetcher(`https://${shop}/api/2025-10/graphql.json`,{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({query:'query PriceSupportedCountries{localization{availableCountries{isoCode currency{isoCode}}}}'}),
  signal:AbortSignal.timeout(30000),
 });
 if(!response.ok)throw Error('Supported price countries unavailable');
 const body=await response.json(),rows=body.data?.localization?.availableCountries;
 if(body.errors?.length||!Array.isArray(rows)||!rows.length||rows.some(row=>!/^[A-Z]{2}$/.test(row.isoCode||'')||!/^[A-Z]{3}$/.test(row.currency?.isoCode||'')))throw Error('Invalid supported price countries');
 const currencies=Object.fromEntries(rows.map(row=>[row.isoCode,row.currency.isoCode]));
 return {countries:Object.keys(currencies).sort(),currencies};
}

export async function enqueuePriceInstallation(shop){
 if(!validShop(shop))throw Error('Invalid shop');
 const jobId='price-install-'+createHash('sha256').update(shop).digest('hex');
 const existing=await productSyncQueue.getJob(jobId);
 if(existing){
  if(await existing.getState()==='failed')await existing.retry('failed',{resetAttemptsMade:true,resetAttemptsStarted:true});
  return existing;
 }
 return productSyncQueue.add('INSTALL_MARKET_PRICES',{shop},{jobId});
}

// Authentication queues durable work; it never waits for a catalog import.
// Existing stores keep their saved products and are never automatically resynced.
export async function prepareInstallationPrices(shop,{discover=discoverPriceCountries,startInitial}={}){
 if(!validShop(shop))throw Error('Invalid shop');
 const supported=await discover(shop);
 await prisma.marketPriceConfiguration.upsert({where:{shop},create:{shop,...supported},update:supported});
 const existing=await prisma.product.findFirst({where:{shop},select:{id:true}});
 if(existing)return {countries:supported.countries.length,existingData:true};
 const previous=await prisma.syncJob.findFirst({where:{shop,kind:{in:['PRODUCTS','BULK_PRODUCTS']}},select:{id:true}});
 if(previous)return {countries:supported.countries.length,existingJob:true};
 const start=startInitial||(await import('./sync.server.js')).startBulkProductSync;
 return {...await start(shop),countries:supported.countries.length};
}
