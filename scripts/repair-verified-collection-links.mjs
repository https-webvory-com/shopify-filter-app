import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const membershipFields=['collections','collection_titles','cfpSearchCollections'];
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hashOther=doc=>createHash('sha256').update(JSON.stringify(stable(Object.fromEntries(Object.entries(doc).filter(([k])=>!membershipFields.includes(k)))))).digest('hex');
export async function repairVerifiedCollectionLinks({db,index,tasks,shop,targets,readCanonical,apply=false,backup,onMutation=()=>{}}){
 if(!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)||!Array.isArray(targets)||!targets.length)throw Error('Explicit repair scope required');
 const seen=new Set(),rows=[];
 for(const target of targets){const {productId,collectionId}=target;if(!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)||!/^gid:\/\/shopify\/Collection\/\d+$/.test(collectionId)||seen.has(productId))throw Error('Invalid or duplicate repair target');seen.add(productId);
  const product=await db.product.findFirst({where:{id:productId,shop},select:{id:true,updatedAt:true}}),collection=await db.collection.findUnique({where:{id:collectionId},select:{id:true,title:true,shop:true}});
  if(!product||collection?.shop!==shop)throw Error('Repair ownership mismatch');
  const canonical=await readCanonical(productId,collectionId);
  if(canonical?.id!==productId||canonical.status!=='ACTIVE'||!canonical.publishedAt||canonical.inCollection!==true)throw Error('Canonical membership or publication changed; no repair applied');
  const doc=await index.getDocument(productId.split('/').pop());if(doc.shop!==shop)throw Error('Index ownership mismatch');
  const link=await db.productCollection.findUnique({where:{productId_collectionId:{productId,collectionId}}});
  rows.push({productId,collectionId,title:collection.title,updatedAt:product.updatedAt,hadDbLink:!!link,doc,otherHash:hashOther(doc)});
 }
 if(!apply)return{applied:false,validated:rows.length};
 if(typeof backup!=='function')throw Error('Backup is required before repair writes');
 await backup({shop,at:new Date().toISOString(),rows:rows.map(r=>({productId:r.productId,collectionId:r.collectionId,hadDbLink:r.hadDbLink,indexFields:Object.fromEntries(membershipFields.map(k=>[k,r.doc[k]??null])),otherHash:r.otherHash}))});
 onMutation();
 const written=await db.$transaction(async tx=>{for(const r of rows){if(!await tx.product.findFirst({where:{id:r.productId,shop,updatedAt:r.updatedAt},select:{id:true}}))throw Error('Concurrent product update; repair rolled back');}
  return await tx.productCollection.createMany({data:rows.map(({productId,collectionId})=>({productId,collectionId})),skipDuplicates:true});
 },{isolationLevel:'Serializable',timeout:30000});
 const {searchIndexProjection}=await import('../app/utils/searchIndexProjection.js');
 const updates=[];for(const r of rows){const current=await index.getDocument(r.productId.split('/').pop());if(JSON.stringify(current.collections)!==JSON.stringify(r.doc.collections)||JSON.stringify(current.collection_titles)!==JSON.stringify(r.doc.collection_titles)||hashOther(current)!==r.otherHash)throw Error('Index changed during repair; recheck before retry');
  const collections=[...new Set([...(current.collections||[]),r.collectionId])],titles=[...new Set([...(current.collection_titles||[]),r.title])];updates.push({id:current.id,collections,collection_titles:titles,cfpSearchCollections:searchIndexProjection({...current,collection_titles:titles}).cfpSearchCollections});}
 const task=await index.updateDocuments(updates),done=await tasks.waitForTask(task.taskUid,{timeout:120000});if(done.status!=='succeeded')throw Error('Repair indexing failed; rerun after rechecking');
 for(const r of rows){const link=await db.productCollection.findUnique({where:{productId_collectionId:{productId:r.productId,collectionId:r.collectionId}}}),doc=await index.getDocument(r.productId.split('/').pop());if(!link||!doc.collections.includes(r.collectionId)||!doc.collection_titles.includes(r.title)||hashOther(doc)!==r.otherHash)throw Error('Repair verification failed');}
 return{applied:true,validated:rows.length,verified:rows.length,dbLinksAdded:written?.count??rows.filter(r=>!r.hadDbLink).length,indexLinksAdded:rows.filter(r=>!r.doc.collections?.includes(r.collectionId)).length,nonMembershipIndexFieldsUnchanged:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1],apply=args.includes('--apply');
 if(!args.includes('--shop')||!args.includes('--plan')||(apply&&!args.includes('--backup')))throw Error('Use --shop --plan [--apply --backup]');
 const shop=value('--shop'),targets=JSON.parse(await fs.readFile(value('--plan'),'utf8'));
 const {PrismaClient}=await import('@prisma/client'),{default:meili}=await import('../app/services/meiliClient.server.js');const db=new PrismaClient();let mutated=false;
 try{const session=await db.session.findFirst({where:{shop,isOnline:false},select:{accessToken:true}});if(!session)throw Error('Shop read session unavailable');
 const result=await repairVerifiedCollectionLinks({db,index:meili.index('products'),tasks:meili.tasks,shop,targets,apply,onMutation:()=>{mutated=true;},backup:data=>fs.writeFile(value('--backup'),JSON.stringify(data,null,2),{flag:'wx'}),readCanonical:async(productId,collectionId)=>{
  for(let n=0;n<6;n++){const response=await fetch('https://'+shop+'/admin/api/2026-07/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':session.accessToken},body:JSON.stringify({query:'query($id:ID!,$cid:ID!){product(id:$id){id status publishedAt inCollection(id:$cid)}}',variables:{id:productId,cid:collectionId}}),signal:AbortSignal.timeout(30000)});const body=await response.json();if(response.status===429||body.errors?.some(e=>e.extensions?.code==='THROTTLED')){await new Promise(r=>setTimeout(r,3000));continue;}if(!response.ok||body.errors)throw Error('Canonical repair read failed');return body.data.product;}throw Error('Canonical repair read throttled');
 }});console.log('VERIFIED_LINK_REPAIR',JSON.stringify(result));
 }finally{try{if(mutated){const {default:Redis}=await import('ioredis'),{REDIS_URL}=await import('../app/services/redisConnection.server.js'),{createShopCacheInvalidation}=await import('../app/utils/shopCacheInvalidation.js');const redis=new Redis(REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:0});try{await redis.connect();await createShopCacheInvalidation({redis})(shop);}finally{redis.disconnect();}}}finally{await db.$disconnect();}}
}
