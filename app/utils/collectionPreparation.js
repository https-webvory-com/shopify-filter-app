import { createHash } from 'node:crypto';
import {productRevisionKey,rankingDataRevisionKey} from './shopCacheInvalidation.js';
import {encodePreparation,decodePreparation} from './collectionPreparationPayload.js';

// Keep the last usable product-data version through idle periods. Explicit
// configuration revisions still invalidate it immediately.
export const preparationLifetime = 86400;
export const preparationFreshnessMs = 600000;
export const preparationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const warmupContextsKey = shop => `collectionWarmupContextsV2:${shop}`;
export const warmupShopsKey = 'collectionWarmupShopsV2';
export const publicPreparationLimit = 40;
export const publicRetentionLimit = 2048;
export const publicRetentionBytes = 64 * 1024 * 1024;
export const warmupRegistryLifetime = 7 * 86400;
const warmupParameters = new Set(['shop','locale','language','country','collectionHandle','collectionId','sortBy','page','limit','responseProfile']);
export function normalizeCollectionWarmup(shop, requestUrl, collectionId) {
  let url;try {url=new URL(requestUrl);} catch {return null;}
  const keys=[...url.searchParams.keys()];
  if (url.searchParams.get('shop')!==shop || url.searchParams.get('page')!=='1' ||
      new Set(keys).size!==keys.length || keys.some(key=>!warmupParameters.has(key))) return null;
  if (!url.searchParams.get('collectionId') && !url.searchParams.get('collectionHandle')) return null;
  const normalized=new URL('https://ranking.internal/api/filter');
  for (const [key,value] of url.searchParams) if (!['page','limit','responseProfile'].includes(key)) normalized.searchParams.set(key,value);
  const id=String(collectionId || '').split('/').pop();
  if (/^\d+$/.test(id)) {normalized.searchParams.delete('collectionHandle');normalized.searchParams.set('collectionId',id);}
  const sort=(normalized.searchParams.get('sortBy') || 'best-selling').toLowerCase().replaceAll('_','-');
  if (sort==='manual') return null;
  normalized.searchParams.set('sortBy',sort==='bestselling'?'best-selling':sort);
  normalized.searchParams.set('page','1');normalized.searchParams.set('limit','25');normalized.searchParams.sort();
  return {url:normalized.toString(),collectionId:id || 'all'};
}
export const publicRetentionKey = shop => `collectionPreparedRetention:${shop}`;
export const publicRetentionSizesKey = shop => `collectionPreparedRetention:${shop}:sizes`;
const retainPublic = `
local previous = redis.call('GET', KEYS[3])
redis.call('SETEX', KEYS[2], ARGV[1], ARGV[2])
redis.call('SETEX', KEYS[3], ARGV[1], KEYS[2])
if previous and previous ~= KEYS[2] then
  local suffix = string.sub(previous, string.len(ARGV[5])+1)
  if string.sub(previous, 1, string.len(ARGV[5])) == ARGV[5] and string.len(suffix) == 64 and string.match(suffix, '^%x+$') then
    redis.call('DEL', previous)
    redis.call('ZREM', KEYS[1], previous)
    redis.call('HDEL', KEYS[4], previous)
  end
end
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local score = tonumber(ARGV[3])
if latest[2] then score = math.max(score, tonumber(latest[2])+1) end
redis.call('ZADD', KEYS[1], score, KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[4], KEYS[2], string.len(ARGV[2]))
redis.call('EXPIRE', KEYS[4], ARGV[1])
-- Adopt records retained before byte accounting was introduced.
for _, key in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  if not redis.call('HGET', KEYS[4], key) then
    local old = redis.call('GET', key)
    if old then redis.call('HSET', KEYS[4], key, string.len(old))
    else redis.call('ZREM', KEYS[1], key) end
  end
end
local total = 0
for _, size in ipairs(redis.call('HVALS', KEYS[4])) do total = total + tonumber(size) end
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local remaining = #members
for _, key in ipairs(members) do
  if remaining <= tonumber(ARGV[4]) and total <= tonumber(ARGV[6]) then break end
  local suffix = string.sub(key, string.len(ARGV[5])+1)
  if string.sub(key, 1, string.len(ARGV[5])) == ARGV[5] and string.len(suffix) == 64 and string.match(suffix, '^%x+$') then
    redis.call('DEL', key)
  end
  total = total - tonumber(redis.call('HGET', KEYS[4], key) or '0')
  redis.call('HDEL', KEYS[4], key)
  redis.call('ZREM', KEYS[1], key)
  remaining = remaining - 1
end
return 1`;

function stable(value) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]),
  );
  return value;
}

export function preparationKey(spec) {
  const {productRevision, retainForIdle, orderUpdatedAt, ...identity}=spec;
  // Preparation ranks the complete set. Pagination and response projections
  // must not create separate scans or prevent a limit-25 warmup serving limit-50.
  if (identity.query) {
    const {limit,offset,attributesToRetrieve,attributesToHighlight,facets,...query}=identity.query;
    identity.query=query;
  }
  return `collectionPreparedSequence:${spec.shop}:background-v2:${createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex')}`;
}

// Only Shopify's order may differ. Filters, tenant, configuration, rules and
// customer context remain part of the identity of the last usable sequence.
export function preparationOrderFallbackKey(spec) {
  const {orderedIds, orderRevision, ...identity}=spec;
  return preparationKey(identity).replace(':background-v2:', ':last-order-v1:');
}

export function preparationReuseKey(spec,dataRevision='0:0') {
  const {revision,...inputs}=spec;
  // Database save timestamps do not participate in matching or scoring.
  const withoutSaveTime=value=>value?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='updatedAt')):value;
  const key=preparationKey({...inputs,rule:withoutSaveTime(spec.rule),globalSettings:withoutSaveTime(spec.globalSettings),reusableDataRevision:dataRevision});
  return key.replace(`collectionPreparedSequence:${spec.shop}:background-v2:`,`collectionPreparationReuse:${spec.shop}:`);
}
const retainReuse=`
redis.call('SETEX',KEYS[2],ARGV[2],ARGV[1])
redis.call('ZADD',KEYS[1],ARGV[3],KEYS[2]);redis.call('EXPIRE',KEYS[1],ARGV[2])
for _, key in ipairs(redis.call('ZRANGE',KEYS[1],0,-tonumber(ARGV[4])-1)) do
 local suffix=string.sub(key,string.len(ARGV[5])+1)
 if string.sub(key,1,string.len(ARGV[5]))==ARGV[5] and string.len(suffix)==64 and string.match(suffix,'^%x+$') then redis.call('DEL',key) end
 redis.call('ZREM',KEYS[1],key)
end
return 1`;

export function createCollectionPreparation({ redis, queue, prepare, prepareDirect, validateReuse=async()=>true, now = Date.now, observe = () => {}, retentionLimit=publicRetentionLimit, retentionBytes=publicRetentionBytes }) {
  const report = event => {try {observe(event);} catch { /* Diagnostics never affect availability. */ }};
  const valid = value => value && Array.isArray(value.ids) && value.ids.every(id=>typeof id==='string'&&id.length>0) &&
    new Set(value.ids).size===value.ids.length && value.metadata && typeof value.metadata==='object' && !Array.isArray(value.metadata);
  const revision = async shop => String(await redis.get(preparationRevisionKey(shop)) ?? '0');
  const productRevision = async (shop,collectionId) => String(await redis.get(productRevisionKey(shop,collectionId)) ?? '0');
  const reuseRevision = async spec => {
    const keys=[rankingDataRevisionKey(spec.shop),rankingDataRevisionKey(spec.shop,spec.collectionId)];
    // Includes and explicit pins can draw products from outside this collection.
    // A local membership counter alone cannot establish their freshness.
    if(spec.pinnedIds?.length||spec.rule?.conditions?.some(c=>c.action==='Include'))keys.push(productRevisionKey(spec.shop,'all'));
    return (await Promise.all(keys.map(key=>redis.get(key)))).map(value=>String(value??'0')).join(':');
  };
  const dataEpochMatches=async(spec,expected)=>{
    expected??='0:0';if(typeof expected!=='string')return false;
    return (await Promise.all([
      redis.get(rankingDataRevisionKey(spec.shop)),redis.get(rankingDataRevisionKey(spec.shop,spec.collectionId)),
    ])).map(value=>String(value??'0')).join(':')===expected.split(':').slice(0,2).join(':');
  };
  async function reusable(spec) {
    if(spec.retainForIdle!==true)return null;
    const dataRevision=await reuseRevision(spec);
    const alias=await redis.get(preparationReuseKey(spec,dataRevision));
    const prefix=`collectionPreparedSequence:${spec.shop}:background-v2:`;
    const candidates=[];
    if(typeof alias==='string'&&alias.startsWith(prefix)&&/^[a-f0-9]{64}$/.test(alias.slice(prefix.length)))candidates.push(alias);
    // Upgrade exact legacy records without scanning Redis or warming pages.
    // A bulk/membership invalidation disables this pre-versioned fallback.
    const epoch=Number(spec.revision);
    if(dataRevision==='0:0'&&Number.isSafeInteger(epoch)&&epoch>0)
      for(let prior=epoch-1;prior>=Math.max(0,epoch-16);prior--)candidates.push(preparationKey({...spec,revision:String(prior)}));
    for(const candidate of [...new Set(candidates)]){
      let value;try{value=decodePreparation(await redis.get(candidate));}catch{continue;}
      if(valid(value)&&value.reusableDataRevision!==null&&value.productRevision===spec.productRevision&&
          (value.reusableDataRevision??'0:0')===dataRevision&&Number.isFinite(value.preparedAt)&&
          now()-value.preparedAt<preparationLifetime*1000){
        try{if(await validateReuse(spec,value))return value;}catch(error){report({event:'compatible-validation-unavailable',shop:spec.shop,error:error.name});}
      }
    }
    return null;
  }
  const directPending=new Map(),directUnavailable=new Map();
  async function direct(key,spec,warmup){
    if(!prepareDirect||warmup||spec.retainForIdle!==true)return null;
    if(directPending.has(key))return directPending.get(key);
    // Keep exhaustive compact ID/fact sorting within the existing heap budget.
    if(directPending.size||now()<(directUnavailable.get(key)||0))return null;
    const task=(async()=>{
      try{
        const [startedRevision,startedDataRevision]=await Promise.all([
          productRevision(spec.shop,spec.collectionId),reuseRevision(spec),
        ]);
        const value=await prepareDirect(spec);
        if(!value){directUnavailable.set(key,now()+30000);return null;}
        const result=await publish(key,spec,value,startedRevision,{startedDataRevision});
        if(result.superseded)return null;
        if(result.refreshRequired)await schedule(key,spec,true);
        report({event:'direct-ready',shop:spec.shop,collectionId:spec.collectionId,key,products:value.ids.length});
        return {status:'ready',ids:value.ids,metadata:value.metadata};
      }catch(error){
        directUnavailable.set(key,now()+30000);
        report({event:'direct-unavailable',shop:spec.shop,collectionId:spec.collectionId,key,error:error.name});
        return null;
      }finally{
        if(directUnavailable.size>128)directUnavailable.delete(directUnavailable.keys().next().value);
        directPending.delete(key);
      }
    })();
    directPending.set(key,task);return task;
  }
  async function schedule(key, spec, warmup = false) {
    const priority = warmup ? 10 : 1;
    const jobId = `collection-ranking-${createHash('sha256').update(key).digest('hex')}`;
    let job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (!warmup && ['waiting','prioritized','delayed'].includes(state) && (job.priority ?? job.opts?.priority) > priority) {
        await job.changePriority({ priority });
      }
      if (state === 'failed' && now() - (job.finishedOn ?? 0) < 30000) return 'failed';
      if (state === 'completed' || state === 'failed') {
        try { await job.remove(); } catch(error) {
          // Another request may already have replaced or started this job.
          const current=await queue.getJob(jobId);
          if (current && ['completed','failed'].includes(await current.getState())) throw error;
        }
        job = await queue.getJob(jobId);
      }
    }
    if (!job) {
      await queue.add('COLLECTION_RANKING_PREPARE', { shop: spec.shop, key, spec, queuedAt:now() }, { jobId, priority });
      report({event:'queued',shop:spec.shop,collectionId:spec.collectionId,key,priority});
    }
    return 'pending';
  }
  async function get(spec, { warmup = false, precompute = false } = {}) {
    if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
    spec = {...spec, productRevision: await productRevision(spec.shop,spec.collectionId)};
    const key = preparationKey(spec);
    let raw = await redis.get(key);
    if(!raw&&spec.retainForIdle===true){
      const previous=await reusable(spec);
      if(previous){
        const result=await publish(key,spec,{ids:previous.ids,metadata:previous.metadata,sourceOutsideIds:previous.sourceOutsideIds},previous.productRevision,{
          sourcePreparedAt:previous.preparedAt,startedDataRevision:previous.reusableDataRevision??'0:0',
        });
        if(result.superseded)return {status:'pending'};
        raw=await redis.get(key);
        report({event:'compatible-reused',shop:spec.shop,collectionId:spec.collectionId,key});
      }
    }
    // A catalog job owns one complete build. Do not finish that job after only
    // adding another preparation job to the same worker's queue.
    if (warmup && precompute && spec.retainForIdle === true) {
      let cached;try { cached=decodePreparation(raw); } catch { /* Build missing/corrupt inputs. */ }
      if (!valid(cached) || cached.productRevision !== spec.productRevision ||
          !Number.isFinite(cached.preparedAt) || now()-cached.preparedAt >= preparationFreshnessMs-120000 ||
          await redis.ttl(key)<120 || !await dataEpochMatches(spec,cached.reusableDataRevision)) {
        const result=await process({key,spec,queuedAt:now()});
        if(result.superseded)return {status:'pending'};
      }
      return get(spec,{warmup:true});
    }
    if (raw) {
      let value;
      try { value=decodePreparation(raw); } catch { /* Rebuild corrupt cache entries. */ }
      if (!valid(value)) {
        report({event:'unavailable',reason:'corrupt',shop:spec.shop,collectionId:spec.collectionId,key});
        // The worker will replace this record. Avoid deleting a newly published
        // valid record if another worker completed after this read.
        return await direct(key,spec,warmup)||{status:await schedule(key,spec,warmup)};
      }
      if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
      if(spec.retainForIdle===true&&!await dataEpochMatches(spec,value.reusableDataRevision))
        return await direct(key,spec,warmup)||{status:await schedule(key,spec,warmup)};
      // Long idle retention must not extend the old ten-minute window for
      // known stock/product changes when a refresh worker is unavailable.
      if (spec.retainForIdle === true && value.productRevision !== spec.productRevision &&
          Number.isFinite(value.preparedAt) && now() - value.preparedAt >= preparationFreshnessMs) {
        report({event:'unavailable',reason:'changed-products',shop:spec.shop,collectionId:spec.collectionId,key,ageMs:now()-value.preparedAt});
        return await direct(key,spec,warmup)||{ status: await schedule(key, spec, warmup) };
      }
      // Refresh a valid version before expiry without holding up visitors.
      if (value.productRevision !== spec.productRevision || !Number.isFinite(value.preparedAt) ||
          now() - value.preparedAt >= preparationFreshnessMs - 120000 || await redis.ttl(key) < 120) {
        try { await schedule(key, spec, true); } catch { /* A usable version remains valid if refresh scheduling fails. */ }
      }
      if (spec.retainForIdle === true && spec.needsShopifyOrder) {
        // Adopt already prepared records on deployment too, without requiring
        // a rebuild before the last-order reuse path can become available.
        try { await redis.setex(preparationOrderFallbackKey(spec), preparationLifetime, key); } catch { /* Optional reuse must not block a usable current ranking. */ }
      }
      return { status: 'ready', ids: value.ids, metadata: value.metadata };
    }
    if (spec.retainForIdle === true && spec.needsShopifyOrder) {
      const previousKey = await redis.get(preparationOrderFallbackKey(spec));
      if (previousKey && previousKey !== key && previousKey.startsWith(`collectionPreparedSequence:${spec.shop}:background-v2:`)) {
        let previous;
        try { previous=decodePreparation(await redis.get(previousKey)); } catch { /* A missing/corrupt record needs a fresh build. */ }
        if (valid(previous) && previous.productRevision === spec.productRevision &&
            await dataEpochMatches(spec,previous.reusableDataRevision)&&
            Number.isFinite(previous.preparedAt) && now() - previous.preparedAt < preparationLifetime * 1000 &&
            await revision(spec.shop) === spec.revision) {
          try { await schedule(key, spec, true); } catch { /* The last complete version is still usable. */ }
          report({event:'last-order-reused',shop:spec.shop,collectionId:spec.collectionId,key,ageMs:now()-previous.preparedAt});
          return {status:'ready',ids:previous.ids,metadata:previous.metadata,orderUpdatedAt:previous.orderUpdatedAt ?? null,cacheKey:previousKey};
        }
      }
    }
    report({event:'unavailable',reason:'missing',shop:spec.shop,collectionId:spec.collectionId,key});
    return await direct(key,spec,warmup)||{ status: await schedule(key, spec, warmup) };
  }
  async function process({ key, spec, queuedAt }) {
    if (key !== preparationKey(spec)) throw Error('Invalid preparation identity');
    if (await revision(spec.shop) !== spec.revision) return { superseded: true };
    const startedAt=now();
    report({event:'build-started',shop:spec.shop,collectionId:spec.collectionId,key,queueWaitMs:Number.isFinite(queuedAt)?Math.max(0,startedAt-queuedAt):null});
    const [startedRevision,startedDataRevision]=await Promise.all([
      productRevision(spec.shop,spec.collectionId),spec.retainForIdle===true?reuseRevision(spec):null,
    ]);
    const value = await prepare(spec);
    const result=await publish(key,spec,value,startedRevision,{startedDataRevision});
    if(!result.superseded)report({event:'build-ready',shop:spec.shop,collectionId:spec.collectionId,key,buildMs:now()-startedAt,products:value.ids.length});
    return result;
  }
  async function publish(key,spec,value,startedRevision,{sourcePreparedAt,startedDataRevision}={}){
    if (!valid(value)) throw Error('Invalid prepared collection ranking');
    const dataRevision=spec.retainForIdle===true?startedDataRevision??await reuseRevision(spec):null;
    const dataEpochCurrent=async()=>dataRevision===null||(
      sourcePreparedAt!==undefined
        ? await reuseRevision(spec)===dataRevision&&await productRevision(spec.shop,spec.collectionId)===startedRevision
        : await dataEpochMatches(spec,dataRevision));
    // An admin save during the scan must never publish that outdated ranking.
    if (await revision(spec.shop) !== spec.revision || !await dataEpochCurrent()) return { superseded: true };
    // Only ordinary public collection contexts get long retention. Do not
    // multiply memory usage for arbitrary filters or customer-specific scans.
    const payload = encodePreparation({...value,productRevision:startedRevision,preparedAt:sourcePreparedAt??now(),orderUpdatedAt:spec.orderUpdatedAt,reusableDataRevision:dataRevision});
    if (spec.retainForIdle === true && typeof redis.eval === 'function') {
      // Replace this context's old order version only after the new one is complete.
      // This keeps obsolete orders from evicting other collections from the budget.
      // The script can delete only this shop's prepared keys, never queue/session keys.
      await redis.eval(retainPublic, 4, publicRetentionKey(spec.shop), key, preparationOrderFallbackKey(spec),publicRetentionSizesKey(spec.shop),
        preparationLifetime, payload, now(), retentionLimit, `collectionPreparedSequence:${spec.shop}:background-v2:`,retentionBytes);
    } else await redis.setex(key, spec.retainForIdle === true ? preparationLifetime : 600, payload);
    if (await revision(spec.shop) !== spec.revision || !await dataEpochCurrent()) { await redis.del(key); return { superseded: true }; }
    if(spec.retainForIdle===true)try{
      const alias=preparationReuseKey(spec,dataRevision);
      if(typeof redis.eval==='function')await redis.eval(retainReuse,2,`collectionPreparationReuseRetention:${spec.shop}`,alias,
        key,preparationLifetime,now(),retentionLimit,`collectionPreparationReuse:${spec.shop}:`);
      else await redis.setex(alias,preparationLifetime,key);
    }catch(error){report({event:'compatible-alias-unavailable',shop:spec.shop,error:error.name});}
    if (spec.retainForIdle === true && spec.needsShopifyOrder) {
      await redis.setex(preparationOrderFallbackKey(spec), preparationLifetime, key);
    }
    return { products: value.ids.length, refreshRequired: await productRevision(spec.shop,spec.collectionId) !== startedRevision };
  }
  // A current first-page sequence referencing a deleted/inactive product must
  // rebuild rather than repeatedly reissue the same broken browsing token.
  async function discard(spec, cacheKey = preparationKey(spec)) {
    // A returned last-order version must be discarded too if page hydration
    // detects deleted/inactive products. Other browsing sessions stay intact.
    const prefix=`collectionPreparedSequence:${spec.shop}:background-v2:`;
    if (!cacheKey.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(cacheKey.slice(prefix.length))) throw Error('Invalid preparation cache key');
    if(spec.retainForIdle===true){
      // Reject every older compatible copy, including other Shopify order
      // versions, after hydration detects an obsolete product.
      await redis.incr(rankingDataRevisionKey(spec.shop,spec.collectionId));
    }
    await redis.del(cacheKey);
  }
  return { revision, get, process, discard };
}
