import {createHash} from 'node:crypto';
import {productRankingFingerprint} from './shopCacheInvalidation.js';
import {collectionConfiguration, visibleCollectionFacets} from './collectionBootstrap.js';
import {normalizeManualFacetFilter} from './manualFacetValues.js';

export const collectionPageFingerprint = products => products.every(p => p.shop && String(p.status).toUpperCase() === 'ACTIVE') ? productRankingFingerprint(products) : null;

// Transport-only encoding: decode restores every metadata field and its order.
// Product records, counts, eligibility and ranking tokens are never projected.
export function encodeCollectionMetadata(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      const columns = Object.keys(value[0]);
      if (value.every(row => JSON.stringify(Object.keys(row)) === JSON.stringify(columns)))
        return ['t', columns, value.map(row => columns.map(key => encodeCollectionMetadata(row[key])))];
    }
    return ['a', value.map(encodeCollectionMetadata)];
  }
  const columns = Object.keys(value);
  return ['o', columns, columns.map(key => encodeCollectionMetadata(value[key]))];
}

export function packCollectionResponse(payload, {profile='collection-v1'} = {}) {
  const normalized = JSON.parse(JSON.stringify(payload));
  if(Array.isArray(normalized.settings))normalized.settings=normalized.settings.map(normalizeManualFacetFilter);
  if (profile === 'collection-v2') {
    const {version} = collectionConfiguration(normalized);
    const facets = visibleCollectionFacets(normalized.facets, normalized.settings);
    const {settings,mergedValues,globalSettings,facets:originalFacets,...rest} = normalized;
    return {...rest,cfpConfiguration:{version},cfpTransport:{version:1,metadata:encodeCollectionMetadata({facets})}};
  }
  const {settings, mergedValues, facets, ...rest} = normalized;
  const metadata = Object.fromEntries(Object.entries({settings, mergedValues, facets}).filter(([key]) => Object.hasOwn(normalized, key)));
  return {...rest, cfpTransport: {version: 1, metadata: encodeCollectionMetadata(metadata)}};
}

const publicKeys = new Set(['shop','collectionId','collectionHandle','locale','language','country','sortBy','page','limit','responseProfile']);
export function isPublicCollectionResponse(request) {
  const url = new URL(request.url), keys = [...url.searchParams.keys()];
  return request.method === 'GET' && ['collection-v1','collection-v2','collection-config-v1'].includes(url.searchParams.get('responseProfile')) &&
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(url.searchParams.get('shop') || '') &&
    !!url.searchParams.get('country') && !!(url.searchParams.get('locale') || url.searchParams.get('language')) &&
    !!(url.searchParams.get('collectionId') || url.searchParams.get('collectionHandle')) &&
    !['search','all'].includes(url.searchParams.get('collectionHandle')) &&
    url.searchParams.get('page') === '1' && new Set(keys).size === keys.length && keys.every(key => publicKeys.has(key));
}

export function createCollectionResponseCache({readRevision, now = Date.now, ttlMs = 15000, maxEntries = 16, maxBytes = 8 * 1024 * 1024, maxEntryBytes = 1024 * 1024, revisionTimeoutMs = 250}) {
  const entries = new Map();let bytes = 0;
  const remove = key => {const entry = entries.get(key);if (entry) bytes -= entry.bytes;entries.delete(key);};
  async function revision(shop) {
    let timer;
    try {return await Promise.race([readRevision(shop), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Response revision unavailable')), revisionTimeoutMs);})]);}
    finally {clearTimeout(timer);}
  }
  const headers = (cacheable, etag, state) => ({'Content-Type':'application/json; charset=utf-8','Cache-Control':cacheable?'private, no-cache, must-revalidate':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, If-None-Match','Access-Control-Expose-Headers':'ETag, X-CFP-Collection-Response',...(etag?{ETag:etag}:{}),'X-CFP-Collection-Response':state});
  const respond = (request, entry, cacheable, state) => {
    const h = headers(cacheable, cacheable?entry.etag:null, state);
    if (cacheable && request.headers.get('If-None-Match')?.split(',').map(v=>v.trim().replace(/^W\//,'')).includes(entry.etag))
      return new Response(null,{status:304,headers:h});
    return new Response(entry.text,{status:200,headers:h});
  };
  async function begin({request, shop, configurationRevision, rankingToken, validate}) {
    let state = null, key = null;
    if (isPublicCollectionResponse(request) && rankingToken) {
      try {
        state = await revision(shop);
        if (String(state[0]) !== String(configurationRevision)) state = null;
        if (state) {const url = new URL(request.url);url.searchParams.sort();key = createHash('sha256').update(JSON.stringify([url.pathname,url.searchParams.toString(),rankingToken,state])).digest('hex');}
      } catch {state = null;}
    }
    const old = key && entries.get(key);
    if (old && now() - old.at < ttlMs) {
      let stillCurrent = false;
      try {stillCurrent = JSON.stringify(await revision(shop)) === JSON.stringify(state);} catch {}
      if (stillCurrent && validate) {
        try {stillCurrent = !!old.validationFingerprint && await validate(old.validationFingerprint);}
        catch(error) {remove(key);throw error;}
        if (stillCurrent) {try {stillCurrent = JSON.stringify(await revision(shop)) === JSON.stringify(state);} catch {stillCurrent = false;}}
      }
      if (stillCurrent) {
        entries.delete(key);entries.set(key, old);
        return {response: respond(request, old, true, 'hit')};
      }
      remove(key);state = null;key = null;
    }
    if (old) remove(key);
    return {async finish(payload, validationFingerprint = null) {
      const text = JSON.stringify(packCollectionResponse(payload,{profile:isPublicCollectionResponse(request)?new URL(request.url).searchParams.get('responseProfile'):'collection-v1'}));
      const entry = {text, etag:'"'+createHash('sha256').update(text).digest('hex')+'"', bytes:Buffer.byteLength(text), at:now(), validationFingerprint};
      let cacheable = false;
      if (state && key && (!validate || validationFingerprint)) {
        try {cacheable = JSON.stringify(await revision(shop)) === JSON.stringify(state);} catch {}
      }
      if (cacheable && entry.bytes <= Math.min(maxEntryBytes, maxBytes)) {
        remove(key);entries.set(key, entry);bytes += entry.bytes;
        while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
      }
      return respond(request, entry, cacheable, cacheable?'miss':'bypass');
    }};
  }
  return {begin, clear:()=>{entries.clear();bytes=0;}, stats:()=>({entries:entries.size,bytes})};
}
