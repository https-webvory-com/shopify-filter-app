// ID facets read the inverted index without hydrating every matched product
// document. Accept them only with an exact total and provably sufficient caps.
// Unsupported settings/endpoints retain the existing document-browse path.
// These three settings change only when the index is reconfigured, yet were
// fetched on every filter click (three extra engine round trips per click).
// Reuse them briefly per index; the checks below are unchanged.
const settingsCache=new Map(),settingsLifetimeMs=60000;
async function cachedIdFacetSettings(index,now=Date.now()){
 const key=index.uid;
 const hit=key&&settingsCache.get(key);
 if(hit&&now-hit.at<settingsLifetimeMs)return hit.value;
 const value=Promise.all([index.getDistinctAttribute(),index.getPagination(),index.getFaceting()])
  .then(([distinctAttribute,pagination,faceting])=>({distinctAttribute,pagination,faceting,filterableAttributes:['id']}));
 if(key){settingsCache.set(key,{at:now,value});value.catch(()=>settingsCache.delete(key));}
 return value;
}
export function clearIndexedProductIdSettings(){settingsCache.clear();}
export async function readIndexedProductIds(index,{filter,maxDocuments=100000,settings}={}){
 if(typeof index.search!=='function')return null;
 try{
  if(!settings){
   // Full settings can include the entire synonym dictionary. Keep these
   // safety checks current without transferring unrelated index settings.
   if(['getDistinctAttribute','getPagination','getFaceting'].every(name=>typeof index[name]==='function')){
    // A successful ID facet query below also proves that id is filterable.
    settings=await cachedIdFacetSettings(index);
   }else if(typeof index.getSettings==='function')settings=await index.getSettings();
   else return null;
  }
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
