import {createHash,randomUUID} from 'node:crypto';
import redis from './redis.server.js';

// Country refreshes and product webhooks must not replace each other's variant
// price arrays in the shared index. The lease is renewed during Shopify reads.
export async function withProductPriceLock(shop,id,run){
 const key='product-price-lock:'+createHash('sha256').update(shop+':'+String(id).split('/').pop()).digest('hex'),owner=randomUUID();
 if(!await redis.set(key,owner,'PX',180000,'NX'))throw Error('Product price refresh busy; retry');
 let lost=false;
 const timer=setInterval(()=>{void redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],180000) end return 0",1,key,owner).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;});},30000);
 timer.unref?.();
 const assertOwned=async()=>{if(lost||await redis.get(key)!==owner)throw Error('Product price refresh lease lost; retry');};
 try{return await run(assertOwned);}finally{clearInterval(timer);await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,key,owner);}
}
