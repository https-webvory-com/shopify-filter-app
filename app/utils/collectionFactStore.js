import {collectionFactsCurrent} from './collectionRuleFacts.js';
const lifetime=86400,budget=64*1024*1024;
export const factStoreKeys=(shop,profile)=>[`collectionRuleFacts:${shop}:${profile}`,`collectionRuleFactHeads:${shop}:${profile}`,`collectionRuleFactBytes:${shop}:${profile}`];
const write=`
local field = ARGV[1]..':'..ARGV[2]
local old = redis.call('HGET',KEYS[1],field)
local size = tonumber(redis.call('GET',KEYS[3]) or '0') + string.len(ARGV[3]) - (old and string.len(old) or 0)
local head = redis.call('HGET',KEYS[2],ARGV[1])
local previous = head and cjson.decode(head) or {}
local remove = previous[1] ~= ARGV[2] and previous[2] and previous[2] ~= ARGV[2] and ARGV[1]..':'..previous[2] or nil
if remove then local value=redis.call('HGET',KEYS[1],remove); if value then size=size-string.len(value) end end
if size > tonumber(ARGV[5]) or string.len(ARGV[3]) > 16384 then return 0 end
redis.call('HSET',KEYS[1],field,ARGV[3])
if remove then redis.call('HDEL',KEYS[1],remove) end
if previous[1] ~= ARGV[2] then redis.call('HSET',KEYS[2],ARGV[1],cjson.encode({ARGV[2],previous[1]})) end
redis.call('SETEX',KEYS[3],ARGV[4],size)
redis.call('EXPIRE',KEYS[1],ARGV[4]);redis.call('EXPIRE',KEYS[2],ARGV[4])
local score=math.max(tonumber(ARGV[6]),tonumber(redis.call('ZSCORE',KEYS[4],ARGV[7]) or '0'))
redis.call('ZADD',KEYS[4],score,ARGV[7]);redis.call('EXPIRE',KEYS[4],ARGV[4])
for _, profile in ipairs(redis.call('ZRANGE',KEYS[4],0,-3)) do
 if string.len(profile)==64 and string.match(profile,'^%x+$') then
  redis.call('DEL',ARGV[8]..profile,ARGV[9]..profile,ARGV[10]..profile)
 end
 redis.call('ZREM',KEYS[4],profile)
end
return 1`;
const clean=id=>String(id).split('/').pop();
export function readCollectionFactRecord(raw,source,known){
 let value;try{value=JSON.parse(raw);}catch{throw Error('Collection ranking facts missing');}
 if(!value||value.s!==source||!Array.isArray(value.m)||value.m.some(v=>typeof v!=='string')||!value.i||typeof value.i!=='object'||Array.isArray(value.i))throw Error('Collection ranking facts missing');
 if(value.m.some(v=>!known.has(v.slice(0,-2))||!/^:[emb]$/.test(v.slice(-2)))||new Set(value.m.map(v=>v.slice(0,-2))).size!==value.m.length||Object.keys(value.i).some(k=>!known.has(k)))throw Error('Invalid collection ranking facts');
 return value;
}
export function createCollectionFactStore(redis){
 return {
  async put(shop,profile,product,facts){
   if(!collectionFactsCurrent({...product,...facts},profile))throw Error('Invalid collection facts');
   const raw=JSON.stringify({s:facts.cfpCollectionFactSource,m:facts.cfpCollectionFactMatches,i:facts.cfpCollectionFactImages});
   return redis.eval(write,4,...factStoreKeys(shop,profile.id),`collectionRuleFactProfiles:${shop}`,
    clean(product.id),facts.cfpCollectionFactSource,raw,lifetime,budget,Number(profile.revision||0),profile.id,
    `collectionRuleFacts:${shop}:`,`collectionRuleFactHeads:${shop}:`,`collectionRuleFactBytes:${shop}:`);
  },
  async load(shop,profile,products,{signal}={}){
   const key=factStoreKeys(shop,profile.id)[0];
   const known=new Set(profile.conditions.map(c=>c.key));
   // Bound command/reply size without issuing an individual lookup per product.
   for(let offset=0;offset<products.length;offset+=1000){
    const rows=products.slice(offset,offset+1000),fields=rows.map(p=>clean(p.id)+':'+(p.cfpCollectionInputSource||'legacy'));
    signal?.throwIfAborted();
    const values=await redis.hmget(key,...fields);
    signal?.throwIfAborted();
    for(let i=0;i<rows.length;i++){
     const p=rows[i],source=p.cfpCollectionInputSource||'legacy';
     const value=readCollectionFactRecord(values[i],source,known);
     Object.assign(p,{cfpCollectionFactProfile:profile.id,cfpCollectionFactSource:source,cfpCollectionFactMatches:value.m,cfpCollectionFactImages:value.i});
    }
   }
  },
 };
}
