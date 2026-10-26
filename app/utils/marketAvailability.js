import {createHash} from 'node:crypto';
export const stockEpochKey=shop=>`marketStockEpoch:${shop}`;
export const stockChangesKey=shop=>`marketStockChanges:${shop}`;
export const availabilityVersion=ids=>createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
const numeric=id=>String(id||'').replace(/^gid:\/\/shopify\/Product\//,'');
export const marketIdsFilter=ids=>`id IN ${JSON.stringify(ids.length?ids:['0'])}`;
export const marketRankingFingerprint=(fingerprint,version)=>version?`${fingerprint}:market:${version}`:fingerprint;
export function validateMarketContext(shop,country){
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||! /^[A-Z]{2}$/.test(country||''))throw Error('Invalid market context');
}
export async function storefrontQuery(shop,token,query,variables,fetchImpl=fetch){
  const response=await fetchImpl(`https://${shop}/api/2026-07/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Shopify country availability unavailable');
  const result=await response.json();
  if(result.errors?.length||!result.data)throw Error('Shopify country availability could not be verified');
  return result.data;
}
// Background-only full scan, or a bounded delta over changed products. Neither
// operation runs while serving a prepared collection page.
export async function readMarketAvailability({shop,country,token,previousIds,changedIds},query=storefrontQuery){
  validateMarketContext(shop,country);
  const deadline=Date.now()+600000;
  const ids=new Set(previousIds||[]),seen=new Set();
  const apply=product=>{
    const id=numeric(product?.id);
    if(!/^\d+$/.test(id)||typeof product.availableForSale!=='boolean'||seen.has(id))throw Error('Incomplete Shopify country availability');
    seen.add(id);product.availableForSale?ids.add(id):ids.delete(id);
  };
  if(previousIds&&Array.isArray(changedIds)){
    for(let offset=0;offset<changedIds.length;offset+=100){
      if(Date.now()>deadline)throw Error('Country stock preparation timed out');
      const batch=changedIds.slice(offset,offset+100);
      const data=await query(shop,token,'query CountryStockDelta($country:CountryCode!,$ids:[ID!]!) @inContext(country:$country){localization{country{isoCode}} nodes(ids:$ids){... on Product{id availableForSale}}}',{country,ids:batch.map(id=>'gid://shopify/Product/'+id)});
      if(data.localization?.country?.isoCode!==country||!Array.isArray(data.nodes)||data.nodes.length!==batch.length)throw Error('Shopify country context mismatch');
      for(let i=0;i<batch.length;i++){
        if(data.nodes[i]===null){ids.delete(batch[i]);continue;}
        if(numeric(data.nodes[i]?.id)!==batch[i])throw Error('Shopify country product mismatch');
        apply(data.nodes[i]);
      }
    }
  }else{
    ids.clear();let after=null;const cursors=new Set();
    for(;;){
      if(Date.now()>deadline)throw Error('Country stock preparation timed out');
      const data=await query(shop,token,'query CountryStock($country:CountryCode!,$after:String) @inContext(country:$country){localization{country{isoCode}} products(first:250,after:$after){nodes{id availableForSale}pageInfo{hasNextPage endCursor}}}',{country,after});
      const page=data.products;
      if(data.localization?.country?.isoCode!==country||!Array.isArray(page?.nodes)||typeof page.pageInfo?.hasNextPage!=='boolean')throw Error('Shopify country context mismatch');
      page.nodes.forEach(apply);
      if(seen.size>1000000)throw Error('Country catalog exceeds safety limit');
      if(!page.pageInfo.hasNextPage)break;
      after=page.pageInfo.endCursor;
      if(!page.nodes.length||typeof after!=='string'||!after||cursors.has(after))throw Error('Shopify country pagination stalled');
      cursors.add(after);
    }
  }
  return [...ids].sort();
}
