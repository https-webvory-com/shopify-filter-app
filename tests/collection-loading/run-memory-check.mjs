import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
import {createCollectionFactProfile} from '../../app/utils/collectionRuleFacts.js';
await fs.mkdir('scratch',{recursive:true});
const scenario=process.argv[2]||'tags';
const useFacts=scenario==='facts';
const complex=scenario!=='tags';
const dense=scenario==='dense-variants';
const count=useFacts?80262:dense?2000:complex?22976:80262;
const variantsPerProduct=dense?2000:complex?40:0;
const context={module:{exports:{}},exports:{},console,require:()=>({__esModule:true,default:{}})};
vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,context);
let peakHeap=0;
const sample=()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);};
const index={search:async(_q,options)=>{
  const hits=[];
  for(let i=options.offset;i<Math.min(count,options.offset+options.limit);i++){
    const doc={id:String(i+1),priceMin:i===2?0:i+1,tags:['Blue','TopFormal'],inventoryTotal:5};
    if(complex&&options.attributesToRetrieve.includes('variantPrices')){doc.options=[{name:'Color',values:['Blue','Red']}];doc.images=[`https://fixture.example/product/${i}/image.jpg`];
      doc.variantPrices=Array.from({length:variantsPerProduct},(_,v)=>({id:String(i*10000+v),option1:v%2?'Blue':'Red',option2:'Size '+v,available:true,price:i+v+1,compareAtPrice:i+v+2,imageUrl:`https://fixture.example/product/${i}/variant/${v}.jpg`}));
    }
    hits.push(Object.fromEntries(options.attributesToRetrieve.filter(key=>key in doc).map(key=>[key,doc[key]])));
  }
  sample();const response={hits,estimatedTotalHits:count};return dense?JSON.parse(JSON.stringify(response)):response;
}};
index.getDocuments=async options=>{
 const ids=JSON.parse(options.filter.slice(6));assert.ok(ids.length<=25);
 const response=await index.search('',{offset:Number(ids[0])-1,limit:ids.length,attributesToRetrieve:options.fields});
 assert.deepEqual(response.hits.map(p=>p.id),ids);return {results:response.hits.reverse()};
};
const started=Date.now();
const profile=createCollectionFactProfile([{action:'Boost',field:'Color',value:'Blue'}]);
const factOptions=useFacts?{factProfile:profile,loadFacts:async products=>{for(const p of products)Object.assign(p,{cfpCollectionFactProfile:profile.id,cfpCollectionFactSource:'legacy',cfpCollectionFactMatches:[profile.conditions[0].key+':e'],cfpCollectionFactImages:{[profile.conditions[0].key]:'https://fixture.example/blue.jpg'}});sample();}}:{};
const result=await prepareCollectionRanking({shop:'memory-fixture.myshopify.com',query:{q:'',filter:[]},sortBy:'best-selling',needsShopifyOrder:true,orderedIds:Array.from({length:count},(_,i)=>String(count-i)),pinnedIds:[],mergedValues:[],globalSettings:{},rule:{conditions:[{action:'Boost',field:complex?'Color':'Tags',value:'Blue'}]}},{index,prisma:{},...factOptions,comparator:context.module.exports.createMerchandisingComparator,arrange:(...args)=>{sample();const ranked=context.module.exports.applyMerchandisingRules(...args);sample();return ranked;}});
sample();assert.equal(result.ids.length,count);assert.equal(new Set(result.ids).size,count);assert.equal(result.ids.at(-1),'3');
const report={runtime:process.version,scenario,fixtureProducts:count,variantsPerProduct,elapsedMs:Date.now()-started,observedHeapMb:Math.round(peakHeap/1048576),maxRssMb:Math.round(process.resourceUsage().maxRSS/1024),heapLimitMb:256};
await fs.writeFile(`scratch/collection-memory-${scenario}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
