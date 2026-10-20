import {createHash} from 'node:crypto';
import {preparationSnapshotScopeKey} from './collectionPreparation.js';
const suffix=spec=>createHash('sha256').update(preparationSnapshotScopeKey(spec)).digest('hex');
const prefix=shop=>`collectionPinnedHeadProof:${shop}:`;
const block=(shop,version)=>`collectionPinnedHeadBlocked:${shop}:${version}`;
const retain=`redis.call('SETEX',KEYS[1],ARGV[1],ARGV[2]);local latest=redis.call('ZREVRANGE',KEYS[2],0,0,'WITHSCORES');local score=tonumber(ARGV[3]);if latest[2] then score=math.max(score,tonumber(latest[2])+1) end redis.call('ZADD',KEYS[2],score,KEYS[1]);redis.call('EXPIRE',KEYS[2],ARGV[1]);for _,key in ipairs(redis.call('ZRANGE',KEYS[2],0,-tonumber(ARGV[4])-1)) do if string.sub(key,1,string.len(ARGV[5]))==ARGV[5] then redis.call('DEL',key) end redis.call('ZREM',KEYS[2],key) end return 1`;
const remove=`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
export function createCollectionHeadProofs({redis,readVersion,observe=()=>{},now=Date.now,maxEntries=1024}){
 const report=event=>{try{observe(event);}catch{}};
 async function remember(spec,inputVersion,ids){
  if(!/^[a-f0-9]{64}$/.test(inputVersion)||!Array.isArray(ids)||ids.length!==5||new Set(ids).size!==5||ids.some(id=>!/^\d+$/.test(id)))return false;
  const key=prefix(spec.shop)+suffix(spec),raw=JSON.stringify({version:1,inputVersion,ids,at:now()});
  try{
   if(redis.eval)await redis.eval(retain,2,key,`collectionPinnedHeadProofRetention:${spec.shop}`,600,raw,now(),maxEntries,prefix(spec.shop));
   else await redis.setex(key,600,raw);
   return true;
  }catch{return false;}
 }
 async function compare(spec,canonical){
  const key=prefix(spec.shop)+suffix(spec);let raw;
  try{
   raw=await redis.get(key);if(!raw)return null;
   const proof=JSON.parse(raw);if(proof.version!==1||!Array.isArray(proof.ids)||proof.ids.length!==5)return null;
   const current=await readVersion(spec),base={shop:spec.shop,collectionId:spec.collectionId};
   if(current!==proof.inputVersion){report({...base,event:'head-comparison-skipped',reason:'inputs-changed'});return 'changed';}
   const position=proof.ids.findIndex((id,i)=>canonical.ids[i]!==id);
   if(position<0){report({...base,event:'head-comparison-match'});return 'match';}
   await redis.setex(block(spec.shop,current),3600,'1');
   report({...base,event:'head-comparison-mismatch',reason:'canonical-prefix-differs',position,expectedId:canonical.ids[position],servedId:proof.ids[position]});return 'mismatch';
  }catch{report({shop:spec.shop,collectionId:spec.collectionId,event:'head-comparison-unavailable'});return 'unavailable';}
  finally{if(raw)try{if(redis.eval)await redis.eval(remove,1,key,raw);else if(await redis.get(key)===raw)await redis.del(key);}catch{}}
 }
 return {remember,compare,blocked:async(spec,version)=>Boolean(await redis.get(block(spec.shop,version)))};
}
