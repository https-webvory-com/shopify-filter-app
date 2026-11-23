import prisma from '../db.server';
import {rateLimit} from '../services/rateLimiter.server';
import {savedMarketProduct} from '../utils/savedMarketPricing.js';

// GET remains a bounded saved-price read. POST requests a durable server-side
// verification; prices are fetched from Shopify, never trusted from a browser.
export async function loader({request}){
 const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
 const url=new URL(request.url),shop=url.searchParams.get('shop'),country=url.searchParams.get('country'),currency=url.searchParams.get('currency');
 const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(Boolean))];
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'')||!/^[A-Z]{2}$/.test(country||'')||!/^[A-Z]{3}$/.test(currency||'')||!ids.length||ids.length>40||ids.some(id=>!/^\d+$/.test(id)))return Response.json({error:'Invalid price scope'},{status:400,headers});
 if(!await rateLimit(request))return Response.json({error:'Too many requests'},{status:429,headers});
 const rows=await prisma.product.findMany({where:{shop,status:{equals:'active',mode:'insensitive'},id:{in:ids.map(id=>'gid://shopify/Product/'+id)}},select:{id:true,variants:{select:{id:true,price:true,compareAtPrice:true,available:true,marketPrices:true}}}});
 const products=rows.map(product=>savedMarketProduct(product,country)).filter(product=>product.pricingContext?.currency===currency);
 return Response.json({country,currency,products}, {headers});
}

export async function action({request}){
 const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
 const url=new URL(request.url),shop=url.searchParams.get('shop'),country=url.searchParams.get('country'),currency=url.searchParams.get('currency');
 const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(Boolean))];
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'')||!/^[A-Z]{2}$/.test(country||'')||!/^[A-Z]{3}$/.test(currency||'')||!ids.length||ids.length>40||ids.some(id=>!/^\d{1,20}$/.test(id)))return Response.json({error:'Invalid price scope'},{status:400,headers});
 if(!await rateLimit(request))return Response.json({error:'Too many requests'},{status:429,headers});
 try{
  const {requestMarketPriceRefresh}=await import('../services/marketPriceRefresh.server.js');
  const result=await requestMarketPriceRefresh({shop,country,currency,ids});
  return Response.json(result,{status:result.unsupported?400:202,headers});
 }catch{return Response.json({error:'Price refresh temporarily unavailable'},{status:503,headers});}
}
