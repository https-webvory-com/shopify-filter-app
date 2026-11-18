import prisma from '../db.server';
import {rateLimit} from '../services/rateLimiter.server';
import {savedMarketProduct} from '../utils/savedMarketPricing.js';

// Read existing prices for the visible page. Never fetch Shopify, mutate a
// product, enqueue work, rebuild an index, or inspect the rest of the catalog.
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
