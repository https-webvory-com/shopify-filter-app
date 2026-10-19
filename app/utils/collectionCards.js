import {packCollectionResponse} from './collectionResponse.js';
export {collectionPageFingerprint} from './collectionResponse.js';

const publicKeys=new Set(['shop','collectionId','collectionHandle','country','locale','language','sortBy','page','limit','responseProfile']);
export function isPublicCollectionCards(request){
 const url=new URL(request.url),keys=[...url.searchParams.keys()],p=url.searchParams;
 return request.method==='GET'&&p.get('responseProfile')==='collection-cards-v1'&&
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(p.get('shop')||'')&&
  !!p.get('country')&&!!(p.get('locale')||p.get('language'))&&
  !!(p.get('collectionId')||p.get('collectionHandle'))&&
  !['search','all'].includes(p.get('collectionHandle'))&&p.get('page')==='1'&&p.get('limit')==='25'&&
  ['best-selling','bestselling'].includes(p.get('sortBy')||'best-selling')&&
  new Set(keys).size===keys.length&&keys.every(key=>publicKeys.has(key));
}
export function collectionCardsPayload(payload){
 const {facets,...rest}=payload;
 // Complete, losslessly encoded configuration travels with cards. Rendering
 // never needs to wait for a separate configuration/facet response.
 return packCollectionResponse({...rest,cfpCards:{version:1}},{profile:'collection-v1'});
}
export function collectionCardsResponse(payload,state='miss'){
 return new Response(JSON.stringify(collectionCardsPayload(payload)),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CFP-Collection-Cards','X-CFP-Collection-Cards':state}});
}
