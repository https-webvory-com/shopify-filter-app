import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=(await fs.readFile('app/routes/api.filter.jsx','utf8')).replace(/\r\n/g,'\n');
const block=source.slice(source.indexOf('function provisionalKey('),source.indexOf('\nfunction directSortExclusions'))+'\n'+
  source.slice(source.indexOf('function directSortExclusions'),source.indexOf('\n}\n',source.indexOf('function directSortExclusions'))+3);
function load(){const context={getCached:async(_key,read)=>read(),JSON,Math,String,Array,Set,Number};vm.runInNewContext(block+';this.page=provisionalCollectionPage;this.key=provisionalKey;',context);return context;}

test('pending collections give direct callers a best-selling first page with exclusions applied',async()=>{
 const {page}=load();let request;
 const index={search:async(_q,options)=>{request=JSON.parse(JSON.stringify(options));return {hits:[{id:'1',title:'A',images:['a','b']}],estimatedTotalHits:40};}};
 const result=await page(index,{filters:['shop = "x"','available = true'],rule:{conditions:[{action:'Exclude',field:'Id',value:'99'}]},pinnedIds:[],limit:25,cacheKey:'k'});
 assert.equal(result.totalCount,40);assert.deepEqual(JSON.parse(JSON.stringify(result.products[0].images)),['a']);
 assert.deepEqual(request.sort,['bestSellingScore:desc','createdAt:desc']);
 assert.ok(request.filter.includes('available = true'));
 assert.ok(request.filter.some(f=>/99/.test(f)));
 assert.ok(!request.attributesToRetrieve.some(field=>/score|merch/i.test(field)));
});

test('rules that cannot be expressed as index filters return no provisional page',async()=>{
 const {page}=load();const index={search:async()=>{throw Error('should not search');}};
 assert.equal(await page(index,{filters:[],rule:{conditions:[{action:'Exclude',field:'Id',value:{bad:true}}]},pinnedIds:[],limit:25,cacheKey:'k'}),null);
});

test('engine errors fall back to the previous empty pending response',async()=>{
 const {page}=load();assert.equal(await page({search:async()=>{throw Error('down');}},{filters:[],rule:null,pinnedIds:[],limit:25,cacheKey:'k'}),null);
});

test('cache keys differ for different filter states',()=>{
 const {key}=load();assert.notEqual(key('["a"]'),key('["b"]'));
});
