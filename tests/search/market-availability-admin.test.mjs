import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
const shop='fixture.myshopify.com';
async function route(overrides={}){
  return loadModule('app/routes/app.settings.market-availability.jsx',{
    react:{},'react-router':{},'@shopify/app-bridge-react':{},
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop},admin:{fixture:true}})}},
    '../db.server.js':{default:{marketStorefrontConnection:{findUnique:async({where,select})=>{
      assert.equal(where.shop,shop);assert.equal(select.accessToken,undefined);
      return {countries:['IN','US'],updatedAt:new Date()};
    }}}},
    '../services/marketAvailability.server.js':{connectMarketAvailability:async(tenant,admin)=>{
      assert.equal(tenant,shop);assert.equal(admin.fixture,true);return {countries:2};
    }},...overrides,
  });
}
test('country setup metadata is authenticated, store-scoped and excludes tokens',async()=>{
  const r=await route();const result=await r.loader({request:new Request('https://fixture/app?shop=foreign.myshopify.com')});
  assert.deepEqual(Object.keys(result.connection).sort(),['countries','updatedAt']);
});
test('country setup uses the authenticated store and returns only confirmation',async()=>{
  const r=await route();assert.equal((await r.action({request:new Request('https://fixture/app',{method:'POST'})})).success,true);
});
test('country setup does not expose database errors containing credentials',async()=>{
  const r=await route({'../services/marketAvailability.server.js':{connectMarketAvailability:async()=>{throw Error('Database invocation accessToken=private-test-token');}}});
  const response=await r.action({request:new Request('https://fixture/app',{method:'POST'})});
  assert.equal(response.status,400);assert.ok(!(await response.text()).includes('private-test-token'));
});

test('progress endpoint uses the authenticated tenant and prevents shared caching',async()=>{
  const r=await loadModule('app/routes/app.api.country-availability.jsx',{
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},
    '../services/marketAvailability.server.js':{getMarketAvailabilityProgress:async tenant=>{assert.equal(tenant,shop);return {countries:[{country:'IN',stockStatus:'pending',preparingCollections:[]}]};}},
  });
  const response=await r.loader({request:new Request('https://fixture/app/api/country-availability?shop=foreign.myshopify.com')});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await response.json()).countries[0].country,'IN');
});

test('progress failures return safe feedback instead of infrastructure details',async()=>{
  const r=await loadModule('app/routes/app.api.country-availability.jsx',{
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},
    '../services/marketAvailability.server.js':{getMarketAvailabilityProgress:async()=>{throw Error('private credentials');}},
  });
  const response=await r.loader({request:new Request('https://fixture/app/api/country-availability')});
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private credentials'));
});
