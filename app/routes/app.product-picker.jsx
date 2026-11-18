import {authenticate} from '../shopify.server';
import {searchPickerPage} from '../services/searchPicker.server.js';
import {listSearchCollections,listSearchProducts} from '../services/searchCollectionPicker.server.js';
import {pinProductTagSuggestions} from '../utils/pinProductSearch.server';
import prisma from '../db.server';

export async function loader({request}){
 const {session}=await authenticate.admin(request),url=new URL(request.url),query=url.searchParams.get('q')||'',after=url.searchParams.get('after')||'';
 try{
  return Response.json(url.searchParams.get('scope')==='collections'?await listSearchCollections(session.shop,{query,after}):await listSearchProducts(session.shop,{query,after}));
 }catch(error){
  console.error('Catalog picker unavailable:',error.code||error.name);
  return Response.json({query,after,products:[],collections:[],productPickerError:'Could not load products. Please retry.',collectionPickerError:'Could not load collections. Please retry.'});
 }
}
export async function action({request}){
 const fields=await request.clone().formData(),scope=new URL(request.url).searchParams.get('scope');
 if(scope==='merchandising'&&fields.get('actionType')==='searchProducts'){
  try{const route=await import('./app.search.merchandising.jsx');return Response.json(await route.action({request}));}
  catch(error){console.error('Merchandising picker unavailable:',error.code||error.name);return Response.json({queryKey:String(fields.get('searchQueries')||'[]'),query:String(fields.get('q')||''),products:[],error:'Could not load products. Please retry.'});}
 }
 if(!['search','tagSuggestions'].includes(fields.get('intent')))return Response.json({error:'Invalid picker request'},{status:400});
 if(scope==='collection'){
  try{const route=await import('./app.collections.pinning.$id.jsx');return await route.action({request,params:{id:'new'}});}
  catch(error){console.error('Collection pin picker unavailable:',error.code||error.name);return Response.json({products:[],totalCount:0,error:'Could not load products. Please retry.'});}
 }
 const {session}=await authenticate.admin(request),query=String(fields.get('q')||''),targetQueryKey=String(fields.get('targetQueries')||'[]');
 try{
  if(scope==='tags')return Response.json({query,tags:await pinProductTagSuggestions(prisma,session.shop,query)});
  const targets=JSON.parse(targetQueryKey),excludedIds=JSON.parse(fields.get('excludedIds')||'[]');
  if(!Array.isArray(targets)||targets.length>1||targets.some(term=>typeof term!=='string')||!Array.isArray(excludedIds)||excludedIds.some(id=>typeof id!=='string'))throw Error('Invalid picker target');
  if(!targets.length&&fields.get('applyToAll')==='false')return Response.json({products:[],totalCount:0,targetQueryKey,nonMatchingPinnedIds:[]});
  const result=await searchPickerPage(session.shop,targets[0]||'',{query,searchField:fields.get('searchField')||'title',skip:Number(fields.get('skip')||0),limit:9,excludedIds});
  return Response.json({...result,targetQueryKey,query,searchField:fields.get('searchField')||'title'});
 }catch(error){
  console.error('Search pin picker unavailable:',error.code||error.name);
  return Response.json({products:[],totalCount:0,targetQueryKey,query,error:'Could not load matching products. Please retry.',nonMatchingPinnedIds:[]});
 }
}
