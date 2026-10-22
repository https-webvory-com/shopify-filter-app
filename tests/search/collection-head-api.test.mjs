import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingServer} from '../collection-loading/server.mjs';
async function fixture(){
 const f=await createLoadingServer();await new Promise(resolve=>f.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+f.server.address().port;
 const control=async value=>(await fetch(origin+'/__control',{method:'POST',body:JSON.stringify(value)})).json();
 const get=async(extra,accept='application/x-cfp-pinned-prefix-v3, application/json')=>{const p=new URLSearchParams({shop:'headless-fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'fixture',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1',...extra});const response=await fetch(origin+'/api/filter?'+p,{headers:{Accept:accept}});return {status:response.status,header:response.headers.get('X-CFP-Collection-Cards'),data:await response.json()};};
 return {...f,control,get,state:async()=>(await fetch(origin+'/__state')).json()};
}

test('two public filters use exact direct preparation with a paused worker and remain outside public card snapshots',async()=>{
 const f=await fixture();try{
  await f.control({reset:true,hold:true,productCount:30,directFacts:true});
  const filters={responseProfile:'collection-v1','options[Color][]':'Blue','vendor[]':'Fixture'};
  const result=await f.get(filters);assert.equal(result.status,200);assert.equal(result.data.products.length,25);assert.equal(result.data.debug.collectionRankingStatus,'ready');
  assert.ok(result.data.rankingToken);assert.equal(result.data.cfpCards,undefined);assert.equal((await f.state()).state.builds,0);
  const second=await f.get({...filters,page:'2',rankingToken:result.data.rankingToken});assert.equal(second.status,200);
  assert.equal(new Set([...result.data.products,...second.data.products].map(p=>p.id)).size,30);
 }finally{f.dispose();}
});

test('pinned cards default to the original first variant across prefix, canonical, saved and published paths',async()=>{
 const f=await fixture();try{
  const variants=id=>[{id:String(id*100),option1:'Green',available:false,imageUrl:'/image/green.svg',price:10},{id:String(id*100+1),option1:'Blue',available:true,imageUrl:'/image/blue.svg',price:10}];
  await f.control({reset:true,hold:true,productCount:30,colorRule:true,pinList:['1'],cardSnapshots:true,productVariants:{'1':variants(1),'30':variants(30)}});
  const assertFirst=p=>{assert.equal(p.selectedVariantId,'100');assert.equal(p.variants[0].option1,'Green');assert.equal(p.variants[0].available,false);assert.equal(p.variants[0].imageUrl,'/image/green.svg');assert.equal(p.pinnedProductImage,'/image/1.svg');assert.equal(p.images[0],'/image/1.svg');assert.equal(p.merchandisingImage,'/image/1.svg');};
  const head=await f.get();assert.equal(head.header,'prefix');assertFirst(head.data.products[0]);
  await f.control({precompute:true});
  const full=await f.get({responseProfile:'collection-v1'});assertFirst(full.data.products[0]);
  assert.equal(full.data.products.find(p=>p.id.endsWith('/30')).selectedVariantId,'3001');
  const saved=await f.get();assert.equal(saved.header,'hit');assertFirst(saved.data.products[0]);
  await f.control({publishedPages:true,publishFirst50:true});
  const published=await f.get({},'application/x-cfp-published-page-v1, application/x-cfp-pinned-prefix-v3, application/json');assert.equal(published.header,'published');assertFirst(published.data.products[0]);
  const filters={responseProfile:'collection-v1','options[Color][]':'Blue'};
  await f.get(filters);await f.prepareLast();const filtered=await f.get(filters);
  assert.equal(filtered.status,200);assert.equal(filtered.data.products.find(p=>p.id.endsWith('/1')).selectedVariantId,'101');
  assert.equal(filtered.data.products.find(p=>p.id.endsWith('/1')).pinnedProductImage,undefined);
 }finally{f.dispose();}
});
test('a cold prefix bypasses a paused ranking backlog and hands off to complete canonical pagination without gaps',async()=>{
 const f=await fixture();try{
  await f.control({reset:true,hold:true,pinList:['1','2','4','5','6','7'],imageDelay:0,priceDelay:0});
  const head=await f.get();assert.equal(head.status,200);assert.equal(head.header,'prefix');assert.equal(head.data.cfpCards.prefix,true);assert.equal(head.data.totalCount,null);assert.equal(head.data.rankingToken,null);assert.equal(head.data.debug.collectionRankingStatus,'prefix-ready');
  const ids=head.data.products.map(p=>p.id);assert.deepEqual(ids,['1','2','4','5','6','7'].map(id=>'gid://shopify/Product/'+id));
  const before=await f.state();assert.equal(before.state.builds,0);assert.ok(before.headEvents.some(e=>e.event==='head-proven'));
  assert.equal((await f.get({responseProfile:'collection-v1'})).status,202);
  await f.control({precompute:true});const full=await f.get({responseProfile:'collection-v1'});assert.equal(full.status,200);assert.ok(full.data.rankingToken);
  assert.deepEqual(full.data.products.slice(0,ids.length).map(p=>p.id),ids);
  const page2=await f.get({responseProfile:'collection-v1',page:'2',rankingToken:full.data.rankingToken});assert.equal(page2.status,200);
  const all=[...full.data.products,...page2.data.products].map(p=>p.id);assert.equal(all.length,30);assert.equal(new Set(all).size,30);
  assert.ok((await f.state()).headEvents.some(e=>e.event==='head-comparison-match'));
 }finally{f.dispose();}
});
test('invalid leading pins are skipped identically, while a free leading pin declines instead of guessing replacements',async()=>{
 const f=await fixture();try{
  await f.control({reset:true,hold:true,pinList:['1','2','4','5','6','7','8','9','10','11','12']});
  for(const id of ['1','2','4','5','6','7'])await f.control({archive:id});
  const head=await f.get();assert.equal(head.status,200);assert.deepEqual(head.data.products.map(p=>p.id),['8','9','10','11','12'].map(id=>'gid://shopify/Product/'+id));
  await f.control({reset:true,hold:true,pinList:['1','3','4','5','6','7']});
  const free=await f.get();assert.equal(free.status,202);assert.equal(free.data.products.length,0);
  assert.ok((await f.state()).headEvents.some(e=>e.event==='head-declined'));
 }finally{f.dispose();}
});

test('old clients and q=0 cannot receive an unsupported partial prefix',async()=>{
 const f=await fixture();try{
  await f.control({reset:true,hold:true,pinList:['1','2','4','5','6','7']});
  for(const accept of ['application/json','application/x-cfp-pinned-prefix-v1, application/json','application/x-cfp-pinned-prefix-v2, application/json','application/x-cfp-pinned-prefix-v3;q=0, application/json']){
   const response=await f.get({},accept);assert.equal(response.status,202);assert.equal(response.data.products.length,0);
  }
  assert.equal((await f.get()).header,'prefix');
 }finally{f.dispose();}
});

test('a proven pin head does not depend on a native-order build or a working full-ranking queue',async()=>{
 const f=await fixture();try{
  for(const scenario of [{orderMissing:true},{rankingFailure:'failed'},{rankingFailure:'throw'}]){
   await f.control({reset:true,hold:true,pinList:['1','2','4','5','6','7'],...scenario});
   const head=await f.get();assert.equal(head.status,200,JSON.stringify(scenario));assert.equal(head.header,'prefix');assert.equal(head.data.products.length,6);assert.equal(head.data.debug.collectionBestSellingStatus,'prefix-ready');
   assert.equal((await f.state()).state.builds,0);
  }
 }finally{f.dispose();}
});

test('forty pins keep a complete 25-card first page and the remaining fifteen lead page two',async()=>{
 const f=await fixture();try{
  const pins=Array.from({length:41},(_,i)=>String(i+1)).filter(id=>id!=='3');
  await f.control({reset:true,hold:true,productCount:70,pinList:pins,cardSnapshots:true});
  const head=await f.get();assert.equal(head.status,200);assert.equal(head.data.products.length,25);
  assert.equal(head.data.cfpCards.preview,false);assert.ok(head.data.products.every(p=>Array.isArray(p.variants)&&p.variants.length&&p.priceMin!=null));
  assert.deepEqual(head.data.products.map(p=>p.id),pins.slice(0,25).map(id=>'gid://shopify/Product/'+id));
  assert.equal((await f.state()).state.builds,0);
  await f.control({precompute:true});const full=await f.get({responseProfile:'collection-v1'});
  const second=await f.get({responseProfile:'collection-v1',page:'2',rankingToken:full.data.rankingToken});
  assert.deepEqual(full.data.products.map(p=>p.id),head.data.products.map(p=>p.id));
  assert.deepEqual(second.data.products.slice(0,15).map(p=>p.id),pins.slice(25).map(id=>'gid://shopify/Product/'+id));
  assert.equal(new Set([...full.data.products,...second.data.products].map(p=>p.id)).size,50);
  const legacy=await f.get({},'application/json');assert.equal(legacy.data.products.length,25);
  const warm=await f.get();assert.equal(warm.data.products.length,25);assert.equal(warm.data.cfpCards.preview,false);
 }finally{f.dispose();}
});
