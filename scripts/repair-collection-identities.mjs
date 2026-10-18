import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const stable=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const ruleIdentityFingerprint=r=>createHash('sha256').update(JSON.stringify(stable(Object.fromEntries(['id','shop','ruleType','name','ordinal','status','collections','customerTags','locales','startDate','endDate','conditions'].map(k=>[k,r[k]??null]))))).digest('hex');
const parse=v=>typeof v==='string'?(v?JSON.parse(v):[]):v||[];
const field=f=>({tags:'Tags',available:'Available',id:'Id','option:Color':'Color (product option)'})[f]||f;
function sourceConditions(row){return parse(row.Conditions).map(c=>({action:c.Type,field:field(c.Field),values:Array.isArray(c.Value)?c.Value.map(String):[String(c.Value??'')],operator:c.Type==='Dynamic'?c.DynamicOperator:null,operand:c.Type==='Dynamic'?String(c.DynamicOperand):null,max:c.Value2==null?null:String(c.Value2)}));}
function appConditions(row){return row.conditions.map(c=>({action:c.action,field:c.field,values:c.field==='Available'?[String(c.minValue??c.value??'')]:String(c.value??'').split(',').map(v=>v.trim()),operator:c.action==='Dynamic'?c.operator:null,operand:c.action==='Dynamic'?String(c.operand):null,max:c.field==='Available'?String(c.maxValue):null}));}
export function createCollectionIdentityPlan(source,app,catalog){
 if(!app.shop||!Array.isArray(source.rows)||!Array.isArray(catalog.collections))throw Error('Invalid audit inputs.');
 const bindings=source.rows.map(s=>{
  if(s.ForCollections!==true)throw Error('Source contains a non-collection rule.');
  const matches=app.merch.filter(r=>r.shop===app.shop&&r.ruleType==='collection'&&r.name.trim()===s.Name.trim()&&r.ordinal===s.Ordinal);
  if(matches.length!==1)throw Error(`Rule identity is ambiguous: ${s.Name.trim()}`);
  const r=matches[0];
  if(r.status!==s.Active||JSON.stringify(sourceConditions(s))!==JSON.stringify(appConditions(r)))throw Error(`Rule changed: ${r.name}`);
  const collectionIds=[...new Set(parse(s.Collections).map(id=>`gid://shopify/Collection/${String(id).split('/').pop()}`))];
  if(collectionIds.some(id=>!/^gid:\/\/shopify\/Collection\/\d+$/.test(id)))throw Error('Invalid source target ID.');
  if(!collectionIds.length&&r.collections.length)throw Error('A specific rule cannot become global.');
  return{id:r.id,name:r.name,expectedFingerprint:ruleIdentityFingerprint(r),collectionIds};
 });
 if(new Set(bindings.map(r=>r.id)).size!==bindings.length)throw Error('Duplicate destination rule.');
 const existing=new Set(app.collections.map(c=>c.id));
 const collections=catalog.collections.filter(c=>c.published===true&&!existing.has(c.id)).map(c=>({id:c.id,shop:app.shop,title:c.title,handle:c.handle}));
 return{version:1,shop:app.shop,sourceReadAt:source.at,catalogReadAt:catalog.at,bindings,collections,
   missingUnpublishedOrUnverifiedCollections:catalog.collections.filter(c=>c.published!==true&&!existing.has(c.id)).map(c=>c.id)};
}
const select={id:true,shop:true,ruleType:true,name:true,ordinal:true,status:true,collections:true,customerTags:true,locales:true,startDate:true,endDate:true,conditions:true,updatedAt:true};
export async function repairCollectionIdentities(db,plan,{apply=false,backup=async()=>{}}={}){
 if(plan.version!==1||!plan.shop||!Array.isArray(plan.bindings)||!Array.isArray(plan.collections))throw Error('Invalid repair plan.');
 if(new Set(plan.bindings.map(r=>r.id)).size!==plan.bindings.length||new Set(plan.collections.map(c=>c.id)).size!==plan.collections.length)throw Error('Duplicate repair target.');
 if(plan.collections.some(c=>c.shop!==plan.shop||!/^gid:\/\/shopify\/Collection\/\d+$/.test(c.id)))throw Error('Invalid collection ownership.');
 if(plan.bindings.some(r=>!Array.isArray(r.collectionIds)||r.collectionIds.some(id=>!/^gid:\/\/shopify\/Collection\/\d+$/.test(id))))throw Error('Invalid rule targets.');
 return db.$transaction(async tx=>{
  const rows=await tx.merchandisingRule.findMany({where:{shop:plan.shop,ruleType:'collection',id:{in:plan.bindings.map(r=>r.id)}},select:{...select,...(apply?{collectionIds:true}:{})}});
  if(rows.length!==plan.bindings.length)throw Error('A repair rule is missing or belongs to another shop.');
  for(const b of plan.bindings){const r=rows.find(r=>r.id===b.id);if(r.shop!==plan.shop||r.ruleType!=='collection'||ruleIdentityFingerprint(r)!==b.expectedFingerprint)throw Error('Rules changed since the audit; no repair was applied.');if(r.collectionIds?.length&&JSON.stringify(r.collectionIds)!==JSON.stringify(b.collectionIds))throw Error('Existing rule target IDs differ; refusing to overwrite.');}
  const missing=[];for(const c of plan.collections){const existing=await tx.collection.findUnique({where:{id:c.id},select:{shop:true}});if(existing&&existing.shop!==plan.shop)throw Error('Collection belongs to another shop.');if(!existing)missing.push(c);}
  if(apply){
   await backup({shop:plan.shop,at:new Date().toISOString(),bindings:rows.map(r=>({id:r.id,collectionIds:r.collectionIds||[]})),createdCollectionIds:missing.map(c=>c.id)});
   for(const c of missing)await tx.collection.create({data:c});
   for(const b of plan.bindings){const r=rows.find(r=>r.id===b.id);if(JSON.stringify(r.collectionIds||[])===JSON.stringify(b.collectionIds))continue;const updated=await tx.merchandisingRule.updateMany({where:{id:r.id,shop:plan.shop,ruleType:'collection',updatedAt:r.updatedAt},data:{collectionIds:b.collectionIds}});if(updated.count!==1)throw Error('Concurrent rule edit; repair rolled back.');}
  }
  return{applied:apply,shop:plan.shop,rulesValidated:rows.length,collectionsToCreate:missing.length};
 },{isolationLevel:'Serializable',timeout:120000});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1],apply=args.includes('--apply');
 if(!args.includes('--plan')||!args.includes('--shop')||(apply&&!args.includes('--backup')))throw Error('Usage: node --env-file=.env scripts/repair-collection-identities.mjs --plan plan.json --shop store.myshopify.com [--apply --backup backup.json]');
 const plan=JSON.parse(await fs.readFile(value('--plan'),'utf8'));if(plan.shop!==value('--shop'))throw Error('Shop does not match repair plan.');
 const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
 try{const result=await repairCollectionIdentities(db,plan,{apply,backup:data=>fs.writeFile(value('--backup'),JSON.stringify(data,null,2),{flag:'wx'})});
  if(apply){const{default:Redis}=await import('ioredis');const{REDIS_URL}=await import('../app/services/redisConnection.server.js');const{createShopCacheInvalidation}=await import('../app/utils/shopCacheInvalidation.js');const redis=new Redis(REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:0});try{await redis.connect();await createShopCacheInvalidation({redis})(plan.shop);}finally{redis.disconnect();}}
  console.log(JSON.stringify(result));
 }finally{await db.$disconnect();}
}
