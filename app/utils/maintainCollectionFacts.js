import {projectCollectionRuleFacts} from './collectionRuleFacts.js';
import {readRankedCollectionPage,hydrateCollectionSkus} from './rankedCollectionPage.js';

const clean=id=>String(id).split('/').pop();
// Run only in the background worker. Missing inputs are read once, in bounded
// batches, and become reusable by every overlapping collection and public market.
// The source selected by the compact scan must still identify the full document.
export async function maintainCollectionFacts({store,index,prisma,shop,profile,products,check,signal}){
 signal?.throwIfAborted();
 const missingProducts=await store.load(shop,profile,products,{signal,allowMissing:true});
 signal?.throwIfAborted();
 for(let start=0;start<missingProducts.length;start+=25){
  signal?.throwIfAborted();
  const missing=missingProducts.slice(start,start+25);
  const page=await readRankedCollectionPage(index,{ids:missing.map(p=>clean(p.id)),page:1,limit:25,shop,
   attributes:['id','shop','status','variantPrices','options','images','cfpCollectionInputSource'],requireDocuments:true});
  const full=page.hits.map((p,i)=>{
   if(p.shop!==shop||p.status!=='ACTIVE'||clean(p.id)!==clean(missing[i].id)||
      (p.cfpCollectionInputSource||'legacy')!==(missing[i].cfpCollectionInputSource||'legacy'))throw Error('Collection product changed while maintaining facts');
   return {...p,id:'gid://shopify/Product/'+clean(p.id),variants:p.variantPrices||[]};
  });
  if(profile.conditions.some(row=>row.condition.field==='SKU'))await hydrateCollectionSkus(full,prisma.variant,shop);
  const rows=full.map(product=>({product,facts:projectCollectionRuleFacts(product,profile,check,{backfill:true})}));
  signal?.throwIfAborted();
  // Retention exhaustion or a Redis outage must not alter the canonical result.
  // This build can use its verified facts even if optional retention rejects them.
  await store.putMany(shop,profile,rows).catch(()=>{});
  for(let i=0;i<rows.length;i++)Object.assign(missing[i],rows[i].facts);
 }
}
