import {contextualPricingFields,marketCountries} from './marketPricingIndex.js';

// Background product jobs only. Country batches bound Shopify query cost even
// when a store supports hundreds of countries; every query names one product.
export async function readProductMarketPrices(product,admin,countries){
 if(!/^gid:\/\/shopify\/Product\/\d+$/.test(product?.id||''))throw Error('Invalid price product');
 const variants=product.variants?.nodes||[];
 if(!variants.length)return;
 const missing=marketCountries(countries).filter(country=>variants.some(variant=>!Object.hasOwn(variant,`cfpMarket_${country}`)));
 const byId=new Map(variants.map(variant=>[variant.id,variant]));
 const updates=[];
 for(let offset=0;offset<missing.length;offset+=4){
  const batch=missing.slice(offset,offset+4);let cursor=null;
  const seen=new Set();
  do{
   const response=await admin.graphql(`query ChangedProductCountryPrices($id:ID!,$cursor:String){product(id:$id){id variants(first:50,after:$cursor){nodes{id ${contextualPricingFields(batch)}} pageInfo{hasNextPage endCursor}}}}`,{variables:{id:product.id,cursor}});
   const body=await response.json(),record=body.data?.product,connection=record?.variants;
   if(body.errors?.length||record?.id!==product.id||!Array.isArray(connection?.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw Error('Changed product country prices unavailable');
   for(const row of connection.nodes){
    if(!byId.has(row.id)||seen.has(row.id))throw Error('Product variants changed during price preparation');
    seen.add(row.id);
    const values={};
    for(const country of batch){
     const key=`cfpMarket_${country}`;
     if(!Object.hasOwn(row,key))throw Error('Incomplete country price response');
     values[key]=row[key];
    }
    updates.push([row.id,values]);
   }
   const next=connection.pageInfo.endCursor;
   if(connection.pageInfo.hasNextPage&&(!next||next===cursor))throw Error('Country price pagination stalled');
   cursor=connection.pageInfo.hasNextPage?next:null;
  }while(cursor);
  if(seen.size!==variants.length)throw Error('Product variants changed during price preparation');
 }
 // Never persist a partly refreshed product if a country/page read failed.
 for(const [id,values]of updates)Object.assign(byId.get(id),values);
}
