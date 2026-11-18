import { parseQuery } from './queryParser.server.js';
import prisma from '../db.server';
import {semanticSearch} from './semanticSearch.server';
import {rankNativeSearchPage} from './nativeSearchPage.server.js';
import {pinProductSearchFilter} from '../utils/pinProductSearch.server';
import {catalogImageUrls} from '../utils/pinProductImages.js';

// Admin pickers share storefront paging. Never expand the matching catalog
// into a SQL IN list just to display a handful of cards.
export async function searchPickerPage(shop,targetQuery,{query='',searchField='title',skip=0,limit=9,excludedIds=[],stockOnly}={}){
  query=String(query).trim();targetQuery=String(targetQuery||'').trim();
  if(query.length>200||targetQuery.length>300||!Number.isSafeInteger(skip)||skip<0||skip>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid product picker request');
  if(stockOnly===undefined){const setting=await prisma.filterGlobalSetting.findUnique({where:{shop},select:{showOnlyInStock:true}});stockOnly=setting?.showOnlyInStock===true;}
  const parsedQuery=targetQuery?await parseQuery(targetQuery,shop):null;
  const filter=[`shop = ${JSON.stringify(shop)}`,"status = 'ACTIVE'"];
  if(stockOnly)filter.push('available = true');
  if(parsedQuery?.colorFilter)filter.push(parsedQuery.colorFilter);
  if(parsedQuery?.skuProductIds?.length)filter.push('id IN '+JSON.stringify(parsedQuery.skuProductIds));
  const targetFilter=filter.filter(clause=>clause!=='available = true');
  if(excludedIds.length)filter.push('NOT (id IN '+JSON.stringify(excludedIds.map(id=>String(id).split('/').pop()))+')');
  if(query){
    const search=await pinProductSearchFilter(prisma,shop,query,searchField);
    const candidates=await prisma.product.findMany({where:{shop,status:{equals:'active',mode:'insensitive'},...search},select:{id:true}});
    if(!candidates.length)return {products:[],totalCount:0,nonMatchingPinnedIds:[]};
    filter.push('id IN '+JSON.stringify(candidates.map(product=>String(product.id).split('/').pop())));
  }
  const options={_cfpSearchSurface:true,filter,attributesToRetrieve:['id','title','handle','images','options','variantPrices','status']};
  const page=Math.floor(skip/limit)+1;
  let result=await rankNativeSearchPage({shop,query:targetQuery,options,parsedQuery,globalSettings:{showOnlyInStock:stockOnly},page,limit});
  if(!result){
    // Missing native projections must still use a bounded engine page.
    const response=await semanticSearch(targetQuery,{...options,offset:skip,limit});
    result={products:response.hits,total:response.totalHits??response.estimatedTotalHits??response.hits.length};
  }
  const ids=result.products.map(product=>'gid://shopify/Product/'+String(product.id).split('/').pop());
  const rows=ids.length?await prisma.product.findMany({where:{shop,status:{equals:'active',mode:'insensitive'},id:{in:ids},...(stockOnly?{variants:{some:{available:true}}}:{})},select:{id:true,title:true,handle:true,images:true}}):[];
  const byId=new Map(rows.map(row=>[row.id,row]));
  let nonMatchingPinnedIds=[];
  if(targetQuery&&excludedIds.length){
    const matches=await semanticSearch(targetQuery,{_cfpSearchSurface:true,filter:[...targetFilter,'id IN '+JSON.stringify(excludedIds.map(id=>String(id).split('/').pop()))],attributesToRetrieve:['id'],page:1,hitsPerPage:excludedIds.length});
    const matching=new Set(matches.hits.map(product=>String(product.id).split('/').pop()));
    nonMatchingPinnedIds=excludedIds.filter(id=>!matching.has(String(id).split('/').pop()));
  }
  return {products:ids.flatMap(id=>{const row=byId.get(id);return row?[{...row,image:catalogImageUrls(row.images)[0]||null}]:[];}),totalCount:result.total,nonMatchingPinnedIds};
}

// Use storefront retrieval, rather than a catalog-wide title substring lookup.
export async function searchPickerProducts(shop, queries, {query:productQuery='',limit=50} = {}) {
  const products = new Map();
  for (const query of [...new Set(queries.map(q => String(q).trim()).filter(Boolean))]) {
    const result=await searchPickerPage(shop,query,{query:productQuery,limit,stockOnly:false});
    for (const product of result.products) products.set(product.id, product);
  }
  return [...products.values()];
}
