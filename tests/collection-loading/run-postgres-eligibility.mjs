// Disposable loopback database only. Never reads DATABASE_URL or merchant data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync,spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {availableProductIds,matchingAvailableVariants} from '../../app/utils/availableVariants.js';
import {availableOptionFacetCounts} from '../../app/utils/availableOptionFacetCounts.js';
import {skuSearchWhere} from '../../app/utils/skuSearch.js';
const bin=process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/18/bin';
const directory=fs.mkdtempSync(path.resolve('scratch','eligibility-postgres-')),data=path.join(directory,'data');
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const executable=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
function run(name,args){
 const descriptor=name==='pg_ctl'?fs.openSync(path.join(directory,'control.log'),'a'):null;
 let result;try{result=spawnSync(executable(name),args,{windowsHide:true,encoding:'utf8',timeout:30000,...(descriptor==null?{}:{stdio:['ignore',descriptor,descriptor]})});}finally{if(descriptor!=null)fs.closeSync(descriptor);}
 if(result.status!==0)throw Error(name+' failed: '+(result.error?.message||'')+(result.stdout||'')+(result.stderr||'')+(descriptor==null?'':fs.readFileSync(path.join(directory,'control.log'),'utf8')));return result.stdout;
}
const sql=statement=>run('psql',['-h','127.0.0.1','-p',String(port),'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement]);
let started=false,database;
try{
 run('initdb',['-D',data,'-U','fixture','--auth=trust','--encoding=UTF8','--locale=C']);
 try{run('pg_ctl',['-D',data,'-l',path.join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','start']);}
 catch(error){
  if(!error.message.includes('could not create restricted token'))throw error;
  const descriptor=fs.openSync(path.join(directory,'server.log'),'a'),child=spawn(executable('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-F'],{windowsHide:true,detached:true,stdio:['ignore',descriptor,descriptor]});child.unref();fs.closeSync(descriptor);
  let ready=false;for(let i=0;i<50;i++){try{sql('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}if(!ready)throw Error('Disposable database did not start');
 }
 started=true;database=new PrismaClient({datasources:{db:{url:`postgresql://fixture@127.0.0.1:${port}/postgres`}}});
 sql('CREATE TABLE "Product" (id text PRIMARY KEY, shop text NOT NULL, status text NOT NULL, options jsonb); CREATE TABLE "Variant" (id text PRIMARY KEY, "productId" text REFERENCES "Product"(id), available boolean, price numeric, option1 text, option2 text, option3 text); CREATE INDEX ON "Variant" ("productId",available); CREATE TABLE "ProductCollection" ("productId" text REFERENCES "Product"(id), "collectionId" text, PRIMARY KEY ("productId","collectionId"));');
 const optionNames=[{name:'Color'},{name:'Size'}],v=(option1,option2,available=true,price=10)=>({option1,option2,option3:null,available,price});
 const products=[
  {id:'1',options:optionNames,variants:[v('Black','2XL',false),v('Blue','2XL')]},
  {id:'2',options:optionNames,variants:[v(' Black ',' 2XL ',true,500.25)]},
  {id:'3',options:optionNames,variants:[v('Black','L'),v('Red','2XL')]},
  {id:'4',options:[{name:'Size'},{name:'Color'}],variants:[v('2XL','Navy')]},
  {id:'5',options:optionNames,variants:[v('\tBlack\u00a0','2XL')]},
  {id:'6',options:optionNames,variants:[v(null,'2XL')]},
  {id:'7',options:optionNames,variants:[v("O'Reilly",'2XL')]},
  {id:'8',options:optionNames,variants:[v('Black','2XL')],shop:'other'},
  {id:'9',options:optionNames,variants:[v('Black','2XL')],status:'archived'},
  {id:'10',options:optionNames,variants:[v('Black','2XL')],collection:'other'},
 ];
 for(const p of products){
  await database.$executeRaw`INSERT INTO "Product" (id,shop,status,options) VALUES (${p.id},${p.shop||'fixture'},${p.status||'ACTIVE'},${JSON.stringify(p.options)}::jsonb)`;
  await database.$executeRaw`INSERT INTO "ProductCollection" ("productId","collectionId") VALUES (${p.id},${p.collection||'one'})`;
  for(const [i,r]of p.variants.entries())await database.$executeRaw`INSERT INTO "Variant" (id,"productId",available,price,option1,option2,option3) VALUES (${p.id+'-'+i},${p.id},${r.available},${r.price},${r.option1},${r.option2},${r.option3})`;
 }
 const where={shop:'fixture',status:{equals:'active',mode:'insensitive'},collections:{some:{collectionId:'one'}}};
 const model={findMany:()=>{throw Error('SQL path unexpectedly fell back to transferring variants');}};
 const cases=[
  [{Color:['Black'],Size:['2XL']},[],null],
  [{Color:['Black'],Size:['2XL']},[],{min:400,max:600}],
  [{Color:['Black'],Size:['2XL']},[],{min:10,max:Infinity}],
  [{Color:['Blue'],Size:['2XL']},[{optionName:'color',targetValue:'Blue',sourceValues:['Navy']}],null],
  [{Color:[''],Size:['2XL']},[],null],
  [{Color:["O'Reilly"],Size:['2XL']},[],null],
  [{},[],null],
 ];
 for(const [filters,merged,range]of cases){
  const expected=products.filter(p=>(p.shop||'fixture')==='fixture'&&(p.status||'active').toLowerCase()==='active'&&(p.collection||'one')==='one'&&matchingAvailableVariants(p,filters,merged,range).length).map(p=>p.id).sort();
  const actual=await availableProductIds(model,where,filters,merged,range,{database});assert.deepEqual(actual,expected);
  console.log('PASS exact SQL availability '+JSON.stringify({filters,range,ids:actual}));
 }
 let queries=0;const wrapped={$queryRaw:query=>{queries++;return database.$queryRaw(query);}};
 let fallback=0;const unknown={findMany:async()=>{fallback++;return [];}};
 await availableProductIds(unknown,{...where,vendor:'private-scope'},{},[],null,{database:wrapped});assert.equal(queries,0);assert.equal(fallback,1);
 console.log('PASS unknown predicates preserve the existing scoped path');
 const gid=id=>`gid://shopify/Product/${id}`;
 for(const [id,tenant,variants] of [
  [101,'fixture',[v('Black','2XL',false),v('Blue','2XL')]],
  [102,'fixture',[v(' Black ','2XL'),v('Black','L')]],
  [103,'fixture',[v('Navy','2XL'),v('Black','L')]],
  [104,'other',[v('Black','2XL')]],
 ]){
  await database.$executeRaw`INSERT INTO "Product" (id,shop,status,options) VALUES (${gid(id)},${tenant},'ACTIVE',${JSON.stringify(optionNames)}::jsonb)`;
  for(const [index,variant]of variants.entries())await database.$executeRaw`INSERT INTO "Variant" (id,"productId",available,price,option1,option2,option3) VALUES (${`${id}-${index}`},${gid(id)},${variant.available},${variant.price},${variant.option1},${variant.option2},${variant.option3})`;
 }
 const exactCounts=await availableOptionFacetCounts(database,{shop:'fixture',productIds:['101','102','103','104'],
  optionValues:{Color:['Black','Blue','Navy'],Size:['2XL','L']},
  mergedValues:[{filterType:'Color',targetValue:'Blue',sourceValues:['Navy']}]});
 assert.deepEqual(exactCounts,{Color:{Black:2,Blue:2},Size:{'2XL':3,L:2}});
 console.log('PASS available option counts exclude sold-out values, other shops and duplicate variants');
 sql('ALTER TABLE "Variant" ADD COLUMN sku text;');
 const skuRows=[['sku-1','1517-Fuchsia-4','fixture','ACTIVE'],['sku-2','15170-Fuchsia-4','fixture','ACTIVE'],['sku-3','11517-Fuchsia-4','fixture','ACTIVE'],['sku-4','1517-Fuchsia-4','other','ACTIVE'],['sku-5','1517-Fuchsia-4','fixture','ARCHIVED'],['sku-6','1517_Fuchsia_4','fixture','ACTIVE'],['sku-7','AB_1517-Fuchsia-4','fixture','ACTIVE'],['sku-8','ABX1517-Fuchsia-4','fixture','ACTIVE']];
 for(const [id,sku,shop,status]of skuRows){
  await database.$executeRaw`INSERT INTO "Product" (id,shop,status,options) VALUES (${id},${shop},${status},'[]'::jsonb)`;
  await database.$executeRaw`INSERT INTO "Variant" (id,"productId",available,price,sku) VALUES (${id},${id},true,100,${sku})`;
 }
 for(const [query,expected]of [['1517',['sku-1','sku-6']],['1517-fuchsia-4',['sku-1']],['AB_1517',['sku-7']],['999999',[]]]){
  const rows=await database.product.findMany({where:skuSearchWhere('fixture',query),select:{id:true},orderBy:{id:'asc'}});
  assert.deepEqual(rows.map(row=>row.id),expected);console.log('PASS literal SKU/model prefix '+query);
 }
 if(process.argv.includes('--benchmark')){
  sql(`INSERT INTO "Product" (id,shop,status,options) SELECT 'bulk-'||n,'fixture','ACTIVE','[{"name":"Color"},{"name":"Size"}]'::jsonb FROM generate_series(1,10000) n;
   INSERT INTO "ProductCollection" ("productId","collectionId") SELECT id,'bulk' FROM "Product" WHERE id LIKE 'bulk-%';
   INSERT INTO "Variant" (id,"productId",available,price,option1,option2) SELECT p.id||'-'||n,p.id,true,10,CASE WHEN n%2=0 THEN 'Black' ELSE 'Red' END,CASE WHEN n%3=0 THEN '2XL' ELSE 'L' END FROM "Product" p CROSS JOIN generate_series(1,24) n WHERE p.id LIKE 'bulk-%'; ANALYZE;`);
  const scope={...where,collections:{some:{collectionId:'bulk'}}},filters={Color:['Black'],Size:['2XL']};
  const first=performance.now(),baseline=await availableProductIds(database.product,scope,filters,[]),baselineMs=Math.round(performance.now()-first);
  const second=performance.now(),optimized=await availableProductIds(model,scope,filters,[],null,{database}),optimizedMs=Math.round(performance.now()-second);
  assert.deepEqual(optimized,baseline);assert.equal(optimized.length,10000);
  console.log('LOCAL FIXTURE BENCHMARK '+JSON.stringify({products:10000,variants:240000,baselineMs,optimizedMs,identicalIds:true,liveTiming:false}));
  const facetStart=performance.now(),facets=await availableOptionFacetCounts(database,{shop:'fixture',productIds:Array.from({length:10000},(_,i)=>`bulk-${i+1}`),optionValues:{Color:['Black','Red'],Size:['L','2XL']}});
  assert.deepEqual(facets,{Color:{Black:10000,Red:10000},Size:{L:10000,'2XL':10000}});
  console.log('LOCAL OPTION FACET BENCHMARK '+JSON.stringify({products:10000,variants:240000,facetMs:Math.round(performance.now()-facetStart),liveTiming:false}));
 }
 console.log('POSTGRES ELIGIBILITY CHECKS PASSED: 7');
}finally{await database?.$disconnect();if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);console.log('Disposable PostgreSQL stopped.');}
