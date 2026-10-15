// Real local Meilisearch fixture. Never imports the production client or uses
// shop credentials. The binary/database live under ignored scratch/.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Meilisearch } from 'meilisearch';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import * as plan from '../../app/utils/searchPagePlan.js';
import * as projection from '../../app/utils/searchIndexProjection.js';
import * as color from '../../app/utils/searchColor.js';

const pause = ms => new Promise(r => setTimeout(r, ms));
const listener = net.createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const directory = path.resolve('scratch', 'native-meili-fixture-' + process.pid);
await fs.mkdir(directory, {recursive:true});
const binary = process.env.TEST_MEILI_BINARY || path.resolve('scratch/native-meili/meilisearch-windows-amd64.exe');
const key = 'local-fixture-only-' + process.pid;
const processHandle = spawn(binary, ['--http-addr', `127.0.0.1:${port}`, '--db-path', path.join(directory,'db'),
  '--master-key', key, '--no-analytics', '--env', 'development'], {windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='', launchError;
processHandle.on('error', e => {launchError=e;});
processHandle.stdout.on('data', b => logs+=b);processHandle.stderr.on('data', b => logs+=b);
const client = new Meilisearch({host:`http://127.0.0.1:${port}`,apiKey:key});
const report={environment:'Real local Meilisearch with synthetic products/vectors and mock Shopify authentication; no production access',checks:[]};
const check = (name, pass=true) => { assert.ok(pass,name);report.checks.push({name,pass:true});console.log('PASS '+name); };
try {
  for(let i=0;i<150;i++) {if(launchError)throw launchError;if(processHandle.exitCode!==null)throw Error('Local engine exited: '+logs);try{await client.health();break;}catch{}await pause(100);}
  const features=await fetch(`http://127.0.0.1:${port}/experimental-features`,{method:'PATCH',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({vectorStore:true})});
  assert.ok(features.ok,await features.text());
  const wait = async task => {const result=await client.tasks.waitForTask(task.taskUid,{timeout:120000,interval:50});assert.equal(result.status,'succeeded',result.error?.message);};
  await wait(await client.createIndex('products',{primaryKey:'id'}));
  const index=client.index('products');
  await wait(await index.updateSettings({filterableAttributes:['id','shop','status','vendor','title','productType','tags','option_Color','collection_titles','createdAt','priceMin',...projection.SEARCH_FILTER_FIELDS],
    sortableAttributes:['priceMin','title','createdAt','bestSellingScore'],pagination:{maxTotalHits:100000},
    rankingRules:['sort','words','typo','proximity','attribute','exactness'],
    faceting:{maxValuesPerFacet:100000},embedders:{fixture:{source:'userProvided',dimensions:3}}}));
  const shop='fixture.myshopify.com',gid=id=>'gid://shopify/Product/'+id;
  const make=id=>({id:String(id),shop,status:'ACTIVE',title:'Formal dress '+id,vendor:id%2?'VIP':'Regular',productType:'Dress',
    tags:[id===2501?'late':'ordinary',id%5?'keep':'excluded'],priceMin:id%101,createdAt:id,inventoryTotal:id%7?5:0,
    options:[{name:'Color',values:[id%3===2?'Red':'Blue']}],option_Color:[id%3===2?'Red':'Blue'],collection_titles:['Formal'],
    variantPrices:[{id:String(id),option1:id%3===2?'Red':'Blue',available:id%7!==0,price:id%101,compareAtPrice:150,sku:'SKU-'+id,imageUrl:'variant.jpg'}],
    _vectors:{fixture:[1,id/10000,0]}});
  const docs=Array.from({length:2501},(_,i)=>make(i+1));
  docs.push({...make(9000),title:'External pinned product',option_Color:['Red'],options:[{name:'Color',values:['Red']}],
    variantPrices:[{id:'9000',option1:'Red',available:true,price:12,sku:'external',imageUrl:'external.jpg'}],priceMin:12});
  docs.push({...make(9001),shop:'foreign.myshopify.com'}, {...make(9002),status:'DRAFT'});
  docs.push({...make(9500),vendor:'Café'});
  docs.push({...make(9501),vendor:' VIP '});
  docs.push({...make(9502),inventoryTotal:-2}, {...make(9503),rating:{value:4.5}});
  await wait(await index.addDocuments(docs.map(d=>({...d,...projection.searchIndexProjection(d)}))));
  const prisma={product:{findMany:async({where})=>docs.filter(p=>p.shop===where.shop&&p.status==='ACTIVE'&&where.id.in.includes(gid(p.id)))
    .map(p=>({...p,id:gid(p.id),variants:p.variantPrices}))}};
  const merchandising=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:prisma}});
  const cache=new Map(),requests=[];
  let semanticEnabled=true;
  const batch=async(queries,mode)=>{
    const semantic=mode!==false&&semanticEnabled;
    const prepared=queries.map(q=>({...q,...(semantic?{vector:[1,0,0],hybrid:{embedder:'fixture',semanticRatio:0.5}}:{})}));
    const result=await client.multiSearch({queries:prepared});
    requests.push({queries:prepared.map(q=>({limit:q.limit,page:q.page,hitsPerPage:q.hitsPerPage})),documents:result.results.reduce((n,r)=>n+r.hits.filter(p=>p.variantPrices).length,0)});
    return {...result,semantic};
  };
  const native=await loadModule('app/services/nativeSearchPage.server.js',{
    './meiliClient.server':{default:client},'../db.server':{default:prisma},
    './shopCache.server':{getCached:async(key,read)=>{if(!cache.has(key))cache.set(key,await read());return cache.get(key);}},
    './semanticSearch.server':{searchPageBatch:batch},'../utils/searchPagePlan.js':plan,
    '../utils/searchIndexProjection.js':projection,'./merchandising.server':merchandising,'../utils/searchColor.js':color,
  });
  const base=[`shop = '${shop}'`,"status = 'ACTIVE'"];
  const pins={products:[{id:gid(9000)},{id:gid(9000)},{id:gid(9001)},{id:gid(9002)},{id:gid(99999)}]};
  const cases=[
    {name:'accent-sensitive legacy equality',rule:{conditions:[{action:'Exclude',field:'Vendor',value:'Cafe'}]}},
    {name:'late boost and explicit pins',rule:{conditions:[{action:'Boost',field:'Tags',value:'late'}]},pinningRule:pins},
    {name:'sold-out exclusions',rule:{conditions:[{action:'Exclude',field:'Available',maxValue:0}]}},
    {name:'overlapping boosts, bury and exclusion',rule:{conditions:[{action:'Boost',field:'Vendor',value:'VIP'},
      {action:'Bury',field:'Price',minValue:80},{action:'Exclude',field:'Tags',value:'excluded'}]},pinningRule:pins},
    {name:'rule Pin survives Dynamic Set and manual pins survive exclusions',rule:{conditions:[{action:'Pin',field:'Vendor',value:'VIP'},
      {action:'Dynamic',field:'Tags',value:'keep',operator:'Set',operand:'-10'}, {action:'Exclude',field:'Product',value:'External pinned product'}]},pinningRule:pins},
    {name:'discount, SKU and date rules',rule:{conditions:[{action:'Boost',field:'Discount',minValue:100},
      {action:'Pin',field:'SKU',value:'SKU-2501'},{action:'Bury',field:'Date',dateValue:'1970-01-01 - 1970-01-01'}]}},
    {name:'option phrases and aliases',rule:{conditions:[{action:'Boost',field:'Color (product option)',value:'Scarlet'}]},
      mergedValues:[{targetValue:'Scarlet',sourceValues:['Red']}]},
    {name:'Dynamic Add, Multiply and zero Divide',rule:{conditions:[{action:'Dynamic',field:'Vendor',value:'VIP',operator:'Add',operand:'50'},
      {action:'Dynamic',field:'Price',minValue:0,maxValue:50,operator:'Multiply',operand:'2'},
      {action:'Dynamic',field:'Tags',value:'keep',operator:'Divide',operand:'0'}]}},
    {name:'rating and percentage ranges',rule:{conditions:[{action:'Boost',field:'Rating',minValue:4,maxValue:5},
      {action:'Bury',field:'Percent sales',minValue:80,maxValue:100}]}},
    {name:'option Bury preserves variant image metadata',rule:{conditions:[{action:'Bury',field:'Color (product option)',value:'Red'}]}},
  ];
  const normalize=p=>({...p,id:gid(p.id),variants:p.variantPrices,collections:p.collection_titles.map(title=>({collection:{title}}))});
  for(const c of cases) {
    const scoped=(await index.search('dress',{filter:base,limit:10000,vector:[1,0,0],hybrid:{embedder:'fixture',semanticRatio:0.5}})).hits;
    const pinIds=new Set(c.pinningRule?.products.map(p=>p.id)||[]);
    let all=scoped.filter(p=>!pinIds.has(gid(p.id))).map(normalize);
    const validPins=[...pinIds].map(id=>docs.find(p=>gid(p.id)===id&&p.shop===shop&&p.status==='ACTIVE')).filter(Boolean).map(normalize);
    all.push(...validPins);all.forEach((p,i)=>p._originalIndex=i);
    const effective=c.pinningRule?{products:c.pinningRule.products.filter(p=>validPins.some(v=>v.id===p.id))}:null;
    const expected=merchandising.applyMerchandisingRules(all,c.rule,'relevance',effective,c.mergedValues||[],{preserveSearchRelevance:true});
    const combined=[];
    for(const page of [1,2,3,Math.ceil(expected.length/25)]) {
      const result=await native.rankNativeSearchPage({shop,query:'dress',options:{filter:base},...c,page,limit:25,facetKeys:['vendor','priceMin','option_Color']});
      assert.ok(result,c.name);assert.equal(result.rankingMode,'native');assert.equal(result.total,expected.length,c.name+' count');
      assert.deepEqual(Array.from(result.products,p=>p.id),Array.from(expected.slice((page-1)*25,page*25),p=>p.id),c.name+' page '+page);
      assert.deepEqual(Array.from(result.products,p=>[p.merchandisingScore,p.merchandisingImage]),
        Array.from(expected.slice((page-1)*25,page*25),p=>[p.merchandisingScore,p.merchandisingImage]),c.name+' score/image metadata');
      if(page<=3)combined.push(...result.products.map(p=>p.id));
      const vendors={};for(const p of expected)vendors[p.vendor]=(vendors[p.vendor]||0)+1;
      assert.deepEqual({...result.facetDistribution.vendor},vendors,c.name+' facets');
      assert.equal(result.facetStats.priceMin.min,Math.min(...expected.map(p=>Number(p.priceMin))));
      assert.equal(result.facetStats.priceMin.max,Math.max(...expected.map(p=>Number(p.priceMin))));
    }
    assert.equal(new Set(combined).size,combined.length);check(c.name+' counts, facets, adjacent/deep page parity');
  }
  for(const priority of [false,true]) {
    const conditions=[{action:'Boost',field:'Vendor',value:'VIP'},{action:'Exclude',field:'Available',maxValue:0}];
    const scoped=(await index.search('dress',{filter:base,limit:10000,sort:['priceMin:asc'],vector:[1,0,0],hybrid:{embedder:'fixture',semanticRatio:0.5}})).hits.map(normalize);
    scoped.forEach((p,i)=>p._originalIndex=i);
    const expected=merchandising.applyMerchandisingRules(scoped,{conditions},'price-ascending',null,[],{preserveSearchRelevance:true,prioritizeSortOverMerchandising:priority});
    const r=await native.rankNativeSearchPage({shop,query:'dress',options:{filter:base,sortBy:'price-ascending'},rule:{conditions},
      globalSettings:{prioritizeSortOverMerchandising:priority},limit:25});
    assert.deepEqual(Array.from(r.products,p=>p.id),Array.from(expected.slice(0,25),p=>p.id));check('explicit sort priority='+priority);
  }
  const intent=color.resolveSearchColor('red dress',['Red','Blue']);
  const r=await native.rankNativeSearchPage({shop,query:'dress',options:{filter:[...base,'option_Color IN ["Red"]']},
    rule:{conditions:[{action:'Exclude',field:'Available',maxValue:0}]},parsedQuery:{colorIntent:intent},globalSettings:{showOnlyInStock:true},limit:6});
  assert.equal(r.products.length,6);assert.ok(r.products.every(p=>p.variants.some(v=>v.option1==='Red'&&v.available)));
  check('same-variant color and availability constraints');
  const sentence=await native.rankNativeSearchPage({shop,query:'i am looking for red dress for wedding for the mother',
    options:{filter:[...base,'option_Color IN ["Red"]']},parsedQuery:{colorIntent:intent},
    rule:{conditions:[{action:'Exclude',field:'Available',maxValue:0}]},limit:6});
  assert.equal(sentence.products.length,6);check('natural-language query returns a native ranked page without overlapping hybrid scans');
  requests.length=0;
  await native.rankNativeSearchPage({shop,query:'dress',options:{filter:base},limit:6});
  assert.equal(requests.length,2);assert.equal(requests.reduce((n,r)=>n+r.documents,0),6);
  check('2500+ matches transfer only six product documents for a first-page request');
  semanticEnabled=false;
  const offline=await native.rankNativeSearchPage({shop,query:'dress',options:{filter:base},limit:6});
  assert.equal(offline.products.length,6);assert.equal(offline.semanticHitCount,0);check('keyword mode retains native paging without embeddings');
  console.log('NATIVE ENGINE CHECKS PASSED: '+report.checks.length);
} catch(e) {report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally {processHandle.kill();await fs.writeFile(path.join(directory,'engine.log'),logs);
  await fs.writeFile('scratch/native-search-engine-results.json',JSON.stringify(report,null,2));}
