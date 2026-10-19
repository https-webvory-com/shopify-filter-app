import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';

test('color merchandising scans scalar projections in large batches while variant reads preserve full ranking and images',async()=>{
 const ctx={module:{exports:{}},exports:{},require:()=>({__esModule:true,default:{}})};
 vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,ctx);
 const {applyMerchandisingRules:arrange,createMerchandisingComparator:comparator}=ctx.module.exports;
 const docs=Array.from({length:10025},(_,i)=>({id:String(i+1),priceMin:i===7?0:100,tags:[],options:[{name:'Color',values:['Burgundy','Blue']}],images:['fallback.jpg'],variantPrices:[{id:String(i+1)+'01',option1:i%2?'Blue':'Burgundy',available:true,price:100,imageUrl:i+'.jpg'}]}));
 const searches=[],reads=[],byId=new Map(docs.map(p=>[p.id,p]));
 const search=async(_q,options)=>{searches.push(options);return {hits:docs.slice(options.offset,options.offset+options.limit).map(p=>Object.fromEntries(options.attributesToRetrieve.filter(f=>f in p).map(f=>[f,p[f]]))),estimatedTotalHits:docs.length};};
 const index={search,getDocuments:async options=>{const ids=JSON.parse(options.filter.slice(6));reads.push(ids.length);return {results:ids.map(id=>byId.get(id)).filter(Boolean).reverse()};}};
 const spec={shop:'fixture',query:{q:'',filter:[]},sortBy:'best-selling',needsShopifyOrder:true,orderedIds:docs.map(p=>p.id).reverse(),pinnedIds:['2'],pinningRule:{products:[{id:'gid://shopify/Product/2'}]},globalSettings:{},rule:{conditions:[{field:'Color (product option)',action:'Boost',value:'Burgundy',operator:'contains'}]}};
 const baseline=await prepareCollectionRanking(structuredClone(spec),{index:{search},prisma:{},arrange});searches.length=0;
 const actual=await prepareCollectionRanking(structuredClone(spec),{index,prisma:{},arrange,comparator});
 assert.deepEqual(actual,baseline);assert.equal(actual.ids.length,docs.length);assert.equal(new Set(actual.ids).size,docs.length);
 assert.equal(searches.length,2);assert.ok(searches.every(q=>!q.attributesToRetrieve.includes('variantPrices')));
 assert.ok(reads.length>0&&reads.every(n=>n<=25));assert.equal(actual.ids.at(-1),'8');
 delete byId.get('1').variantPrices;
 byId.delete('1');index.getDocument=async()=>{throw Object.assign(Error('deleted'),{code:'document_not_found'});};
 await assert.rejects(prepareCollectionRanking(structuredClone(spec),{index,prisma:{},arrange,comparator}),/Collection changed while ranking/);
});
