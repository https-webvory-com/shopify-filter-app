import {packCollectionResponse} from './collectionResponse.js';
import {gzip,createGzip,constants} from 'node:zlib';
import {Readable} from 'node:stream';
import {promisify} from 'node:util';
const compress=promisify(gzip);
export {collectionPageFingerprint} from './collectionResponse.js';
// Bump when saved card presentation must be rebuilt from current documents.
export const collectionCardPresentationVersion=4;

const publicKeys=new Set(['shop','collectionId','collectionHandle','country','locale','language','sortBy','page','limit','responseProfile']);
export const acceptsCollectionPinnedPrefix=request=>(request.headers.get('accept')||'').split(',').some(value=>{const [type,...parameters]=value.trim().split(';');return type==='application/x-cfp-pinned-prefix-v3'&&!parameters.some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p));});
export const acceptsPublishedCollectionPage=request=>(request.headers.get('accept')||'').split(',').some(value=>{const [type,...parameters]=value.trim().split(';');return type==='application/x-cfp-published-page-v1'&&!parameters.some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p));});
export function isPublicCollectionCards(request){
 const url=new URL(request.url),keys=[...url.searchParams.keys()],p=url.searchParams;
 return request.method==='GET'&&['collection-cards-v1','collection-preview-v1'].includes(p.get('responseProfile'))&&
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(p.get('shop')||'')&&
  !!p.get('country')&&!!(p.get('locale')||p.get('language'))&&
  !!(p.get('collectionId')||p.get('collectionHandle'))&&
  p.get('collectionHandle')!=='search'&&!(p.get('collectionHandle')==='all'&&p.has('collectionId'))&&p.get('page')==='1'&&['25','50'].includes(p.get('limit'))&&
  ['best-selling','bestselling'].includes(p.get('sortBy')||'best-selling')&&
  new Set(keys).size===keys.length&&keys.every(key=>publicKeys.has(key));
}
export function collectionCardsPayload(payload){
 if(payload.cfpCards?.published)return packCollectionResponse(payload,{profile:'collection-v1'});
 const {facets,...rest}=payload;
 // Complete, losslessly encoded configuration travels with cards. Rendering
 // never needs to wait for a separate configuration/facet response.
 return packCollectionResponse({...rest,...(payload.cfpCards?.facetsReady===true?{facets}:{}),cfpCards:{version:1,...payload.cfpCards}},{profile:'collection-v1'});
}
export function collectionPreviewPayload(payload,{limit=5,fullCards=false}={}){
 // Card-only routes have not queried collection-wide facets. Only explicitly
 // saved, complete facets may travel with a ready first page.
 if(!payload.cfpCards?.published&&payload.cfpCards?.facetsReady!==true){const {facets,...cards}=payload;payload=cards;}
 if(fullCards&&!payload.collectionPinnedPrefix)return {...payload,products:(payload.products||[]).slice(0,limit),cfpCards:{version:1,preview:false,...payload.cfpCards}};
 if(payload.collectionPinnedPrefix?.version===2)return {...payload,products:(payload.products||[]).slice(0,Math.min(25,limit)),cfpCards:{version:1,preview:false,prefix:true,proof:payload.collectionPinnedPrefix}};
 // Only ready cards' image-selection inputs travel initially. Keep variant
 // identity/options so the existing renderer chooses exactly the same image
 // and product link when the complete, token-scoped page arrives.
 const fields=['id','title','handle','selectedVariantId','pinnedProductImage','searchColor','searchColorImage','merchandisingImage',
  'metafield_custom.plus_size_collection_image','metafield_custom.mob_collection_image',
  'metafield_custom.mother_of_the_bride_collection_image','metafield_custom.wedding_collection_image'];
 return {rankingToken:payload.rankingToken,totalCount:payload.totalCount,globalSettings:payload.globalSettings,
  debug:{collectionRankingStatus:payload.debug?.collectionRankingStatus,collectionBestSellingStatus:payload.debug?.collectionBestSellingStatus},
  cfpCards:{version:1,preview:true,...(payload.collectionPinnedPrefix?{prefix:true,proof:payload.collectionPinnedPrefix}:{})},products:(payload.products||[]).slice(0,limit).map(product=>({
   ...Object.fromEntries(fields.filter(key=>Object.hasOwn(product,key)).map(key=>[key,product[key]])),
   images:(product.images||[]).slice(0,1),options:product.options,
   variants:(product.variants||[]).map(variant=>Object.fromEntries(['id','sku','available','option1','option2','option3','imageUrl','image'].filter(key=>Object.hasOwn(variant,key)).map(key=>[key,variant[key]]))),
  }))};
}
export async function collectionCardsResponse(payload,state='miss',request,{previewLimit=25}={}){
 const preview=request&&new URL(request.url).searchParams.get('responseProfile')==='collection-preview-v1';
 const stream=preview&&(request.headers.get('accept')||'').split(',').some(value=>{const [type,...params]=value.trim().split(';');return type==='application/x-ndjson'&&!params.some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p));});
 if(stream){
  // All normal ranking/document validation has already run. Send each ready
  // preview card separately; never wait for facets, prices or widget startup.
  const {products,...metadata}=collectionPreviewPayload(payload,{limit:previewLimit,fullCards:acceptsCollectionPinnedPrefix(request)||acceptsPublishedCollectionPage(request)});
  function* records(){
   yield Buffer.from(JSON.stringify({type:'start',count:products.length,payload:metadata})+'\n');
   for(const product of products)yield Buffer.from(JSON.stringify({type:'product',product})+'\n');
   yield Buffer.from(JSON.stringify({type:'end',count:products.length})+'\n');
  }
  const source=Readable.from(records());
  const headers={'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CFP-Collection-Cards','X-CFP-Collection-Cards':state,'Vary':'Accept, Accept-Encoding','X-Accel-Buffering':'no'};
  const gzipAccepted=(request.headers.get('accept-encoding')||'').split(',').some(value=>/^gzip(?:\s*;\s*q\s*=\s*(?!0(?:\.0*)?$)[\d.]+)?$/i.test(value.trim()));
  // Sync-flush each available record rather than buffering the complete gzip.
  const body=gzipAccepted?source.pipe(createGzip({flush:constants.Z_SYNC_FLUSH})):source;
  if(gzipAccepted)headers['Content-Encoding']='gzip';
  return new Response(Readable.toWeb(body),{headers});
 }
 let body=JSON.stringify(preview?collectionPreviewPayload(payload,{limit:previewLimit,fullCards:acceptsCollectionPinnedPrefix(request)||acceptsPublishedCollectionPage(request)}):collectionCardsPayload(payload));
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CFP-Collection-Cards','X-CFP-Collection-Cards':state,'Vary':preview?'Accept, Accept-Encoding':'Accept-Encoding'};
 // First-page variant/configuration data is repetitive. Compress after all
 // validation; this changes transport only, never cache freshness or ranking.
 const encodings=(request?.headers.get('accept-encoding')||'').split(',').map(value=>value.trim().split(';').map(part=>part.trim()));
 if(Buffer.byteLength(body)>=1024&&encodings.some(([name,...parameters])=>name.toLowerCase()==='gzip'&&!parameters.some(value=>/^q\s*=\s*0(?:\.0*)?$/i.test(value)))){
  body=await compress(body);headers['Content-Encoding']='gzip';
 }
 return new Response(body,{headers});
}
