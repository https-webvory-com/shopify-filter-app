import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEARCH_SETTINGS, validateSearchSettings } from '../../app/utils/searchSettings.js';
import { requiresCustomSearchIndex } from '../../app/utils/searchConfiguration.js';

const child = { id:'gid://shopify/Collection/2', title:'Cocktail', handle:'cocktail', image:'https://cdn.shopify.com/cocktail.jpg' };
const main = { id:'gid://shopify/Collection/1', title:'Women', handle:'women', image:'', groups:[{title:'Top Searches',collections:[child]}] };
const settings = patch => validateSearchSettings({...DEFAULT_SEARCH_SETTINGS,...patch});

test('compact UI saves four ordered main collections and related collections without changing search configuration', () => {
  const compactCollections = Array.from({length:4},(_,i)=>({...main,id:`gid://shopify/Collection/${i+10}`,handle:'main-'+i}));
  const saved = settings({instantLayout:'compact',compactCollections});
  assert.deepEqual(saved.compactCollections,compactCollections);
  assert.deepEqual(settings(JSON.parse(JSON.stringify(saved))),saved);
  assert.equal(requiresCustomSearchIndex(saved),false);
  assert.equal(settings({instantLayout:'fullscreen',compactCollections}).compactCollections.length,4);
  const legacy = {...DEFAULT_SEARCH_SETTINGS}; delete legacy.compactCollections;
  assert.deepEqual(validateSearchSettings(legacy).compactCollections,[]);
  assert.equal(validateSearchSettings(legacy).instantLayout,'fullscreen');
});

test('compact collection settings reject oversized groups, duplicate tabs and unsafe links', () => {
  for (const value of [null,{},Array(5).fill(main),[main,main],[{...main,handle:'../search'}],[{...main,title:''}],[{...main,image:'javascript:alert(1)'}],[{...main,image:'https://name:pass@example.com/x'}],[{...main,id:'gid://shopify/Product/1'}],[{...main,groups:Array(4).fill(main.groups[0])}],[{...main,groups:[{title:'Top',collections:Array(13).fill(child)}]}],[{...main,groups:[{title:'Top',collections:[child,child]}]}]]) {
    if (value === null) assert.throws(()=>settings({compactCollections:[value]}));
    else assert.throws(()=>settings({compactCollections:value}));
  }
});
