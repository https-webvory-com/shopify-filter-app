import {canonicalSize,isSizeFacet} from './facetNormalization.js';
const normalize=value=>String(value??'').trim().toLowerCase();

// Resolve option positions, aliases and merchant merges once per product,
// rather than walking the entire rule list for every variant comparison.
export function compileVariantOptionMatcher(options,filters={},mergedValues=[]){
 const choices=Object.entries(filters).filter(([,values])=>values.length).map(([name,values])=>{
  const key=normalize(name),position=(options||[]).findIndex(option=>normalize(option.name)===key);
  const selected=new Set(values.map(normalize)),accepted=new Set(selected);
  for(const rule of mergedValues)if((!rule.optionName||normalize(rule.optionName)===key)&&selected.has(normalize(rule.targetValue)))
   for(const source of rule.sourceValues||[])accepted.add(normalize(source));
  const sizes=isSizeFacet(name)?new Set(values.map(canonicalSize).filter(Boolean)):null;
  return {position,accepted,sizes};
 });
 return variant=>choices.every(({position,accepted,sizes})=>{
  if(position<0)return false;
  const actual=normalize(variant['option'+(position+1)]);
  return accepted.has(actual)||Boolean(sizes?.has(canonicalSize(actual)));
 });
}
