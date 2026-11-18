import prisma from '../db.server.js';
import redis from './redis.server.js';
import meiliClient from './meiliClient.server.js';
import {getCached} from './shopCache.server.js';

const validShop=shop=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'');
const validCountry=country=>/^[A-Z]{2}$/.test(country||'');

export async function marketPriceCountriesForShop(shop){
 if(!validShop(shop))return [];
 const [configuration,observed,connection]=await Promise.all([
  prisma.marketPriceConfiguration?.findUnique?.({where:{shop},select:{countries:true}})||null,
  redis.smembers?.(`marketPriceObservedCountries:${shop}`)||[],
  prisma.marketStorefrontConnection?.findUnique?.({where:{shop},select:{countries:true}})||null,
 ]);
 // Installation's supported list takes precedence over old shopper observations.
 return [...new Set(configuration?.countries||[...(observed||[]),...(connection?.countries||[])])].filter(validCountry).sort();
}

export async function allMarketPriceCountries(){
 const [configurations,observed,connections]=await Promise.all([
  prisma.marketPriceConfiguration?.findMany?.({select:{countries:true}})||[],
  redis.smembers?.('marketPriceObservedAllCountries')||[],
  prisma.marketStorefrontConnection?.findMany?.({select:{countries:true}})||[],
 ]);
 return [...new Set([...configurations.flatMap(row=>row.countries),...observed,...connections.flatMap(row=>row.countries)])].filter(validCountry).sort();
}

async function supportsPriceField(country,{stockOnly=true,indexUid='products'}={}){
 if(!validCountry(country))return false;
 try{
  const settings=await getCached(`marketPriceCapabilities:${indexUid}`,()=>meiliClient.index(indexUid).getSettings(),30);
  const field=`market${stockOnly?'Available':''}PriceMin_${country}`;
  return settings.filterableAttributes?.includes(field)===true&&settings.sortableAttributes?.includes(field)===true;
 }catch{return false;}
}

// Saved values are authoritative. This reads capabilities, never a whole-store
// coverage count, catalog revision, expiring proof, or sync status.
export async function marketPriceIntentReady(shop,country,options={}){
 return validShop(shop)&&await supportsPriceField(country,options);
}

export async function marketPriceScopeReady(country,{filter,stockOnly=false,indexUid='products'}={}){
 if(!Array.isArray(filter)||!filter.some(clause=>/^shop\s*=/.test(clause)))return false;
 return supportsPriceField(country,{stockOnly,indexUid});
}
