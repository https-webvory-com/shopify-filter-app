// ID facets read the inverted index without hydrating every matched product
// document. Accept them only with an exact total and provably sufficient caps.
// Unsupported settings/endpoints retain the existing document-browse path.
export async function readIndexedProductIds(index,{filter,maxDocuments=100000,settings}={}){
 if(typeof index.getSettings!=='function'||typeof index.search!=='function')return null;
 try{
  settings??=await index.getSettings();
  if(settings.distinctAttribute||!settings.filterableAttributes?.some(field=>field==='id'||field==='*')||
    !(settings.pagination?.maxTotalHits>=maxDocuments)||!(settings.faceting?.maxValuesPerFacet>=maxDocuments))return null;
  const result=await index.search('',{filter,facets:['id'],hitsPerPage:1,page:1,attributesToRetrieve:[]});
  const total=result.totalHits,values=result.facetDistribution?.id;
  // A count at a cap could describe a truncated set; never use it as proof.
  if(result.degraded===true||result.exhaustiveNbHits===false||!Number.isSafeInteger(total)||total<0||total>=maxDocuments||!values||typeof values!=='object'||Array.isArray(values))return null;
  const ids=Object.keys(values);
  if(ids.length!==total||ids.some(id=>!/^\d+$/.test(id)||values[id]!==1))return null;
  return ids;
 }catch{return null;}
}
