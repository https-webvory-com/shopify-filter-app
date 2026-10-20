// Audit by default. --apply only reduces physical bytes; no ranking or expiry
// changes, and each write compares the complete row it inspected.
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {collectionSnapshotStorageBytes,collectionSnapshotStorageText} from '../app/utils/collectionLoadingSnapshots.js';
const at=process.argv.indexOf('--shop'),shop=at<0?null:process.argv[at+1],apply=process.argv.includes('--apply');
if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||''))throw Error('Pass --shop STORE.myshopify.com');
const database=new PrismaClient(),result={shop,apply,inspected:0,eligible:0,changed:0,concurrentChanges:0,reclaimableBytes:0,reclaimedBytes:0};
try{
 let cursor;
 for(;;){
  const rows=await database.collectionLoadingSnapshot.findMany({where:{shop},orderBy:{id:'asc'},take:50,...(cursor?{cursor:{id:cursor},skip:1}:{}),
   select:{id:true,size:true,payload:true,updatedAt:true}});
  for(const row of rows){
   result.inspected++;
   if(row.size>2*1024*1024||row.payload.byteLength!==row.size)continue;
   const text=collectionSnapshotStorageText(row.payload),bytes=collectionSnapshotStorageBytes(text),saving=row.size-bytes.length;
   if(saving<=0||collectionSnapshotStorageText(bytes)!==text)continue;
   result.eligible++;result.reclaimableBytes+=saving;
   if(apply){
    const count=await database.$transaction(async tx=>{
     await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection-loading:${shop}`},0))::text`;
     return (await tx.collectionLoadingSnapshot.updateMany({where:{id:row.id,shop,size:row.size,updatedAt:row.updatedAt,payload:{equals:row.payload}},
      data:{payload:bytes,size:bytes.length,updatedAt:row.updatedAt}})).count;
    });
    if(count){result.changed++;result.reclaimedBytes+=saving;}else result.concurrentChanges++;
   }
  }
  if(rows.length<50)break;cursor=rows.at(-1).id;
 }
 console.log(JSON.stringify(result));
}finally{await database.$disconnect();}
