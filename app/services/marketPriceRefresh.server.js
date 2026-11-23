import {createHash} from 'node:crypto';
import prisma from '../db.server.js';
import meili from './meiliClient.server.js';
import {productSyncQueue} from './productSyncQueue.server.js';
import {discoverPriceCountries} from './marketPriceInstallation.server.js';
import {getCached,invalidateShop} from './shopCache.server.js';
import {withProductPriceLock} from './productPriceLock.server.js';
import {refreshProductMarketPrices} from '../utils/refreshProductMarketPrices.js';
import {saveProductMarketPrices} from '../utils/saveProductMarketPrices.js';
import {publishProductPriceChange} from './priceEvents.server.js';
import {refreshSearchIndexProductPrices} from './searchIndex.server.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const read=(shop,id)=>prisma.product.findFirst({where:{id,shop,status:{equals:'active',mode:'insensitive'}},select:{id:true,shop:true,updatedAt:true,tags:true,collections:{select:{collectionId:true}},variants:true}});
export async function requestMarketPriceRefresh({shop,country,currency,ids}){
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'')||!/^[A-Z]{2}$/.test(country||'')||!/^[A-Z]{3}$/.test(currency||'')||!Array.isArray(ids)||!ids.length||ids.length>40||ids.some(id=>!/^\d{1,20}$/.test(id)))throw Error('Invalid price refresh scope');
 const supported=await getCached('marketPriceSupported:'+shop,()=>discoverPriceCountries(shop),900);
 if(supported.currencies[country]!==currency)return {accepted:0,unsupported:true};
 const rows=await prisma.product.findMany({where:{shop,status:{equals:'active',mode:'insensitive'},id:{in:ids.map(id=>'gid://shopify/Product/'+id)}},select:{id:true}});
 let accepted=0;
 for(const {id:productId}of rows){
  const identity=hash(shop+':'+productId+':'+country),jobId='market-price-'+identity;
  let priceRefreshChanged=false;
  const existing=await productSyncQueue.getJob(jobId);
  if(existing){
   const state=await existing.getState();
   if(!['completed','failed'].includes(state)){accepted++;continue;}
   if(state==='failed'&&Date.now()-(existing.finishedOn||0)<60000)continue;
   priceRefreshChanged=state==='failed'&&existing.data?.priceRefreshChanged===true;
   await existing.remove();
  }
  // BullMQ's stable ID makes simultaneous shoppers share the same durable job.
  await productSyncQueue.add('REFRESH_MARKET_PRICES',{shop,productId,country,currency,priceRefreshChanged},{jobId,priority:20});accepted++;
 }
 return {accepted};
}

async function updateIndex(shop,productId,variants,fields){
 const id=productId.split('/').pop(),index=meili.index('products'),existing=await index.getDocument(id);
 if(existing.shop!==shop||existing.status!=='ACTIVE')throw Error('Product index scope changed; retry');
 const previous=new Map((existing.variantPrices||[]).map(v=>[String(v.id).split('/').pop(),v]));
 const variantPrices=variants.map(v=>({...previous.get(v.id.split('/').pop()),id:v.id.split('/').pop(),price:Number(v.price),compareAtPrice:v.compareAtPrice==null?null:Number(v.compareAtPrice),available:v.available,option1:v.option1,option2:v.option2,option3:v.option3,sku:v.sku,imageUrl:v.imageUrl,marketPrices:v.marketPrices||{}}));
 const task=await index.updateDocuments([{id,variantPrices,...fields}]);
 const completed=await meili.tasks.waitForTask(task.taskUid,{timeout:120000});
 if(completed.status!=='succeeded')throw Error('Country price indexing failed');
 return task.taskUid;
}

export async function processMarketPriceRefresh(job){
 return withProductPriceLock(job.data.shop,job.data.productId,async assertOwned=>{
  const {unauthenticated}=await import('../shopify.server.js');
  const {admin}=await unauthenticated.admin(job.data.shop);
  return refreshProductMarketPrices(job,{read,admin,save:(...args)=>saveProductMarketPrices(prisma,...args),index:updateIndex,search:refreshSearchIndexProductPrices,invalidate:invalidateShop,publish:publishProductPriceChange,assertOwned});
 });
}
