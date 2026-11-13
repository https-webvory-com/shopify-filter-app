import prisma from '../db.server.js';
import {createHash} from 'node:crypto';
import {getCached} from './shopCache.server.js';
import {keywordSearch} from './semanticSearch.server.js';
import {cleanSuggestionText} from '../utils/searchSuggestions.js';

const httpsImage=value=>{
 const first=Array.isArray(value)?value[0]:null,candidate=typeof first==='string'?first:first?.url||first?.src||'';
 try{const url=new URL(candidate);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
};
export async function searchCollectionCards(shop,{ids=[],handles=[]}={}){
 if(!ids.length&&!handles.length)return [];
 const rows=await prisma.$queryRaw`
  SELECT c.id,c.title,c.handle,
   (SELECT p.images FROM "ProductCollection" pc JOIN "Product" p ON p.id=pc."productId"
    WHERE pc."collectionId"=c.id AND p.shop=${shop} AND lower(p.status)='active'
     AND p.images IS NOT NULL AND p.images::text NOT IN ('[]','null','""')
    ORDER BY pc."productId" LIMIT 1) AS images
  FROM "Collection" c WHERE c.shop=${shop}
   AND (c.id=ANY(${ids}::text[]) OR c.handle=ANY(${handles}::text[])) LIMIT 40`;
 return rows.map(row=>({id:row.id,title:row.title,handle:row.handle,image:httpsImage(row.images)}));
}
export async function searchCollectionCandidates(shop,query,options){
 const signature=createHash('sha256').update(JSON.stringify([query,options])).digest('hex');
 return getCached(`searchCollectionCandidates:${shop}:${signature}`,async()=>{
  const result=await keywordSearch(query,{...options,limit:0,attributesToRetrieve:[],attributesToHighlight:[],facets:['collections']});
  const entries=Object.entries(result.facetDistribution?.collections||{}).filter(([id])=>/^(?:gid:\/\/shopify\/Collection\/)?\d+$/.test(id)).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const ids=[...new Set(entries.map(([id])=>id.startsWith('gid:')?id:'gid://shopify/Collection/'+id))];
  const cards=await searchCollectionCards(shop,{ids});const byId=new Map(cards.map(card=>[card.id,card]));
  return ids.map(id=>byId.get(id)).filter(Boolean).slice(0,4);
 },30,{maxBytes:50000});
}
export async function popularSearchQueries(shop){
 return getCached(`searchPopularQueries:${shop}`,async()=>{
  const since=new Date(Date.now()-30*86400000);
  const rows=await prisma.$queryRaw`
   SELECT lower(trim(query)) AS query,COUNT(*)::int AS searches
   FROM "SearchAnalyticsEvent" WHERE shop=${shop} AND event='search_query' AND at>=${since}
    AND hits>0 AND query IS NOT NULL AND length(trim(query)) BETWEEN 2 AND 80
   GROUP BY lower(trim(query)) HAVING COUNT(DISTINCT "anonId")>=3
   ORDER BY searches DESC,query ASC LIMIT 40`;
  return rows.map(row=>cleanSuggestionText(row.query)).filter(query=>query&&!/@|https?:|www\.|\d{6,}/i.test(query)).slice(0,10);
 },60,{maxBytes:10000});
}
