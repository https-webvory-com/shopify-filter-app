import {packCollectionResponse} from './collectionResponse.js';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
export {collectionPageFingerprint} from './collectionResponse.js';

const publicKeys=new Set(['shop','collectionId','collectionHandle','country','locale','language','sortBy','page','limit','responseProfile']);
export function isPublicCollectionCards(request){
 const url=new URL(request.url),keys=[...url.searchParams.keys()],p=url.searchParams;
 return request.method==='GET'&&['collection-cards-v1','collection-preview-v1'].includes(p.get('responseProfile'))&&
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
export function collectionPreviewPayload(payload){
 // Only the first row's image-selection inputs travel initially. Keep variant
 // identity/options so the existing renderer chooses exactly the same image
 // and product link when the complete, token-scoped page arrives.
 const fields=['id','title','handle','selectedVariantId','searchColor','searchColorImage','merchandisingImage',
  'metafield_custom.plus_size_collection_image','metafield_custom.mob_collection_image',
  'metafield_custom.mother_of_the_bride_collection_image','metafield_custom.wedding_collection_image'];
 return {rankingToken:payload.rankingToken,totalCount:payload.totalCount,globalSettings:payload.globalSettings,
  debug:{collectionRankingStatus:payload.debug?.collectionRankingStatus,collectionBestSellingStatus:payload.debug?.collectionBestSellingStatus},
  cfpCards:{version:1,preview:true},products:(payload.products||[]).slice(0,4).map(product=>({
   ...Object.fromEntries(fields.filter(key=>Object.hasOwn(product,key)).map(key=>[key,product[key]])),
   images:(product.images||[]).slice(0,1),options:product.options,
   variants:(product.variants||[]).map(variant=>Object.fromEntries(['id','available','option1','option2','option3','imageUrl','image'].filter(key=>Object.hasOwn(variant,key)).map(key=>[key,variant[key]]))),
  }))};
}
export async function collectionCardsResponse(payload,state='miss',request){
 const preview=request&&new URL(request.url).searchParams.get('responseProfile')==='collection-preview-v1';
 let body=JSON.stringify(preview?collectionPreviewPayload(payload):collectionCardsPayload(payload));
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CFP-Collection-Cards','X-CFP-Collection-Cards':state,'Vary':'Accept-Encoding'};
 // First-page variant/configuration data is repetitive. Compress after all
 // validation; this changes transport only, never cache freshness or ranking.
 const encodings=(request?.headers.get('accept-encoding')||'').split(',').map(value=>value.trim().split(';').map(part=>part.trim()));
 if(Buffer.byteLength(body)>=1024&&encodings.some(([name,...parameters])=>name.toLowerCase()==='gzip'&&!parameters.some(value=>/^q\s*=\s*0(?:\.0*)?$/i.test(value)))){
  body=await compress(body);headers['Content-Encoding']='gzip';
 }
 return new Response(body,{headers});
}
