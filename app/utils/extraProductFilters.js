import {normalizePriceFilter} from './filterPresentation.js';
const numericTypes = {weight:{parameter:'weight[]',config:'weightRanges',max:Infinity},review_rating:{parameter:'rating[]',config:'reviewRanges',max:5}};
export const extraFilterTypes = new Set(['weight','review_rating','inventory_locations','stock_status']);
const configOf = filter => {try{const value=typeof filter.config==='string'?JSON.parse(filter.config):filter.config;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}};
export function numericFilterRange(type,from,to) {
  const min=from==null||from===''?0:Number(from), ceiling=numericTypes[type]?.max;
  const max=to==null||to===''?(type==='review_rating'&&min===0?0:ceiling):Number(to);
  return Number.isFinite(min)&&min>=0&&(Number.isFinite(max)||max===Infinity)&&max>=min&&max<=ceiling?{min,max,value:`${min}:${max}`} : null;
}
export function extraSelections(params) {
  const result={};
  for(const [type,{parameter}] of Object.entries(numericTypes)) {
    const values=params.getAll(parameter);if(values.length>100)throw Error('Too many filter ranges');
    result[type]=values.map(value=>{if(!/^\d+(?:\.\d+)?:(?:\d+(?:\.\d+)?|Infinity)$/.test(value))throw Error('Invalid filter range');const range=numericFilterRange(type,...value.split(':'));if(!range)throw Error('Invalid filter range');return range;});
  }
  result.inventory_locations=params.getAll('location[]').filter(Boolean);
  if(result.inventory_locations.length>250)throw Error('Too many locations');
  result.stock_status=params.getAll('availability[]').concat(params.getAll('availability')).filter(Boolean);
  if(result.stock_status.some(value=>!['in_stock','stock_on_hand','pre_order','out_of_stock'].includes(value)))throw Error('Invalid stock status');
  return result;
}
export async function readExtraProductFacts(database,shop) {
  const rows=await database.$queryRaw`
    SELECT p.id, COALESCE(bool_or(v.available),false) AS available,
      COALESCE(bool_or(v.inventory > 0),false) AS onhand,
      COALESCE(bool_or(v.available AND v.inventory <= 0),false) AS preorder,
      (SELECT m.value FROM "ProductMetafield" m WHERE m."productId"=p.id AND m.namespace='reviews' AND m.key='rating' LIMIT 1) AS rating,
      (SELECT m.value FROM "ProductMetafield" m WHERE m."productId"=p.id AND m.namespace='__cfp_internal' AND m.key='filter_facts' LIMIT 1) AS facts
    FROM "Product" p LEFT JOIN "Variant" v ON v."productId"=p.id
    WHERE p.shop=${shop} AND LOWER(p.status)='active' GROUP BY p.id
  `;
  return rows.map(row=>{
    let rating=null,facts={};
    try {const raw=JSON.parse(row.rating);const value=raw&&typeof raw==='object'?raw.value:raw;const number=value==null||value===''?NaN:Number(value);const scale=Number(raw?.scale_max||5);if(Number.isFinite(number)&&number>=0&&number<=scale&&scale>0)rating=number/scale*5;}catch{}
    try {facts=JSON.parse(row.facts)||{};}catch{}
    return {id:String(row.id).split('/').pop(),available:row.available,onhand:row.onhand,preorder:row.preorder,rating,weights:Array.isArray(facts.weights)?facts.weights.filter(v=>Number.isFinite(v)&&v>=0):[],locations:Array.isArray(facts.locations)?facts.locations.filter(v=>v&&typeof v.id==='string'&&typeof v.label==='string'):[]};
  });
}
export function matchesExtra(row,type,value) {
  if(type==='stock_status')return value==='in_stock'?row.available:value==='stock_on_hand'?row.onhand:value==='pre_order'?row.preorder:!row.available;
  if(type==='inventory_locations')return row.locations.some(location=>location.id===value);
  if(type==='review_rating')return row.rating==null?value.min===0&&value.max===0:row.rating>=value.min&&row.rating<=value.max;
  return row.weights.some(weight=>weight>=value.min&&weight<=value.max);
}
export function extraIdsFilter(rows,type,values) {
  const ids=rows.filter(row=>values.some(value=>matchesExtra(row,type,value))).map(row=>row.id);
  return ids.length?`id IN ${JSON.stringify(ids)}`:'id = "__no_extra_filter_match__"';
}
export function extraFilterChoices(settings,rows) {
  const choices=[];
  for(const filter of settings||[]) {
    if(!filter.isEnabled||!extraFilterTypes.has(filter.filterType))continue;
    const type=filter.filterType,config=configOf(filter);
    if(numericTypes[type])for(const range of (Array.isArray(config[numericTypes[type].config])?config[numericTypes[type].config]:[]).slice(0,100)) {const bounds=numericFilterRange(type,range.from??range.min,range.to??range.max);if(bounds)choices.push({...bounds,label:range.label,type});}
    if(type==='inventory_locations')for(const location of new Map(rows.flatMap(row=>row.locations).map(v=>[v.id,v])).values())choices.push({type,value:location.id,label:location.label});
    if(type==='stock_status')for(const value of ['in_stock','stock_on_hand','pre_order','out_of_stock'])choices.push({type,value});
  }
  return [...new Map(choices.map(value=>[`${value.type}:${value.value}`,value])).values()];
}
export function hasUsableExtraFacets(payload) {
  const priceLists=(payload?.settings||[]).map(f=>normalizePriceFilter(f,payload?.globalSettings)).filter(f=>f.isEnabled&&f.filterType==='price'&&f.displayMode==='List'&&(configOf(f).priceRanges||[]).length);
  if(priceLists.length&&payload.facets){
    if(payload.facets.priceRanges?.version!==2)return false;
    // Legacy slider snapshots have no checkbox counts. Rebuild those facets
    // instead of serving an empty Price group after the new default takes effect.
    const ranges=payload.facets.priceRanges?.ranges||[];
    for(const filter of priceLists)for(const expected of configOf(filter).priceRanges){
      const min=Number(expected.min??expected.from??0),rawMax=expected.max??expected.to,max=rawMax==null||rawMax===''?Infinity:Number(rawMax);
      if(!ranges.some(range=>Number(range.min??range.from??0)===min&&Number((range.max??range.to)==null||(range.max??range.to)===''?Infinity:(range.max??range.to))===max))return false;
    }
  }
  if(!(payload?.settings||[]).some(f=>f.isEnabled&&extraFilterTypes.has(f.filterType)))return true;
  if(!payload.facets)return payload.cfpCards?.facetsReady!==true;
  return payload.facets.extraFilters?.version===1;
}
