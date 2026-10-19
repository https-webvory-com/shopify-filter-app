import {createHash} from 'node:crypto';

export const COLLECTION_SOURCE_FIELD='cfpCollectionInputSource';
export const isVariantCondition=c=>['SKU','Discount','Percent sales'].includes(c.field)||/option|color|size|title/i.test(c.field||'');
const conditionValue=c=>Object.fromEntries(['action','field','value','minValue','maxValue','value2','dateValue'].map(k=>[k,c[k]??null]));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function collectionConditionKey(condition,mergedValues=[]){
 return digest([conditionValue(condition),mergedValues.map(m=>[m.targetValue,m.sourceValues])]);
}
export function createCollectionFactProfile(conditions,mergedValues=[]){
 const entries=new Map();
 for(const condition of conditions.filter(isVariantCondition)){
  const key=collectionConditionKey(condition,mergedValues);if(!entries.has(key))entries.set(key,{key,condition:conditionValue(condition)});
 }
 const rows=[...entries.values()].sort((a,b)=>a.key.localeCompare(b.key));
 return {version:1,id:digest(['collection-rule-facts-v1',rows.map(r=>r.key)]),conditions:rows,mergedValues};
}
export function collectionInputSource(product){
 return digest([product.variantPrices||product.variants||[],product.options||[],product.images||[]]);
}
// The ordinary product writer owns InputSource. A backfill must never change
// that marker: a concurrent newer product write then makes old facts unusable.
export function projectCollectionRuleFacts(product,profile,check,{backfill=false}={}){
 const matches=[],images={};
  const candidate={...product,variants:product.variants||product.variantPrices||[]};
 for(const {key,condition}of profile.conditions){
  const result=check(candidate,condition,profile.mergedValues,false);
  if(!result)continue;
  matches.push(key+':'+(typeof result==='object'?(result.matchType==='exact'?'e':'m'):'b'));
  if(result.imageUrl)images[key]=result.imageUrl;
 }
 const source=backfill?(product.cfpCollectionInputSource||'legacy'):collectionInputSource(product);
 return {cfpCollectionFactProfile:profile.id,cfpCollectionFactSource:source,cfpCollectionFactMatches:matches,cfpCollectionFactImages:images,
  ...(!backfill?{cfpCollectionInputSource:source}:{})};
}
export function collectionFactsCurrent(product,profile){
 return product.cfpCollectionFactProfile===profile.id&&product.cfpCollectionFactSource===(product.cfpCollectionInputSource||'legacy')&&
  Array.isArray(product.cfpCollectionFactMatches)&&product.cfpCollectionFactImages&&typeof product.cfpCollectionFactImages==='object';
}
export function collectionFactResolver(rule,profile,mergedValues=[]){
 const keys=new Map(profile.conditions.map(row=>[row.key,true])),conditions=new Map();
 const all=[...(rule?.conditions||[]),...(rule?.collectionLegacyConditions||[]),...(rule?.ruleGroups||[]).flatMap(group=>group.conditions||[])];
 for(const c of all)if(isVariantCondition(c)){
  const key=collectionConditionKey(c,mergedValues);if(!keys.has(key))return null;conditions.set(c,key);
 }
 return product=>{
  if(!collectionFactsCurrent(product,profile))throw Error('Collection ranking facts are not current');
  const matched=new Set(product.cfpCollectionFactMatches),images=product.cfpCollectionFactImages;
  return condition=>{
   const key=conditions.get(condition);if(!key)return undefined;
   return {known:true,value:matched.has(key+':e')?{matchType:'exact',imageUrl:images[key]}:
    matched.has(key+':m')?{matchType:'merged',imageUrl:images[key]}:matched.has(key+':b')?true:false};
  };
 };
}
