import {readIndexedProductIds} from './indexedProductIds.js';
const baseKeys=new Set(['shop','collectionId','collectionHandle','locale','language','country','sortBy','limit','q','isSearch','customerTags','customer_tags']);
const transportKeys=new Set(['page','responseProfile','rankingToken','membershipParentToken','membershipParentQuery']);
const clean=id=>String(id).split('/').pop();
const values=(params,key)=>params.getAll(key).sort();

// Adding a new filter category narrows the previous result. Adding another
// value to an existing category can broaden it, so that uses full ranking.
export function narrowerCollectionFilters(parentUrl,childUrl){
 const parent=new URL(parentUrl).searchParams,child=new URL(childUrl).searchParams;
 for(const key of baseKeys)if(JSON.stringify(values(parent,key))!==JSON.stringify(values(child,key)))return false;
 if(parent.get('page')!=='1'||child.get('page')!=='1')return false;
 const selected=params=>new Set([...params.keys()].filter(key=>!baseKeys.has(key)&&!transportKeys.has(key)));
 const prior=selected(parent),next=selected(child);
 for(const key of prior)if(!next.has(key)||JSON.stringify(values(parent,key))!==JSON.stringify(values(child,key)))return false;
 return [...next].some(key=>!prior.has(key));
}

// The parent IDs are the full ordered Blue result, not just its first page.
// Search only that set with the new filter, then retain the parent order.
export async function readNarrowerCollectionMembership(index,{filter,parentIds,shop,maxDocuments=25000,baseAlreadyScoped=false}){
 if(!Array.isArray(parentIds)||!parentIds.length||parentIds.length>maxDocuments||
    new Set(parentIds.map(clean)).size!==parentIds.length||parentIds.some(id=>!/^\d+$/.test(clean(id))))return null;
 try{
  const allowed=new Set(parentIds.map(clean)),found=new Set();
  // The first filter can reuse a complete unfiltered ranking. Its collection
  // predicate already scopes the candidate query, so avoid a huge ID clause.
  // Every returned ID is still checked against the frozen parent membership.
  const scoped=baseAlreadyScoped?filter:[...filter,`id IN ${JSON.stringify([...allowed])}`];
  const indexed=await readIndexedProductIds(index,{filter:scoped,maxDocuments});
  if(indexed!==null){
   if(indexed.some(id=>!allowed.has(id)))return null;
   const selected=new Set(indexed);return parentIds.filter(id=>selected.has(clean(id)));
  }
  const settings=await index.getSettings();
  if(settings.distinctAttribute||Array.isArray(settings.displayedAttributes)&&!settings.displayedAttributes.includes('*'))return null;
  let total=null;
  const read=offset=>index.getDocuments({filter:scoped,fields:['id','shop','status'],limit:1000,offset});
  function accept(page,offset){
   if(!Array.isArray(page.results)||!Number.isSafeInteger(page.total)||page.total<0||page.total>maxDocuments||
      total!==null&&page.total!==total||page.results.length!==Math.min(1000,Math.max(0,page.total-offset)))throw Error('Incomplete collection membership');
   total=page.total;
   for(const product of page.results){
    const id=clean(product.id);
    if(!/^\d+$/.test(id)||product.shop!==shop||product.status!=='ACTIVE'||!allowed.has(id)||found.has(id))throw Error('Invalid collection membership');
    found.add(id);
   }
  }
  accept(await read(0),0);
  for(let offset=1000;offset<total;offset+=4000){
   const offsets=Array.from({length:Math.min(4,Math.ceil((total-offset)/1000))},(_,i)=>offset+i*1000);
   const pages=await Promise.allSettled(offsets.map(read));
   for(let i=0;i<pages.length;i++){
    if(pages[i].status==='rejected')throw pages[i].reason;
    accept(pages[i].value,offsets[i]);
   }
  }
  if(found.size!==total)return null;
  return parentIds.filter(id=>found.has(clean(id)));
 }catch{return null;}
}
