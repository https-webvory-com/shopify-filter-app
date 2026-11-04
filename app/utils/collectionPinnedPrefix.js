import {readRankedCollectionPage} from './rankedCollectionPage.js';
import {prepareCollectionRanking} from './prepareCollectionRanking.js';

// Explicit product pins precede every merchandising tier when pin priority is
// enabled. Prove only that fixed prefix; never infer unpinned positions or totals.
export async function prepareCollectionPinnedPrefix(spec,{index,prisma,arrange,comparator,batchOwner=index,onDecline=()=>{}}){
 const decline=reason=>{onDecline(reason);return null;};
 if(spec.retainForIdle!==true)return decline('private-or-filtered-context');
 const native=['best-selling','bestselling'].includes(spec.sortBy)&&spec.needsShopifyOrder===true;
 const pricePins=['price-ascending','price-descending'].includes(spec.sortBy)&&spec.needsShopifyOrder!==true&&
  spec.globalSettings?.prioritizeSortOverPinning!==true&&spec.pinnedIds?.length>=25;
 if(!native&&!pricePins)return decline('unsupported-sort');
 if(!Array.isArray(spec.pinnedIds)||!spec.pinnedIds.length)return decline('insufficient-eligible-pins');
 let pins;try{pins=typeof spec.pinningRule?.products==='string'?JSON.parse(spec.pinningRule.products):spec.pinningRule?.products;}catch{return decline('malformed-pins');}
 if(!Array.isArray(pins)||pins.some(p=>!/^gid:\/\/shopify\/Product\/\d+$/.test(p?.id||'')))return decline('malformed-pins');
 if(new Set(pins.map(p=>p.id)).size!==pins.length)return decline('duplicate-pins');
 const eligible=new Set(spec.pinnedIds),eligiblePins=pins.filter(p=>eligible.has(p.id));
 if(!eligiblePins.length||eligiblePins.length!==eligible.size)return decline('insufficient-configured-eligible-pins');
 // Public collection pages contain 25 cards. Later pins retain their canonical
 // positions on subsequent pages; they never enlarge the initial grid.
 const selected=eligiblePins.slice(0,25).map(p=>p.id.split('/').pop());
 const limit=selected.length;
 const page=await readRankedCollectionPage(index,{ids:selected,page:1,limit,shop:spec.shop,batchOwner,requireDocuments:true});
 // Unknown/zero prices can move pins behind all paid products. Missing or
 // unproven documents require the complete canonical path instead.
 if(page.hits.some(p=>p.shop!==spec.shop||String(p.status).toUpperCase()!=='ACTIVE'||!p.title||!p.handle))return decline('unproven-current-product');
 if(page.hits.some(p=>p.priceMin==null||p.priceMin===''||!Number.isFinite(Number(p.priceMin))))return decline('unknown-base-price');
 if(native&&page.hits.some(p=>Number(p.priceMin)<=0))return decline('nonpositive-leading-pin-price');
 const bounded={search:async(_query,{offset=0,limit=1000}={})=>({hits:page.hits.slice(offset,offset+limit),estimatedTotalHits:page.hits.length})};
 const value=await prepareCollectionRanking({...spec,pinnedIds:selected.map(id=>'gid://shopify/Product/'+id)},{index:bounded,prisma,arrange,comparator});
 if(JSON.stringify(value.ids)!==JSON.stringify(selected))return decline('canonical-pin-order-differs');
 return value;
}
