import assert from 'node:assert/strict';
import {db,service,shop,form,api,state} from './layer.mjs';

try {
  await db.searchSuggestionBlacklist.deleteMany({where:{shop}});
  await service.saveSuggestionBlacklist(shop,form({intent:'create',term:' BLUE  DRESS ',operator:'exact',isActive:'true'}));
  const rule=await db.searchSuggestionBlacklist.findFirst({where:{shop}});
  assert.equal(rule.term,'blue dress');
  const request=()=>({request:new Request('https://fixture/api/search?'+new URLSearchParams({shop,q:'dress'}))});
  let result=await(await api.loader(request())).json();
  assert.ok(!result.suggestions.includes('Blue Dress'));assert.ok(result.suggestions.includes('Blue Dress Sale'));assert.equal(result.products.length,4);
  console.log('PASS PostgreSQL normalized exact rule filters real search API suggestions only');
  await service.saveSuggestionBlacklist(shop,form({intent:'update',id:rule.id,term:'blue dress',operator:'contains',isActive:'true'}));
  result=await(await api.loader(request())).json();
  assert.ok(!result.suggestions.some(value=>value.startsWith('Blue Dress')));assert.equal(result.products.length,4);
  await service.saveSuggestionBlacklist(shop,form({intent:'toggle',id:rule.id,isActive:'false'}));
  assert.ok((await(await api.loader(request())).json()).suggestions.includes('Blue Dress'));
  await service.saveSuggestionBlacklist(shop,form({intent:'toggle',id:rule.id,isActive:'true'}));
  assert.ok(!(await(await api.loader(request())).json()).suggestions.includes('Blue Dress'));
  console.log('PASS PostgreSQL edit and enable/disable are visible on the next search');
  const concurrent=await Promise.allSettled([1,2].map(()=>service.saveSuggestionBlacklist(shop,form({intent:'create',term:'sale',operator:'contains',isActive:'true'}))));
  assert.equal(concurrent.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(concurrent.filter(value=>value.status==='rejected'&&value.reason.code==='P2002').length,1);
  await assert.rejects(service.saveSuggestionBlacklist(shop,form({intent:'update',id:rule.id,term:'sale',operator:'contains',isActive:'true'})),{code:'P2002'});
  assert.equal((await db.searchSuggestionBlacklist.findUnique({where:{id:rule.id}})).term,'blue dress');
  console.log('PASS PostgreSQL concurrent duplicate protection and atomic failed edit');
  const other='other.myshopify.com';
  assert.equal((await service.getActiveSuggestionBlacklist(other)).length,0);
  for(const intent of ['update','toggle','delete'])await assert.rejects(service.saveSuggestionBlacklist(other,form({intent,id:rule.id,term:'changed',operator:'exact',isActive:'true'})));
  assert.equal((await db.searchSuggestionBlacklist.findUnique({where:{id:rule.id}})).term,'blue dress');
  console.log('PASS PostgreSQL store isolation for reads and all write actions');
  state.failRules=true;result=await(await api.loader(request())).json();assert.deepEqual(result.suggestions,[]);assert.equal(result.products.length,4);state.failRules=false;
  await service.saveSuggestionBlacklist(shop,form({intent:'delete',id:rule.id}));assert.equal(await db.searchSuggestionBlacklist.findUnique({where:{id:rule.id}}),null);
  console.log('PASS PostgreSQL failure fallback preserves products and delete persists');
} finally {
  await db.searchSuggestionBlacklist.deleteMany({where:{shop}});
  await db.$disconnect();
}
