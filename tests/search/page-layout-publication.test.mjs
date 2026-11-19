import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';

async function fixture(saved=null,fail=false){
  const calls=[];
  const admin={graphql:async(query,options)=>{
    calls.push({query,options});
    if(query.includes('query PageLayoutInstallation'))return Response.json({data:{currentAppInstallation:{id:'gid://shopify/AppInstallation/7',metafield:saved}}});
    return Response.json({data:{metafieldsSet:{userErrors:fail?[{message:'conflict'}]:[]}}});
  }};
  const service=await loadModule('app/services/pageLayoutPublication.server.js',{'../shopify.server.js':{unauthenticated:{admin:async()=>({admin})}}});
  return {...service,calls};
}
test('initial HTML spacing publishes only normalized public values and uses installation ownership',async()=>{
  const f=await fixture();
  const settings={integrations:{collectionPageWidth:'custom',collectionSideSpacing:0,mobileCollectionSideSpacing:12},secret:'excluded'};
  await f.publishPageLayout('one.myshopify.com',settings);
  const value=f.calls[1].options.variables.metafields[0];
  assert.equal(value.ownerId,'gid://shopify/AppInstallation/7');assert.equal(value.compareDigest,null);
  assert.equal(value.type,'json');assert.deepEqual(JSON.parse(value.value),{collectionPageWidth:'custom',collectionSideSpacing:0,mobileCollectionSideSpacing:12});
  await f.publishPageLayout('one.myshopify.com',settings);assert.equal(f.calls.length,2);
  await f.publishPageLayout('two.myshopify.com',settings);assert.equal(f.calls.length,4);
});
test('existing identical layout avoids writes, changed layout uses a conditional update, theme reset is explicit',async()=>{
  const theme={collectionPageWidth:'theme',collectionSideSpacing:24,mobileCollectionSideSpacing:16};
  const f=await fixture({value:JSON.stringify(theme),compareDigest:'saved-digest'});
  await f.publishPageLayout('one.myshopify.com',theme);assert.equal(f.calls.length,1);
  await f.publishPageLayout('one.myshopify.com',{...theme,collectionPageWidth:'custom'},{force:true});
  assert.equal(f.calls[2].options.variables.metafields[0].compareDigest,'saved-digest');
  const g=await fixture({value:'{}',compareDigest:'old'});
  await g.publishPageLayout('one.myshopify.com',theme);
  assert.equal(JSON.parse(g.calls[1].options.variables.metafields[0].value).collectionPageWidth,'theme');
});
test('publication failure is not cached or reported as success',async()=>{
  const f=await fixture(null,true);
  await assert.rejects(f.publishPageLayout('one.myshopify.com',{}),/Unable to publish/);
  await assert.rejects(f.publishPageLayout('one.myshopify.com',{}),/Unable to publish/);
  assert.equal(f.calls.length,4);
});
test('General save reports initial layout publication failure and can retry without a catalog sync',async()=>{
  let publications=0,writes=0;
  const route=await loadModule('app/routes/app.settings.general.jsx',{
    'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
    '../db.server.js':{default:{}},'../services/marketAvailability.server.js':{},
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'one.myshopify.com'},admin:{}})}},
    '../services/filterSettings.server':{updateFilterGlobalSettings:async(_shop,payload)=>{writes++;return payload;}},
    '../services/pageLayoutPublication.server.js':{publishPageLayout:async()=>{if(++publications===1)throw Error('temporarily unavailable');}},
  });
  const request=()=>new Request('https://fixture/app',{method:'POST',body:new URLSearchParams({collectionPageWidth:'custom',collectionSideSpacing:'32',mobileCollectionSideSpacing:'8'})});
  const failed=await route.action({request:request()});assert.equal(failed.status,502);assert.equal((await failed.json()).success,false);
  const retried=await route.action({request:request()});assert.equal(retried.status,200);assert.equal((await retried.json()).success,true);
  assert.equal(writes,2);assert.equal(publications,2);
});
