import {randomUUID} from 'node:crypto';

// Rankings/cards already use deflate. Store those bytes directly instead of
// paying base64's extra third again in the durable storage budget.
const binaryPrefix=Buffer.from([0,67,70,80,1]);
export function collectionSnapshotStorageBytes(payload){
 if(payload.startsWith('z1:')){
  const encoded=payload.slice(3),compressed=Buffer.from(encoded,'base64');
  if(compressed.toString('base64')===encoded&&compressed.length+binaryPrefix.length<Buffer.byteLength(payload))return Buffer.concat([binaryPrefix,compressed]);
 }
 return Buffer.from(payload);
}
export function collectionSnapshotStorageText(payload){
 const bytes=Buffer.from(payload);
 return bytes.subarray(0,binaryPrefix.length).equals(binaryPrefix)?'z1:'+bytes.subarray(binaryPrefix.length).toString('base64'):bytes.toString('utf8');
}

const validShop=shop=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'');
const validKey=(shop,kind,key)=>{
 const prefix=kind==='ranking'?`collectionPreparedSequence:${shop}:background-v2:`:kind==='cards'?`collectionFirstPage:${shop}:`:null;
 return prefix&&typeof key==='string'&&key.startsWith(prefix)&&/^[a-f0-9]{64}$/.test(key.slice(prefix.length));
};
export function createCollectionLoadingSnapshots({database,redis,now=Date.now,maxBytes=256*1024*1024,maxEntries=8192,maxEntryBytes=2*1024*1024,observe=()=>{}}){
 const report=error=>{try{observe(error);}catch{}};
 const epochs=(shop,id)=>[`collectionPreparationRevision:${shop}`,`collectionProductRevision:${shop}:${id}`,`collectionProductRevision:${shop}:all`,`collectionRankingDataRevision:${shop}:all`,`collectionRankingDataRevision:${shop}:${id}`];
 async function generation(shop){
  const key=`collectionLoadingGeneration:${shop}`;
  let value=await redis.get(key);
  if(!value){await redis.set(key,randomUUID(),'NX');value=await redis.get(key);}
  if(typeof value!=='string'||!value)throw Error('Loading generation unavailable');
  return value;
 }
 async function load({shop,kind,key}){
  if(!validShop(shop)||!validKey(shop,kind,key))return null;
  try{
   const [current,row]=await Promise.all([generation(shop),database.collectionLoadingSnapshot.findFirst({where:{shop,kind,aliases:{has:key},...(kind==='ranking'?{}:{expiresAt:{gt:new Date(now())}})},select:{generation:true,collectionId:true,payload:true,size:true}})]);
   if(!row||row.generation!==current||row.size>maxEntryBytes||row.payload.byteLength!==row.size)return null;
   // Missing counters mean lost invalidation history, not a verified zero.
   if((await Promise.all(epochs(shop,row.collectionId).map(key=>redis.get(key)))).some(value=>value==null))return null;
   const payload=collectionSnapshotStorageText(row.payload);
   return Buffer.byteLength(payload)<=maxEntryBytes?payload:null;
  }catch(error){report(error);return null;}
 }
 async function save({shop,kind,key,collectionId,aliases=[key],scopeKey,payload,expiresAt,validatedAt=now()}){
  if(!validShop(shop)||!validKey(shop,kind,key)||!/^\d+$/.test(String(collectionId))||typeof payload!=='string'||!Number.isFinite(expiresAt)||expiresAt<=now()||!Number.isFinite(validatedAt)||validatedAt>now())return false;
  if(scopeKey!==undefined&&(kind!=='ranking'||!validKey(shop,kind,scopeKey)||scopeKey===key))return false;
  aliases=[...new Set([key,...aliases,...(scopeKey?[scopeKey]:[])])];
  if(aliases.length>4||aliases.some(alias=>!validKey(shop,kind,alias)))return false;
  if(Buffer.byteLength(payload)>maxEntryBytes||payload.charCodeAt(0)===0)return false;
  const bytes=collectionSnapshotStorageBytes(payload),size=bytes.byteLength;
  if(size>Math.min(maxEntryBytes,maxBytes))return false;
  try{
   const current=await generation(shop);
   await Promise.all(epochs(shop,collectionId).map(key=>redis.set(key,'0','NX')));
   return await database.$transaction(async tx=>{
    // Serialize this shop's budget decisions across web/worker processes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection-loading:${shop}`},0))::text`;
    const table=tx.collectionLoadingSnapshot;
    // Ranking validity follows product/configuration versions, not elapsed time.
    // The existing per-shop byte and entry budgets still bound durable storage.
    await table.deleteMany({where:{shop,kind:'cards',expiresAt:{lte:new Date(now())}}});
    const existing=await table.findUnique({where:{id:key},select:{validatedAt:true,generation:true,payload:true,aliases:true}});
    if(existing?.generation===current&&existing.validatedAt.getTime()>validatedAt)return false;
    // Only replace versions belonging to an explicitly identical context. A
    // late older build cannot delete the newer version saved by another worker.
    const previous=scopeKey?await table.findMany({where:{shop,kind,collectionId:String(collectionId),aliases:{has:scopeKey}},select:{id:true,validatedAt:true},take:maxEntries+1}):[];
    if(previous.some(row=>row.validatedAt.getTime()>validatedAt))return false;
    const obsolete=previous.filter(row=>row.id!==key).map(row=>row.id);
    if(obsolete.length)await table.deleteMany({where:{shop,kind,collectionId:String(collectionId),id:{in:obsolete}}});
    if(kind==='ranking'&&existing?.generation===current&&existing.payload&&
       Buffer.from(existing.payload).equals(bytes)&&JSON.stringify([...(existing.aliases||[])].sort())===JSON.stringify([...aliases].sort()))return true;
    const data={shop,kind,collectionId:String(collectionId),aliases,generation:current,payload:bytes,size,expiresAt:new Date(expiresAt),validatedAt:new Date(validatedAt),updatedAt:new Date(now())};
    await table.upsert({where:{id:key},create:{id:key,...data},update:data});
    const usage=await table.aggregate({where:{shop},_sum:{size:true},_count:true});
    let count=usage._count,total=usage._sum.size||0;
    while(count>maxEntries||total>maxBytes){
     const oldest=await table.findMany({where:{shop},select:{id:true,size:true},orderBy:[{updatedAt:'asc'},{id:'asc'}],take:100});
     if(!oldest.length)throw Error('Snapshot budget could not be enforced');
     const remove=[];
     for(const row of oldest){if(count<=maxEntries&&total<=maxBytes)break;remove.push(row.id);count--;total-=row.size;}
     await table.deleteMany({where:{shop,id:{in:remove}}});
    }
    return true;
   });
  }catch(error){report(error);return false;}
 }
 return {load,save,generation};
}
