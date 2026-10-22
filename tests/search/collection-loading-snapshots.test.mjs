import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionLoadingSnapshots} from '../../app/utils/collectionLoadingSnapshots.js';
import {encodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {preparationSnapshotScopeKey} from '../../app/utils/collectionPreparation.js';

function fixture(options={}){
 const rows=new Map(),values=new Map();let time=100000,locks=0;
 const matches=(row,w)=>Object.entries(w).every(([key,value])=>key==='expiresAt'?(value.gt?row.expiresAt>value.gt:row.expiresAt<=value.lte):key==='aliases'?row.aliases.includes(value.has):key==='id'&&value.in?value.in.includes(row.id):row[key]===value);
 const table={findFirst:async({where})=>[...rows.values()].find(r=>matches(r,where))||null,findUnique:async({where})=>rows.get(where.id)||null,
  deleteMany:async({where})=>{for(const [key,row]of rows)if(matches(row,where))rows.delete(key);},
  upsert:async({where,create,update})=>rows.set(where.id,rows.has(where.id)?{...rows.get(where.id),...update}:create),
  aggregate:async({where})=>{const selected=[...rows.values()].filter(r=>matches(r,where));return {_count:selected.length,_sum:{size:selected.reduce((n,r)=>n+r.size,0)}};},
  findMany:async({where,take})=>[...rows.values()].filter(r=>matches(r,where)).sort((a,b)=>a.updatedAt-b.updatedAt||a.id.localeCompare(b.id)).slice(0,take),
 };
 const database={collectionLoadingSnapshot:table,$queryRaw:async()=>{locks++;},$transaction:async fn=>{const before=new Map(rows);try{return await fn(database);}catch(error){rows.clear();for(const pair of before)rows.set(...pair);throw error;}}};
 const redis={get:async key=>values.get(key),set:async(key,value,mode)=>{if(mode!=='NX'||!values.has(key))values.set(key,value);}};
 const store=createCollectionLoadingSnapshots({database,redis,now:()=>time,...options});
 const shop='fixture.myshopify.com',key=n=>`collectionFirstPage:${shop}:`+String(n).padStart(64,'a');
 const write=(n,payload='payload')=>store.save({shop,kind:'cards',key:key(n),aliases:[key(n),key(n+100)],collectionId:'1',payload,expiresAt:time+10000});
 return {store,rows,values,database,redis,shop,key,write,advance:n=>time+=n,locks:()=>locks,now:()=>time};
}

test('durable copies deduplicate handle/ID aliases, remain tenant scoped and expire',async()=>{
 const f=fixture();assert.equal(await f.write(1),true);assert.equal(f.rows.size,1);assert.equal(f.locks(),1);
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(101)}),'payload');
 assert.equal(await f.store.load({shop:'other.myshopify.com',kind:'cards',key:f.key(101)}),null);
 assert.equal(await f.store.save({shop:f.shop,kind:'cards',key:f.key(1),aliases:['queue:protected'],collectionId:'1',payload:'x',expiresAt:200000}),false);
 f.advance(10001);assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),null);
});

test('Redis resets reject old durable copies instead of resurrecting lost invalidation epochs',async()=>{
 const f=fixture();await f.write(1);f.values.clear();
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),null);
 await f.write(1,'replacement');assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),'replacement');
});

test('published serving data survives working epoch resets and daily expiry until a complete replacement exists',async()=>{
 const f=fixture(),key=`collectionPublishedPage:${f.shop}:`+'c'.repeat(64);
 assert.equal(await f.store.save({shop:f.shop,kind:'published',key,collectionId:'1',payload:'published complete cards',expiresAt:f.now()+10000}),true);
 f.values.clear();f.advance(86400000*2);await f.write(2);
 assert.equal(await f.store.load({shop:f.shop,kind:'published',key}),'published complete cards');
 assert.equal(await f.store.load({shop:'other.myshopify.com',kind:'published',key}),null);
 assert.equal(await f.store.save({shop:f.shop,kind:'published',key,collectionId:'1',payload:'older build',validatedAt:1,expiresAt:f.now()+10000}),false);
 assert.equal(await f.store.load({shop:f.shop,kind:'published',key}),'published complete cards');
});

test('durable rankings survive time expiry and card cleanup, while unchanged saves perform no database update',async()=>{
 const f=fixture(),key=`collectionPreparedSequence:${f.shop}:background-v2:`+'b'.repeat(64);
 const save=payload=>f.store.save({shop:f.shop,kind:'ranking',key,collectionId:'1',payload,expiresAt:f.now()+10000});
 assert.equal(await save('saved order'),true);const original=f.rows.get(key).updatedAt.getTime();
 await f.write(1);f.advance(86400000*30);
 assert.equal(await f.store.load({shop:f.shop,kind:'ranking',key}),'saved order');
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),null);
 await f.write(2);assert.ok(f.rows.has(key));assert.equal(f.rows.has(f.key(1)),false);
 await save('saved order');assert.equal(f.rows.get(key).updatedAt.getTime(),original);
 await save('updated order');assert.ok(f.rows.get(key).updatedAt.getTime()>original);
});

test('durable byte/entry budgets evict oldest owned snapshots and oversized writes are rejected',async()=>{
 const f=fixture({maxEntries:2,maxBytes:12,maxEntryBytes:10});
 await f.write(1,'123456');f.advance(1);await f.write(2,'123456');f.advance(1);await f.write(3,'123456');
 assert.equal(f.rows.size,2);assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),null);
 assert.equal(await f.write(4,'12345678901'),false);assert.equal(f.rows.size,2);
 const other={...f.rows.values().next().value,id:'protected',shop:'other.myshopify.com',size:1000000};f.rows.set(other.id,other);
 await f.write(4,'123456');assert.ok(f.rows.has('protected'));
});

test('missing migrations or database failures are optional and cannot fail canonical delivery',async()=>{
 const f=fixture();f.database.collectionLoadingSnapshot.findFirst=async()=>{throw Error('Missing table');};
 f.database.$transaction=async()=>{throw Error('Unavailable database');};
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),null);assert.equal(await f.write(1),false);
});

test('binary durable deflate saves base64 overhead and loads original and legacy formats losslessly',async()=>{
 const f=fixture(),payload=encodePreparation({ids:Array.from({length:20000},(_,i)=>String(10000000+i)),metadata:{}});
 assert.ok(payload.startsWith('z1:'));assert.equal(await f.write(1,payload),true);
 const row=f.rows.get(f.key(1));assert.ok(row.size<Buffer.byteLength(payload)*0.76);
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),payload);
 row.payload=Buffer.from(payload);row.size=row.payload.length;
 assert.equal(await f.store.load({shop:f.shop,kind:'cards',key:f.key(1)}),payload);
 const limited=fixture({maxEntryBytes:Buffer.byteLength(payload)-1});assert.equal(await limited.write(1,payload),false);
});

test('completed order versions replace only their own durable context and late older writes cannot regress it',async()=>{
 const f=fixture(),key=n=>`collectionPreparedSequence:${f.shop}:background-v2:`+String(n).padStart(64,'b');
 const scope=key(9),save=(n,scopeKey=scope,validatedAt=f.now())=>f.store.save({shop:f.shop,kind:'ranking',key:key(n),scopeKey,collectionId:'1',payload:'order '+n,validatedAt,expiresAt:f.now()+10000});
 await save(1);f.advance(1);await save(2,key(8));f.advance(1);await save(3);
 assert.equal(f.rows.has(key(1)),false);assert.equal(f.rows.has(key(2)),true);assert.equal(f.rows.has(key(3)),true);
 assert.equal(await save(4,scope,f.now()-1),false);assert.equal(f.rows.has(key(3)),true);
 assert.equal(await f.store.save({shop:f.shop,kind:'ranking',key:key(5),scopeKey:'queue:protected',collectionId:'1',payload:'x',expiresAt:f.now()+10000}),false);
 const base={shop:f.shop,collectionId:'1',revision:'11',query:{filter:['native']},sortBy:'best-selling',orderedIds:['1'],orderRevision:'one'};
 assert.equal(preparationSnapshotScopeKey(base),preparationSnapshotScopeKey({...base,orderedIds:['2'],orderRevision:'two'}));
 for(const change of [{revision:'12'},{collectionId:'2'},{sortBy:'price-ascending'},{query:{filter:['other']}},{shop:'other.myshopify.com'}])assert.notEqual(preparationSnapshotScopeKey(base),preparationSnapshotScopeKey({...base,...change}));
});
