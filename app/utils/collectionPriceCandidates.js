const clean=id=>String(id).split('/').pop();
// Membership is already indexed. Reading IDs must not ask the search engine
// to rank every matching product before SQL selects the requested price page.
export async function collectionPriceCandidateIds(index,{q='',filter}){
 const maximum=100000;
 if(!q&&typeof index.getDocuments==='function'){
  const read=offset=>index.getDocuments({filter,fields:['id'],limit:maximum,offset});
  try{
   const first=await read(0),rows=[...(first.results||[])],total=first.total;
   if(!Array.isArray(first.results)||!Number.isSafeInteger(total)||total<0||total>maximum)throw Error('Invalid saved-price candidate membership');
   while(rows.length<total){
    const next=await read(rows.length);
    if(next.total!==total||!Array.isArray(next.results)||!next.results.length)throw Error('Collection membership changed while reading saved prices');
    rows.push(...next.results);
   }
   const ids=rows.map(product=>clean(product.id));
   if(ids.length!==total||new Set(ids).size!==ids.length||ids.some(id=>!id||id==='undefined'))throw Error('Incomplete saved-price candidate membership');
   return ids;
  }catch(error){
   if(!['invalid_document_filter','route_not_found'].includes(error.code)&&![404,405].includes(error.httpStatus))throw error;
  }
 }
 const result=await index.search(q,{filter,limit:maximum,offset:0,attributesToRetrieve:['id']});
 const ids=(result.hits||[]).map(product=>clean(product.id)),total=result.totalHits??result.estimatedTotalHits??ids.length;
 if(ids.length!==total||new Set(ids).size!==ids.length)throw Error('Incomplete saved-price candidate membership');
 return ids;
}
