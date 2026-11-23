import {readProductMarketPrices} from './readProductMarketPrices.js';
import {variantMarketPrices,productMarketPriceIndexFields} from './marketPricingIndex.js';
const samePrice=(a,b)=>!!a&&!!b&&a.price!=null&&b.price!=null&&Number(a.price)===Number(b.price)&&a.currency===b.currency&&(a.compareAtPrice==null?null:Number(a.compareAtPrice))===(b.compareAtPrice==null?null:Number(b.compareAtPrice));

// A durable, product-scoped refresh. No browser-supplied amounts are accepted.
// The checkpoint survives failures after the database commit, so a retry still
// repairs indexes/caches and publishes the event even if prices now compare equal.
export async function refreshProductMarketPrices(job,{read,admin,save,index,search,invalidate,publish,assertOwned=async()=>{}}){
 const {shop,productId,country,currency}=job.data;
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'')||!/^gid:\/\/shopify\/Product\/\d+$/.test(productId||'')||!/^[A-Z]{2}$/.test(country||'')||!/^[A-Z]{3}$/.test(currency||''))throw Error('Invalid country price refresh');
 const before=await read(shop,productId);
 if(!before||!before.variants.length)return {skipped:true};
 const product={id:productId,variants:{nodes:before.variants.map(v=>({id:v.id}))}};
 await readProductMarketPrices(product,admin,[country]);
 const prices=product.variants.nodes.map(v=>({id:v.id,price:variantMarketPrices(v,[country])[country]}));
 if(prices.some(v=>!v.price||v.price.currency!==currency))throw Error('Incomplete or mismatched Shopify country prices');
 const old=new Map(before.variants.map(v=>[v.id,v.marketPrices?.[country]]));
 const changed=prices.some(v=>!samePrice(old.get(v.id),v.price));
 if(changed&&!job.data.priceRefreshChanged)await job.updateData({...job.data,priceRefreshChanged:true});
 await assertOwned();
 if(changed)await save(before,prices,country);
 if(!changed&&!job.data.priceRefreshChanged)return {changed:false};
 const after=await read(shop,productId);
 const verified=new Map(prices.map(p=>[p.id,p.price]));
 if(!after||after.variants.length!==prices.length||after.variants.some(v=>!samePrice(verified.get(v.id),v.marketPrices?.[country])))throw Error('Product changed during country price refresh');
 const fields=Object.fromEntries(Object.entries(productMarketPriceIndexFields(after.variants)).filter(([key])=>key.endsWith('_'+country)));
 if(fields['marketPriceCurrency_'+country]!==currency)throw Error('Incomplete country sort prices');
 for(const bound of ['Min','Max'])fields['marketAvailablePrice'+bound+'_'+country]??=null;
 await assertOwned();
 const task=await index(shop,productId,after.variants,fields);
 await search(shop,[productId.split('/').pop()],task);
 await assertOwned();
 await invalidate(shop,{kind:'products',collectionIds:after.collections.map(c=>c.collectionId),externalProof:{ids:[productId.split('/').pop()],tags:after.tags}});
 await publish(shop,productId);
 return {changed:true,country,variants:prices.length};
}
