import test from 'node:test';
import assert from 'node:assert/strict';
import {readMarketAvailability,availabilityVersion,marketIdsFilter,marketRankingFingerprint,storefrontQuery} from '../../app/utils/marketAvailability.js';
const shop='fixture.myshopify.com';
const product=(id,availableForSale)=>({id:'gid://shopify/Product/'+id,availableForSale});
test('country stock differs independently of the global in-stock preference',async()=>{
  const query=async(_s,_t,_q,{country})=>({localization:{country:{isoCode:country}},products:{nodes:[product('1',country==='US'),product('2',true),product('3',false)],pageInfo:{hasNextPage:false}}});
  assert.deepEqual(await readMarketAvailability({shop,country:'IN',token:'test'},query),['2']);
  assert.deepEqual(await readMarketAvailability({shop,country:'US',token:'test'},query),['1','2']);
  assert.deepEqual(await readMarketAvailability({shop,country:'GB',token:'test'},query),['2']);
});
test('background country scan includes every page and excludes unpublished/unavailable products',async()=>{
  const cursors=[];
  const ids=await readMarketAvailability({shop,country:'CA',token:'test'},async(_s,_t,_q,{after,country})=>{
    cursors.push(after);return {localization:{country:{isoCode:country}},products:{nodes:after?[product('3',true)]:[product('1',true),product('2',false)],pageInfo:{hasNextPage:!after,endCursor:after?null:'next'}}};
  });
  assert.deepEqual(ids,['1','3']);assert.deepEqual(cursors,[null,'next']);
});
test('inventory delta adds newly sellable products, removes sold out/deleted products and preserves unrelated products',async()=>{
  let calls=0;
  const ids=await readMarketAvailability({shop,country:'IN',token:'test',previousIds:['1','2','3','5'],changedIds:['1','2','4']},async(_s,_t,_q,{ids,country})=>{
    calls++;assert.deepEqual(ids,['1','2','4'].map(id=>'gid://shopify/Product/'+id));
    return {localization:{country:{isoCode:country}},nodes:[product('1',false),null,product('4',true)]};
  });assert.deepEqual(ids,['3','4','5']);assert.equal(calls,1);
});
for(const failure of ['country','duplicate','cursor','missing availability'])test(`country scan rejects ${failure} instead of publishing incomplete eligibility`,async()=>{
  await assert.rejects(readMarketAvailability({shop,country:'IN',token:'test'},async()=>({localization:{country:{isoCode:failure==='country'?'US':'IN'}},products:{nodes:failure==='duplicate'?[product('1',true),product('1',true)]:failure==='missing availability'?[{id:'gid://shopify/Product/1'}]:[product('1',true)],pageInfo:{hasNextPage:failure==='cursor',endCursor:null}}})),/country|Incomplete|pagination/);
});
test('delta verifies Shopify node identity and never borrows another country',async()=>{
  await assert.rejects(readMarketAvailability({shop,country:'IN',token:'test',previousIds:['1'],changedIds:['1']},async()=>({localization:{country:{isoCode:'IN'}},nodes:[product('2',true)]})),/product mismatch/);
});
test('stock proof is stable for unchanged eligibility and sessions bind to the country version',()=>{
  assert.equal(availabilityVersion(['2','1']),availabilityVersion(['1','2']));
  assert.notEqual(availabilityVersion(['1']),availabilityVersion(['1','2']));
  assert.notEqual(marketRankingFingerprint('request','a'),marketRankingFingerprint('request','b'));
  assert.equal(marketIdsFilter([]),'id IN ["0"]');assert.equal(marketRankingFingerprint('request',null),'request');
});
test('Shopify failures and GraphQL errors cannot become empty successful stock results',async()=>{
  await assert.rejects(storefrontQuery(shop,'test','query',{},async()=>({ok:false})),/unavailable/);
  await assert.rejects(storefrontQuery(shop,'test','query',{},async()=>({ok:true,json:async()=>({data:{},errors:[{message:'locked'}]})})),/verified/);
});
