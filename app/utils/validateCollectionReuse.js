const clean=id=>String(id).split('/').pop();

// Shopify owns native best-selling ties. Outside Include products retain the
// engine's base order, which sales-score writes can change independently of
// product webhooks. Validate that small order before reusing a saved sequence.
export async function validateCollectionReuse(index,spec,value){
 if(spec.needsShopifyOrder!==true||!Array.isArray(spec.orderedIds)||!['best-selling','bestselling'].includes(spec.sortBy))return false;
 const native=new Set(spec.orderedIds.map(clean));
 if(value.ids.every(id=>native.has(clean(id))))return true;
 const expected=value.sourceOutsideIds;
 if(Array.isArray(expected)&&expected.length===0){
  const pins=new Set((spec.pinnedIds||[]).map(clean));
  return value.ids.every(id=>native.has(clean(id))||pins.has(clean(id)));
 }
 if(!Array.isArray(expected)||!expected.length||expected.length>1000||expected.some(id=>typeof id!=='string')||new Set(expected).size!==expected.length)return false;
 const {indexUid,q,limit,offset,attributesToRetrieve,attributesToHighlight,facets,page,hitsPerPage,...options}=spec.query;
 const filter=[...(Array.isArray(options.filter)?options.filter:options.filter?[options.filter]:[]),`id IN ${JSON.stringify(expected)}`];
 const result=await index.search(q||'',{...options,filter,limit:expected.length+1,offset:0,attributesToRetrieve:['id']},{signal:AbortSignal.timeout(2000)});
 return Array.isArray(result.hits)&&result.hits.length===expected.length&&result.hits.every((p,i)=>clean(p.id)===expected[i]);
}
