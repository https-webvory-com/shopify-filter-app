import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as helpers from '../../app/utils/searchBanner.js';
import { normalizeRedirectQuery } from '../../app/utils/searchRedirect.js';

export const form = values => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
export const valid = { intent: 'create', query: '  Summer  DRESS ', placement: 'grid', position: '2', heading: 'Sale', isActive: 'true' };
export async function load(file, mocks) {
  const code = (await transform(await fs.readFile(file, 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const ctx = { module: { exports: {} }, exports: {}, URL, Response, console: { error() {} }, require: name => { if (!(name in mocks)) throw Error('Unexpected import ' + name); return mocks[name]; } };
  vm.runInNewContext(code, ctx); return ctx.module.exports;
}
test('banner validation normalizes exact query and supports image or text grid and image top', () => {
  const b = helpers.validateSearchBanner(form(valid)); assert.equal(b.query, 'summer dress'); assert.equal(b.position, 2); assert.equal(b.imageUrl, '');
  assert.equal(helpers.validateSearchBanner(form({ ...valid, placement: 'top', imageUrl: 'https://cdn.shopify.com/test.png' })).position, 1);
  assert.equal(helpers.validateSearchBanner(form({ ...valid, query: 'ＳＡＬＥ', targetUrl: '/search?q=dress' })).query, 'sale');
});
test('invalid banner forms cannot save empty campaigns, invalid positions, controls, colors or orphan buttons', () => {
  for (const change of [{query:''},{query:'x'.repeat(201)},{placement:'popup'},{position:0},{position:'2.5'},{position:'Infinity'},{position:10001},{heading:'',content:''},{placement:'top',imageUrl:''},{buttonLabel:'Shop'},{backgroundColor:'red'},{textColor:'#fff'},{heading:'hi\u0000'}]) assert.throws(() => helpers.validateSearchBanner(form({ ...valid, ...change })), helpers.BannerValidationError);
});
test('banner URLs reject executable, credentialed and disguised authority URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', '//evil.test', '/\\evil.test', 'https://u:p@evil.test/a', 'http://cdn.test/x', '/%5cevil', '/x%0a', 'https://cdn.test/a b']) assert.throws(() => helpers.validateBannerUrl(value), helpers.BannerValidationError);
  assert.throws(() => helpers.validateBannerUrl('/image.png', true)); assert.equal(helpers.validateBannerUrl('https://cdn.test/a?x=1&y=2', true), 'https://cdn.test/a?x=1&y=2');
});
test('banner service scopes every read and write, validates before persistence, and keeps products independent', async () => {
  const calls = [];
  const model = Object.fromEntries(['create','update','updateMany','deleteMany','findMany'].map(method => [method, async arg => {calls.push({method,arg});return method==='findMany'?[]:{count:arg.where?.shop==='other'?0:1};}]));
  const service = await load('app/services/searchBanner.server.js', {'../db.server':{__esModule:true,default:{searchBanner:model}},'../utils/searchBanner.js':helpers,'../utils/searchRedirect.js':{normalizeRedirectQuery}});
  await service.saveSearchBanner('fixture', form(valid)); assert.equal(calls[0].arg.data.shop,'fixture');
  for(const intent of ['update','toggle','delete']) {await service.saveSearchBanner('fixture',form({...valid,intent,id:'id'}));assert.equal(calls.at(-1).arg.where.shop,'fixture');}
  for(const intent of ['toggle','delete']) await assert.rejects(service.saveSearchBanner('other',form({...valid,intent,id:'id'})));
  const count=calls.length;await assert.rejects(service.saveSearchBanner('fixture',form({...valid,position:0})));assert.equal(calls.length,count);
  await service.getSearchBanners('fixture',' SUMMER   DRESS ');assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).arg.where)),{shop:'fixture',query:'summer dress',isActive:true});
  assert.equal((await service.getSearchBanners('fixture','')).length,0);
});
test('public banner lookup validates shop/rate limits, reads fresh, and falls back without search dependencies', async () => {
  let fail=false, allowed=true, calls=0;
  const api=await load('app/routes/api.search-banners.jsx',{'react-router':{data:(v,i)=>Response.json(v,i)},'../services/searchBanner.server.js':{getSearchBanners:async()=>{calls++;if(fail)throw Error('Database');return [{id:String(calls)}];}},'../services/rateLimiter.server':{rateLimit:async()=>allowed}});
  const request=shop=>({request:new Request('https://fixture/api/search-banners?'+new URLSearchParams({shop,q:'dress'}))});
  assert.equal((await api.loader(request('bad'))).status,400);assert.equal(calls,0);
  const first=await api.loader(request('fixture.myshopify.com'));assert.equal(first.headers.get('cache-control'),'no-store');assert.equal((await first.json()).banners[0].id,'1');
  assert.equal((await (await api.loader(request('fixture.myshopify.com'))).json()).banners[0].id,'2');
  fail=true;assert.deepEqual((await (await api.loader(request('fixture.myshopify.com'))).json()).banners,[]);
  allowed=false;assert.equal((await api.loader(request('fixture.myshopify.com'))).status,429);
});
