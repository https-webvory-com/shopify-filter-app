const clean=id=>String(id).split('/').pop();
const allowed=new Set(['q','filter','sort','indexUid','limit','offset','attributesToRetrieve','attributesToHighlight','facets']);
// Shopify already supplies the native best-selling order. Browse filtered,
// compact inputs without asking search to sort the entire native collection.
// Only outside Include candidates need the original engine tie order.
export function createCollectionCandidateIndex(index,spec,{signal,maxBytes=16*1024*1024,maxDocuments=50000}={}){
 if(spec.retainForIdle!==true||spec.needsShopifyOrder!==true||!Array.isArray(spec.orderedIds)||
    !['best-selling','bestselling'].includes(spec.sortBy)||spec.query.q||
    Object.keys(spec.query).some(key=>!allowed.has(key))||typeof index.getDocuments!=='function'||typeof index.getSettings!=='function')return index;
 let snapshot,disabled=false;
 async function browse(options){
  signal?.throwIfAborted();
  const settings=await index.getSettings();
  // Search distinctness cannot be reproduced with a filtered document browse.
  if(settings.distinctAttribute||Array.isArray(settings.displayedAttributes)&&!settings.displayedAttributes.includes('*'))throw Error('Collection search settings require canonical search');
  const native=new Set(spec.orderedIds.map(clean)),documents=[],seen=new Set(),outside=[];
  let total,bytes=0;
  for(let offset=0;;offset+=1000){
   signal?.throwIfAborted();
   const page=await index.getDocuments({filter:options.filter,fields:options.attributesToRetrieve,limit:1000,offset});
   signal?.throwIfAborted();
   if(!Array.isArray(page.results)||!Number.isSafeInteger(page.total)||page.total<0||
      (total!==undefined&&page.total!==total)||page.total>maxDocuments)throw Error('Unstable collection candidate browse');
   total=page.total;bytes+=Buffer.byteLength(JSON.stringify(page.results));
   if(total-native.size>1000)throw Error('Collection candidate browse needs canonical search');
   if(bytes>maxBytes)throw Error('Collection candidate projection exceeds budget');
   for(const product of page.results){
    const id=clean(product.id);
    if(!id||id==='undefined'||seen.has(id))throw Error('Invalid collection candidate browse');
    seen.add(id);documents.push(product);if(!native.has(id))outside.push(id);
    // This path cannot prove a larger outside order. Stop immediately rather
    // than browsing every remaining page and then repeating a canonical scan.
    if(outside.length>1000)throw Error('Collection candidate browse needs canonical search');
   }
   if(page.results.length<1000)break;
  }
  if(documents.length!==total||total>(settings.pagination?.maxTotalHits??1000)||outside.length>1000)throw Error('Collection candidate browse needs canonical search');
  if(outside.length){
   const filters=[...(Array.isArray(options.filter)?options.filter:options.filter?[options.filter]:[]),`id IN ${JSON.stringify(outside)}`];
   const result=await index.search('',{...options,filter:filters,offset:0,limit:outside.length,attributesToRetrieve:['id']},{signal:signal||AbortSignal.timeout(30000)});
   signal?.throwIfAborted();
   const ids=result.hits?.map(p=>clean(p.id));
   if(!ids||ids.length!==outside.length||new Set(ids).size!==ids.length||ids.some(id=>!seen.has(id)||native.has(id)))throw Error('Outside collection order changed');
   const ranks=new Map(ids.map((id,i)=>[id,i]));
   // Native positions are assigned from Shopify by the canonical comparator.
   // Their browse order is irrelevant; outside relative positions are exact.
   documents.sort((a,b)=>(ranks.get(clean(a.id))??-1)-(ranks.get(clean(b.id))??-1));
  }
  return documents;
 }
 return {async search(q,options,extra){
  if(disabled||q||!options.attributesToRetrieve?.includes('id')||options.attributesToRetrieve.some(f=>['variantPrices','options','images','collections','collection_titles'].includes(f)))return index.search(q,options,extra);
  try{
   snapshot??=browse(options);
   const documents=await snapshot;
   return {hits:documents.slice(options.offset||0,(options.offset||0)+options.limit),estimatedTotalHits:documents.length};
  }catch(error){
   signal?.throwIfAborted();disabled=true;snapshot=null;
   return index.search(q,options,extra);
  }
 }};
}
