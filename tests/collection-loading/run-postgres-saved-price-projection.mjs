// Disposable loopback database only; no environment database URL is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {hydrateSavedMarketPrices} from '../../app/utils/savedMarketPricing.js';
const bin=process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/18/bin';
const directory=fs.mkdtempSync(path.resolve('scratch','saved-price-projection-postgres-')),data=path.join(directory,'data');
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const run=(name,args)=>{const result=spawnSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{encoding:'utf8',windowsHide:true,timeout:30000});if(result.status!==0)throw Error(name+' failed: '+result.stderr);return result;};
let started=false,database;
try{
 run('initdb',['-D',data,'-U','fixture','-A','trust','--no-locale']);
 run('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);started=true;
 database=new PrismaClient({datasources:{db:{url:'postgresql://fixture@127.0.0.1:'+port+'/postgres'}},log:[]});
 await database.$executeRawUnsafe('CREATE TABLE "Product" ("id" TEXT PRIMARY KEY,"shop" TEXT NOT NULL)');
 await database.$executeRawUnsafe('CREATE TABLE "Variant" ("id" TEXT PRIMARY KEY,"productId" TEXT REFERENCES "Product"("id"),"marketPrices" JSONB)');
 await database.$executeRaw`INSERT INTO "Product" VALUES ('gid://shopify/Product/1','owner.myshopify.com'),('gid://shopify/Product/2','other.myshopify.com')`;
 await database.$executeRaw`INSERT INTO "Variant" VALUES
  ('11','gid://shopify/Product/1','{"IN":{"price":100,"currency":"INR"},"GB":{"price":2,"currency":"GBP"}}'::jsonb),
  ('12','gid://shopify/Product/1','{"IN":null}'::jsonb),
  ('13','gid://shopify/Product/1','{"GB":{"price":3}}'::jsonb),
  ('14','gid://shopify/Product/1',null),
  ('21','gid://shopify/Product/2','{"IN":{"price":900,"currency":"INR"}}'::jsonb)`;
 const products=[{id:'1',variantPrices:[{id:'11',marketPrices:{IN:{price:1},GB:{price:2}}},{id:'12',marketPrices:{IN:{price:3}}},{id:'13',marketPrices:{IN:{price:4}}},{id:'14',marketPrices:{IN:{price:5}}}]},{id:'2',variantPrices:[{id:'21',marketPrices:{IN:{price:6}}}]}];
 let reads=0;
 await hydrateSavedMarketPrices(products,{findMany:()=>{throw Error('Unexpected full JSON fallback');}},'owner.myshopify.com','IN',{database:{$queryRaw:async query=>{
  reads++;const rows=await database.$queryRaw(query);assert.equal(rows.length,2);assert.ok(rows.every(row=>Object.keys(row.marketPrices).join(',')==='IN'));return rows;
 }}});
 assert.equal(reads,1);assert.equal(products[0].variantPrices[0].marketPrices.IN.price,100);assert.equal(products[0].variantPrices[0].marketPrices.GB.price,2);
 assert.equal(products[0].variantPrices[1].marketPrices.IN,null);assert.equal(products[0].variantPrices[2].marketPrices.IN.price,4);assert.equal(products[0].variantPrices[3].marketPrices.IN.price,5);assert.equal(products[1].variantPrices[0].marketPrices.IN.price,6);
 console.log('PASS: actual PostgreSQL country projection; one bounded read, other markets not transferred, missing/null semantics and tenant isolation preserved.');
}finally{
 if(database)await database.$disconnect();
 if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
}
