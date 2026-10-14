import assert from 'node:assert/strict';
import {db,shop,form,service,api,admin,state} from './layer.mjs';
const values = {intent:'create',query:'  SUMMER  dress ',placement:'grid',position:'2',heading:'Summer offer',isActive:'true'};
const request = q => ({request:new Request('https://fixture/api/search-banners?'+new URLSearchParams({shop,q}))});
try {
  await db.searchBanner.deleteMany({where:{shop}});
  await service.saveSearchBanner(shop,form(values));let row=await db.searchBanner.findFirst({where:{shop}});
  assert.equal(row.query,'summer dress');assert.equal((await(await api.loader(request('summer dress'))).json()).banners.length,1);
  assert.equal((await(await api.loader(request('Summer   Dress'))).json()).banners.length,1);
  assert.equal((await(await api.loader(request('summer dress sale'))).json()).banners.length,0);
  console.log('PASS actual migration, persisted normalized exact matching and public API');
  const other='other.myshopify.com';for(const intent of ['update','toggle','delete'])await assert.rejects(service.saveSearchBanner(other,form({...values,intent,id:row.id})));
  assert.equal((await service.getSearchBanners(other,'summer dress')).length,0);
  assert.equal((await db.searchBanner.findUnique({where:{id:row.id}})).heading,'Summer offer');
  console.log('PASS tenant isolation for reads and every mutation');
  const concurrent=await Promise.allSettled([1,2].map(()=>service.saveSearchBanner(shop,form({...values,position:'3'}))));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.reason?.code==='P2002').length,1);
  await assert.rejects(service.saveSearchBanner(shop,form({...values,intent:'update',id:row.id,position:'3'})),{code:'P2002'});
  assert.equal((await db.searchBanner.findUnique({where:{id:row.id}})).position,2);
  console.log('PASS concurrent duplicate protection and failed edit preserves campaign');
  await service.saveSearchBanner(shop,form({...values,intent:'update',id:row.id,placement:'top',imageUrl:'https://cdn.shopify.com/test.png'}));
  assert.equal((await service.getSearchBanners(shop,'summer dress'))[0].placement,'top');
  await service.saveSearchBanner(shop,form({intent:'toggle',id:row.id,isActive:'false'}));assert.equal((await service.getSearchBanners(shop,'summer dress')).some(b=>b.id===row.id),false);
  await service.saveSearchBanner(shop,form({intent:'toggle',id:row.id,isActive:'true'}));assert.equal((await service.getSearchBanners(shop,'summer dress')).some(b=>b.id===row.id),true);
  console.log('PASS edit, disable/enable and fresh reads');
  const response=await admin.action({request:new Request('https://fixture/admin',{method:'POST',body:form({...values,position:'3'})})});assert.match(response.error,/already/);
  const invalid=await admin.action({request:new Request('https://fixture/admin',{method:'POST',body:form({...values,heading:'',position:'9'})})});assert.match(invalid.error,/image, heading or content/);
  await db.$executeRawUnsafe('ALTER TABLE "SearchBanner" RENAME TO "SearchBannerFixtureFailure"');
  try { assert.deepEqual((await(await api.loader(request('summer dress'))).json()).banners,[]); }
  finally { await db.$executeRawUnsafe('ALTER TABLE "SearchBannerFixtureFailure" RENAME TO "SearchBanner"'); }
  await service.saveSearchBanner(shop,form({intent:'delete',id:row.id}));assert.equal(await db.searchBanner.findUnique({where:{id:row.id}}),null);
  console.log('PASS actual table failure fallback, admin validation and delete');
} finally { await db.searchBanner.deleteMany({where:{shop}}); await db.$disconnect(); }
