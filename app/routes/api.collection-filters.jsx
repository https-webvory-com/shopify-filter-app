import {getPreparedCollectionFilters} from '../services/collectionCards.server.js';
import {getMarketAvailabilityState} from '../services/marketAvailability.server.js';
import {publishedCollectionKey} from '../utils/collectionPublishedPage.js';
import {rateLimit} from '../services/rateLimiter.server';
import prisma from '../db.server';

// A small, independent read of filter values already saved in PostgreSQL.
// Missing preparations fall back to the ordinary collection request.
export async function loader({request}){
 const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'If-None-Match'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 const url=new URL(request.url);
 const keys=[...url.searchParams.keys()];
 if(new Set(keys).size!==keys.length)return Response.json({error:'Duplicate filter context'},{status:400,headers});
 const customerTags=url.searchParams.get('customer_tags');
 url.searchParams.delete('customer_tags');
 url.pathname='/api/filter';
 url.searchParams.set('responseProfile','collection-v1');
 const canonical=new Request(url,{method:request.method,headers:request.headers});
 if(!publishedCollectionKey(canonical)||url.searchParams.get('page')!=='1'||url.searchParams.get('limit')!=='25'||!/^[A-Z]{2}$/.test(url.searchParams.get('country')||''))
  return Response.json({error:'Invalid saved filter context'},{status:400,headers});
 if(!await rateLimit(request))return Response.json({error:'Too many requests'},{status:429,headers});
 const shop=url.searchParams.get('shop'),country=url.searchParams.get('country');
 // Logged-in customers can reuse the public preparation only when this shop
 // has no active customer-tag rules that could change collection membership.
 if(customerTags&&await prisma.merchandisingRule.findFirst({where:{shop,status:true,ruleType:'collection',customerTags:{not:''}},select:{id:true}}))
  return Response.json({cfpFilters:{version:1,status:'pending'}},{status:202,headers});
 const market=await getMarketAvailabilityState(shop,country);
 if(market.status!=='pending'){
  const saved=await getPreparedCollectionFilters(canonical,{marketAvailabilityVersion:market.version??null,allowStaleMarket:market.status==='ready'});
  if(saved)return saved;
 }
 return Response.json({cfpFilters:{version:1,status:'pending'}},{status:202,headers});
}
