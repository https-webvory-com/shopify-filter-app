import {readRankedCollectionPage} from './rankedCollectionPage.js';
import {prepareCollectionRanking} from './prepareCollectionRanking.js';

// Explicit product pins precede every merchandising tier in native best-selling
// mode. Prove only that fixed prefix; never infer unpinned positions or totals.
export async function prepareCollectionPinnedPrefix(spec,{index,prisma,arrange,comparator,batchOwner=index,onDecline=()=>{}}){
 const decline=reason=>{onDecline(reason);return null;};
 if(spec.retainForIdle!==true)return decline('private-or-filtered-context');
 if(spec.needsShopifyOrder!==true||!['best-selling','bestselling'].includes(spec.sortBy))return decline('unsupported-sort');
 if(!Array.isArray(spec.pinnedIds)||!spec.pinnedIds.length)return decline('insufficient-eligible-pins');
 let pins;try{pins=typeof spec.pinningRule?.products==='string'?JSON.parse(spec.pinningRule.products):spec.pinningRule?.products;}catch{return decline('malformed-pins');}
 if(!Array.isArray(pins)||pins.some(p=>!/^gid:\/\/shopify\/Product\/\d+$/.test(p?.id||'')))return decline('malformed-pins');
 if(new Set(pins.map(p=>p.id)).size!==pins.length)return decline('duplicate-pins');
 const eligible=new Set(spec.pinnedIds),selected=pins.filter(p=>eligible.has(p.id)).map(p=>p.id.split('/').pop());
 if(!selected.length||selected.length!==eligible.size)return decline('insufficient-configured-eligible-pins');
 if(selected.length>10000)return decline('pin-response-budget');
 const limit=selected.length;
 const page=await readRankedCollectionPage(index,{ids:selected,page:1,limit,shop:spec.shop,batchOwner,requireDocuments:true});
 // Unknown/zero prices can move pins behind all paid products. Missing or
 // unproven documents require the complete canonical path instead.
 if(page.hits.some(p=>p.shop!==spec.shop||String(p.status).toUpperCase()!=='ACTIVE'||!p.title||!p.handle))return decline('unproven-current-product');
 if(page.hits.some(p=>p.priceMin==null||p.priceMin===''||!Number.isFinite(Number(p.priceMin))))return decline('unknown-base-price');
 if(page.hits.some(p=>Number(p.priceMin)<=0))return decline('nonpositive-leading-pin-price');
 const bounded={search:async(_query,{offset=0,limit=1000}={})=>({hits:page.hits.slice(offset,offset+limit),estimatedTotalHits:page.hits.length})};
 const value=await prepareCollectionRanking({...spec,pinnedIds:selected.map(id=>'gid://shopify/Product/'+id)},{index:bounded,prisma,arrange,comparator});
 if(JSON.stringify(value.ids)!==JSON.stringify(selected))return decline('canonical-pin-order-differs');
 return value;
}
