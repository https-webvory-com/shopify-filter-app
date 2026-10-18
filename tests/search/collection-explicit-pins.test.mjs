import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {readyPreparation} from './helpers/prepared-ranking.mjs';
import * as color from '../../app/utils/searchColor.js';
import * as variants from '../../app/utils/availableVariants.js';
import * as ranked from '../../app/utils/rankedCollectionPage.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
import {fetchCollectionPage} from '../../app/utils/collectionPage.js';

for(const imported of [false,true]) for(const sortBy of ['best-selling','manual']) test(`${sortBy}: ${imported?'imported pins require membership or exact Include eligibility':'legacy pins retain explicit outside-collection behavior'}`,async()=>{
  const shop='fixture.myshopify.com',collection='gid://shopify/Collection/1';
  const full=id=>`gid://shopify/Product/${id}`;
  const outside=new Set([3,7,14,24,26,28,29,30,32]);
  const soldOut=new Set([11,12,16,18,31,35]);
  const documents=Array.from({length:38},(_,i)=>{
    const id=i+1;return {id:String(id),shop:id===38?'other.myshopify.com':shop,title:`Dress ${id}`,handle:`dress-${id}`,
      status:id===36?'DRAFT':id===37?'ARCHIVED':'ACTIVE',priceMin:100,priceMax:100,tags:id===3?['Top Sequins']:id===7?['TopSequins']:[],images:['dress.jpg'],options:[],
      collections:outside.has(id)||soldOut.has(id)?[]:[collection],
      variantPrices:[{id:`${id}01`,available:!soldOut.has(id),price:100}],};
  });
  const pins=documents.map(p=>({id:full(p.id)}));pins.push({id:full('missing')});
  const ordinary=documents.filter(p=>p.shop===shop&&p.status==='ACTIVE'&&p.variantPrices[0].available&&p.collections.includes(collection));
  const index={search:async(_q,opts)=>({hits:ordinary.slice(opts.offset,opts.offset+opts.limit)}),getDocument:async id=>documents.find(p=>p.id===id)};
  const meili={index:()=>index,multiSearch:async({queries})=>({results:queries.map(()=>({hits:[],totalHits:ordinary.length,estimatedTotalHits:ordinary.length,facetDistribution:{}}))})};
  let pinQueries=0;
  const prisma={product:{findMany:async({where,select})=>{
    if(select?.priceMin)return documents.filter(p=>p.shop===where.shop&&where.id.in.includes(full(p.id))).map(p=>({id:full(p.id),priceMin:p.priceMin}));
    pinQueries++;
    assert.equal(where.shop,shop);assert.equal(where.status.equals,'active');
    assert.equal(where.collections,undefined);
    if(imported){assert.equal(where.OR[0].collections.some.collectionId,collection);assert.deepEqual([...where.OR[1].tags.hasSome],['Top Sequins']);}else assert.equal(where.OR,undefined);
    assert.equal(where.variants.some.available,true);
    return documents.filter(p=>p.shop===where.shop&&p.status.toLowerCase()===where.status.equals&&where.id.in.includes(full(p.id))&&p.variantPrices[0].available&&(!imported||p.collections.includes(collection)||p.tags.includes('Top Sequins'))).map(p=>({id:full(p.id)}));
  }}};
  const merch=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:prisma}});
  const sessions=new Map();
  const mocks={
    'react-router':{data:(v,opts)=>({...v,_status:opts?.status??200})},'../db.server':{default:prisma},
    '../utils/searchColor.js':color,'../utils/availableVariants.js':variants,'../utils/spellingCorrection.js':{spellingCorrection},
    '../services/merchandising.server':{...merch,getActiveRuleForCollection:async()=>imported?{conditions:[{action:'Include',field:'Tags',value:'Top Sequins'}]}:null,getActivePinningRuleForCollection:async()=>({products:pins,collectionSortKey:imported?'[1]':null})},
    '../services/filterSettings.server':{},'../services/meiliClient.server':{default:meili},
    '../services/semanticSearch.server':{semanticMultiSearch:queries=>meili.multiSearch({queries})},
    '../services/searchRanking.server.js':{},'../shopify.server':{},'../services/rateLimiter.server':{rateLimit:async()=>true},
    '../services/shopCache.server':{getCached:async(key,read)=>key.startsWith('globalSettings:')?{showOnlyInStock:true}:key.startsWith('mergedValues:')?[]:key.startsWith('filterGroup:')?{resolvedCollectionId:collection,resolvedCollectionTitle:'Cocktail Dresses',activeGroupFilters:[]}:read()},
    '../services/collectionBestSelling.server.js':{getCollectionBestSellingState:async()=>({ids:ordinary.map(p=>p.id),status:'ready'})},
    '../utils/collectionPage.js':{fetchCollectionPage},'../utils/rankedCollectionPage.js':ranked,
    '../services/collectionPreparation.server.js':readyPreparation({index,prisma,arrange:merch.applyMerchandisingRules}),
    '../services/collectionRankingSession.server.js':{collectionRankingFingerprint:()=>sortBy,getCollectionRankingSession:async(_s,_f,token)=>sessions.get(token),saveCollectionRankingSession:async(_s,_f,ids,_u,metadata)=>{const s={token:'test-token',ids,metadata};sessions.set(s.token,s);return s;}},
  };
  const {loader}=await loadModule('app/routes/api.filter.jsx',mocks);
  const output=[];let token;
  for(const page of [1,2]){
    const result=await loader({request:new Request(`https://fixture/api/filter?shop=${shop}&collectionHandle=cocktail-dress&sortBy=${sortBy}&page=${page}&limit=25${token?'&rankingToken='+token:''}`)});
    assert.equal(result.crash,undefined,result.error);assert.equal(result.totalCount,imported?21:29);
    assert.equal(result.products.length,page===1?(imported?21:25):(imported?0:4));token=result.rankingToken;
    output.push(...result.products.map(p=>p.id));
  }
  const expected=documents.filter(p=>p.shop===shop&&p.status==='ACTIVE'&&p.variantPrices[0].available&&(!imported||p.collections.includes(collection)||p.tags.includes('Top Sequins'))).map(p=>full(p.id));
  assert.deepEqual(output,expected);assert.equal(new Set(output).size,imported?21:29);assert.ok(output.includes(full(3)));assert.ok(pinQueries>=2);
  if(imported)assert.ok(!output.includes(full(7)),'TopSequins is not the exact Include tag Top Sequins');
  const filtered=await loader({request:new Request(`https://fixture/api/filter?shop=${shop}&collectionHandle=cocktail-dress&sortBy=${sortBy}&page=1&limit=25&vendor=Example`)});
  assert.equal(filtered.crash,undefined,filtered.error);
  assert.ok(filtered.products.every(p=>!outside.has(Number(p.id.split('/').pop()))),'Filters suppress explicit outside-collection pin injection');
});
