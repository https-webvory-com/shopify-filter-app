import {readExtraProductFacts,matchesExtra} from '../../app/utils/extraProductFilters.js';
// Disposable loopback database only. Never reads DATABASE_URL or merchant data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync,spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {readProductSalePercentages,saleIdsFilter} from '../../app/utils/percentSaleFilter.js';
const bin=process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/18/bin';
const directory=fs.mkdtempSync(path.resolve('scratch','percent-sale-postgres-')),data=path.join(directory,'data');
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
 sql(`CREATE TABLE "Product" (id text PRIMARY KEY, shop text NOT NULL, status text NOT NULL);
 CREATE TABLE "Variant" (id text PRIMARY KEY, "productId" text REFERENCES "Product"(id), price numeric, "compareAtPrice" numeric);
 INSERT INTO "Product" VALUES ('1','fixture','ACTIVE'),('2','fixture','ACTIVE'),('3','fixture','ACTIVE'),('4','fixture','ACTIVE'),('5','fixture','ACTIVE'),('6','fixture','DRAFT'),('7','other','ACTIVE');
 INSERT INTO "Variant" VALUES ('a','1',75,100),('b','1',50,100),('c','2',100,null),('d','3',100,80),('e','4',0,0),('f','6',10,100),('g','7',10,100);`);
 const rows=await readProductSalePercentages(database,'fixture');
 const scores=Object.fromEntries(rows.map(row=>[row.id,row.percent]));
 assert.deepEqual(scores,{'1':50,'2':0,'3':0,'4':0,'5':0});
 assert.equal(saleIdsFilter(rows,[{min:50,max:50}]),'id IN ["1"]');
 assert.equal(saleIdsFilter(rows,[{min:51,max:100}]),'id = "__no_sale_match__"');
 sql(`ALTER TABLE "Variant" ADD COLUMN inventory integer DEFAULT 0, ADD COLUMN available boolean DEFAULT false;
 CREATE TABLE "ProductMetafield" (id text PRIMARY KEY, "productId" text, namespace text, key text, value text);
 UPDATE "Variant" SET available=true,inventory=-1 WHERE id='a';UPDATE "Variant" SET available=true,inventory=3 WHERE id='b';
 INSERT INTO "ProductMetafield" VALUES ('rating','1','reviews','rating','{"value":"4.5","scale_max":"5"}'),('facts','1','__cfp_internal','filter_facts','{"weights":[100,500],"locations":[{"id":"loc","label":"Main"}]}');`);
 const extra=await readExtraProductFacts(database,'fixture');const first=extra.find(row=>row.id==='1');
 assert.equal(first.rating,4.5);assert.deepEqual(first.weights,[100,500]);assert.equal(first.onhand,true);assert.equal(first.preorder,true);assert.equal(extra.find(row=>row.id==='5').available,false);
 assert.equal(matchesExtra(first,'inventory_locations','loc'),true);assert.equal(matchesExtra(first,'weight',{min:400,max:600}),true);
 console.log('PASS PostgreSQL stock, weight, rating and location facts.');
 console.log('PASS PostgreSQL: highest variant markdown, no compare-at, compare-at below price, zero prices, no variants, tenant/status scope, inclusive bounds and no matches.');
}finally{await database?.$disconnect();if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);console.log('Disposable PostgreSQL stopped.');}
