// Disposable loopback database only. Never reads DATABASE_URL or merchant data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import {spawnSync,spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {savedVariantPricePage,savedVariantPriceSelections} from '../../app/utils/availableVariants.js';
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
 sql('CREATE TABLE "Product" (id text PRIMARY KEY, shop text NOT NULL, status text NOT NULL, options jsonb); CREATE TABLE "Variant" (id text PRIMARY KEY, "productId" text REFERENCES "Product"(id), available boolean, price numeric, option1 text, option2 text, option3 text, "compareAtPrice" numeric, "marketPrices" jsonb, sku text, "imageUrl" text); CREATE INDEX ON "Variant" ("productId",available); CREATE TABLE "ProductCollection" ("productId" text REFERENCES "Product"(id), "collectionId" text, PRIMARY KEY ("productId","collectionId"));');

 sql('CREATE INDEX ON "Product" (shop,status);');
 sql(`INSERT INTO "Product" (id,shop,status,options)
 SELECT 'gid://shopify/Product/'||n,'headless-fixture.myshopify.com','ACTIVE','[{"name":"Color"},{"name":"Size"}]'::jsonb FROM generate_series(1,15000) n;
 INSERT INTO "ProductCollection" ("productId","collectionId") SELECT id,'gid://shopify/Collection/1' FROM "Product";
 INSERT INTO "Variant" (id,"productId",available,price,option1,option2,"compareAtPrice",sku)
 SELECT 'gid://shopify/ProductVariant/'||(n*100+k),'gid://shopify/Product/'||n,k<10,
 CASE WHEN n=1 AND k=10 THEN 9000 WHEN n=1 AND k=2 THEN 3410 WHEN n=1 THEN 3190 WHEN n=2 THEN 3202 ELSE 10+(n%200)*10+k END,
 CASE WHEN k=10 THEN 'Red' ELSE 'Blue' END,CASE WHEN k=2 THEN 'L' ELSE 'S' END,10000,'sku-'||n||'-'||k
 FROM generate_series(1,15000) n CROSS JOIN generate_series(1,10) k;
 UPDATE "Variant" SET "marketPrices"=jsonb_build_object('US',jsonb_build_object('price',price,'currency','USD'),'IN',jsonb_build_object('price',price*100,'currency','INR','compareAtPrice',1000000));
 INSERT INTO "Product" (id,shop,status,options) VALUES ('gid://shopify/Product/99999','other.myshopify.com','ACTIVE','[]');
 INSERT INTO "Variant" (id,"productId",available,price) VALUES ('gid://shopify/ProductVariant/99999','gid://shopify/Product/99999',true,1000000);
 ANALYZE;`);
 const ids=[...Array.from({length:15000},(_,i)=>String(i+1)),'99999'];
 const context={country:'US',currency:'USD',basePrice:true,stockOnly:true,direction:'desc',options:{},mergedValues:[],ranges:[]};
 const reports=[];
 const read=async(extra={},page=1)=>{const t=performance.now();const value=await savedVariantPricePage(database,{shop:'headless-fixture.myshopify.com',ids,context:{...context,...extra},page,limit:25});reports.push({country:extra.country||'US',direction:extra.direction||'desc',ranges:extra.ranges||[],options:extra.options||{},page,ms:Math.round(performance.now()-t),total:value.total});return value;};
 const high=await read();assert.equal(high.total,15000);assert.equal(high.rows[0].id,'1');assert.equal(high.rows[0].selection.price,3410);assert.equal(high.rows[0].variants.length,10);
 const low=await read({direction:'asc'});assert.equal(low.rows[0].selection.price,11);
 const band=await read({ranges:[{min:3000,max:3300}]});assert.deepEqual(band.rows.map(r=>r.id),['2','1']);assert.equal(band.rows[1].selection.price,3190);
 const options=await read({ranges:[{min:3000,max:3300}],options:{Color:['Navy'],Size:['L']},mergedValues:[{optionName:'Color',targetValue:'Navy',sourceValues:['Blue']}]});assert.deepEqual(options.rows.map(r=>r.id),['2']);
 const india=await read({basePrice:false,country:'IN',currency:'INR',ranges:[{min:300000,max:330000}]});assert.deepEqual(india.rows.map(r=>r.id),['2','1']);assert.equal(india.rows[1].selection.price,319000);
 const page2=await read({},2);assert.equal(page2.total,15000);assert.equal(new Set([...high.rows,...page2.rows].map(r=>r.id)).size,50);
 const end=await read({},1000);assert.equal(end.total,15000);assert.equal(end.rows.length,0);
 const sold=await read({stockOnly:false});assert.equal(sold.rows[0].selection.price,9000);
 await database.$executeRaw`UPDATE "Variant" SET price=3600 WHERE id='gid://shopify/ProductVariant/102'`;
 assert.equal((await read()).rows[0].selection.price,3600);
 const compactStart=performance.now(),compact=await savedVariantPriceSelections(database,{shop:'headless-fixture.myshopify.com',ids,context}),compactMs=Math.round(performance.now()-compactStart);
 assert.equal(compact.size,15000);assert.equal(compact.get('1').price,3600);assert.ok(compactMs<2000,'Compact merchandising price read exceeded two seconds: '+compactMs);
 const nativeCompactStart=performance.now(),nativeCompact=await savedVariantPriceSelections(database,{shop:'headless-fixture.myshopify.com',ids,context:{...context,country:'IN',basePrice:false}}),nativeCompactMs=Math.round(performance.now()-nativeCompactStart);
 assert.equal(nativeCompact.size,15000);assert.equal(nativeCompact.get('1').price,341000);assert.ok(nativeCompactMs<2000,'Native compact price read exceeded two seconds: '+nativeCompactMs);
 // Exercise the real public route and renderer against these saved SQL rows.
 const {createLoadingServer}=await import('./server.mjs');
 const cli=fs.readFileSync('../../scratch/rea-evaluation/cli-path.txt','utf8').trim();
 const {chromium}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../../playwright-core/index.mjs')).href);
 const databaseReads=[];
 const fixture=await createLoadingServer({database,savedPricePage:async args=>{const started=performance.now();const result=await savedVariantPricePage(database,args);databaseReads.push({direction:args.context.direction,ms:Math.round(performance.now()-started)});return result;}});
 await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+fixture.server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 let browserProof;
 try{
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,country:'IN',variantPriceSort:true,realToolbar:true,productCount:15000,noPins:true,noMerchandising:true,apiDelay:100,priceDelay:1000,imageDelay:0,marketPriceReady:true,globalSettings:{showOnlyInStock:true,prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}})});
  const page=await browser.newPage();page.setDefaultTimeout(20000);
  const ready=()=>page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card:not(.cfp-skeleton-card)').length===25&&!document.querySelector('#cfp-sidebar.cfp-loading')&&!document.querySelector('#cfp-products-container.cfp-loading-retained'));
  const started=performance.now();await page.goto(origin+'/collections/fixture?sort_by=price-descending',{waitUntil:'commit'});await ready();
  const collectionMs=Math.round(performance.now()-started);
  const first=await page.locator('.cfp-product-card:not(.cfp-skeleton-card)').first().evaluate(card=>({id:card.dataset.cfpProductId,price:card.querySelector('.cfp-product-card__price').textContent,variant:new URL(card.querySelector('a').href).searchParams.get('variant')}));
  assert.equal(first.id,'gid://shopify/Product/1');assert.equal(first.variant,'102');assert.match(first.price,/341,000/);
  const sortStart=performance.now();await page.locator('.cfp-custom-sort__option[data-value="price-ascending"]').evaluate(e=>e.click());
  await page.waitForFunction(()=>document.querySelector('.cfp-product-card:not(.cfp-skeleton-card)')?.dataset.cfpProductId==='gid://shopify/Product/1000');await ready();
  const sortMs=Math.round(performance.now()-sortStart);
  const perProductReads=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/products\/[^/]+\.js/.test(new URL(r.name).pathname)).length);
  const state=await(await fetch(origin+'/__state')).json();console.log(JSON.stringify({reports,collectionMs,sortMs,databaseReads,requests:state.requests}));assert.equal(state.state.builds,0);assert.equal(perProductReads,0);assert.ok(sortMs<2000,'Real SQL + storefront sorting exceeded two seconds: '+sortMs);
  const requests=[];
  for(const country of ['US','IN'])for(const sortBy of ['price-ascending','price-descending']){
   const query=new URLSearchParams({shop:'headless-fixture.myshopify.com',locale:'en',country,collectionHandle:'fixture',sortBy,page:'2',limit:'25',priceSortVersion:'2',priceSortRate:'1',responseProfile:'collection-v1'});
   const start=performance.now(),response=await fetch(origin+'/api/filter?'+query),value=await response.json(),ms=Math.round(performance.now()-start);
   assert.equal(response.status,200);assert.equal(value.products.length,25);assert.equal(value.totalCount,15000);assert.ok(ms<2000,'Cold saved-data HTTP page exceeded two seconds: '+JSON.stringify({country,sortBy,ms}));
   const prices=value.products.map(p=>p.priceSortSelection.price);assert.deepEqual(prices,[...prices].sort((a,b)=>(a-b)*(sortBy==='price-ascending'?1:-1)));
   requests.push({country,sortBy,ms});
  }
  const query=new URLSearchParams({shop:'headless-fixture.myshopify.com',locale:'en',country:'IN',collectionHandle:'fixture',sortBy:'price-descending',page:'1',limit:'25',priceSortVersion:'2',priceSortRate:'1',minPrice:'300000',maxPrice:'330000',responseProfile:'collection-v1'});
  const filterStart=performance.now(),filteredResponse=await fetch(origin+'/api/filter?'+query),filtered=await filteredResponse.json(),filterMs=Math.round(performance.now()-filterStart);
  assert.equal(filteredResponse.status,200,JSON.stringify(filtered));assert.deepEqual(filtered.products.map(p=>p.id),['gid://shopify/Product/2','gid://shopify/Product/1']);assert.equal(filtered.products[1].priceSortSelection.price,319000);assert.ok(filterMs<2000,'Native price-band request exceeded two seconds: '+filterMs);
  browserProof={passed:true,synthetic:true,realSql:true,realRoute:true,products:15000,variants:150000,collectionMs,sortMs,first,perProductReads,rankingBuilds:state.state.builds,requests,filterMs};
 }finally{await browser.close();fixture.dispose();}
 assert.ok(reports.every(r=>r.ms<2000),'A scoped saved-data SQL read exceeded two seconds: '+JSON.stringify(reports));
 fs.writeFileSync('scratch/sobooster-sql-local-proof-20261118.json',JSON.stringify({passed:true,synthetic:true,products:15000,variants:150000,source:'disposable loopback database only',reports,browserProof,compactMs,nativeCompactMs},null,2));
 console.log('SAVED VARIANT SORT SQL PASS '+JSON.stringify(reports));
}finally{await database?.$disconnect();if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);console.log('Disposable PostgreSQL stopped.');}
