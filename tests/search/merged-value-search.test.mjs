import test from 'node:test';
import assert from 'node:assert/strict';
import {createMergedValueSearchIndex} from '../../app/utils/mergedValueSearch.js';

const rules=Array.from({length:45},(_,index)=>({id:String(index),filterKey:index===0?'Burgundy shades':`Group ${index}`,
  targetValue:index===0?'Burgundy':`Target ${index}`,filterType:index===0?'color':'size',sourceValues:index===0?['Burgandy','Dark Wine']:['Size '+index],
  createdAt:new Date(Date.UTC(2026,0,index+1)).toISOString(),isActive:index!==0}));

test('every prefix matches across all saved pages, titles, targets, types and raw aliases without case sensitivity',()=>{
 const search=createMergedValueSearchIndex(rules);
 assert.equal(search().rules.some(rule=>rule.id==='0'),false,'the match begins outside the first page');
 for(const query of ['b','bu','bur','burg','burga','burgan','burgand','burgandy','BURGUNDY SHADES',' dark wine ','CoLoR',' ＢＵＲＧＵＮＤＹ ']){
  const result=search({query}); assert.deepEqual(result.rules.map(rule=>rule.id),['0'],query);assert.equal(result.pagination.totalItems,1);
 }
 assert.equal(search({query:'nothing matches'}).rules.length,0);
 assert.equal(search({query:'<img>'}).rules.length,0);
 assert.equal(search({query:''}).pagination.totalItems,45);
 assert.equal(search({query:'  '}).pagination.totalItems,45);
});

test('paging and sorting apply to the complete filtered list and clamp after a result set shrinks',()=>{
 const search=createMergedValueSearchIndex(rules);
 assert.equal(search().rules[0].id,'44'); assert.equal(search({sort:'oldest'}).rules[0].id,'0');
 assert.equal(search({page:3}).rules.length,5);assert.equal(search({page:3}).pagination.totalPages,3);
 assert.equal(search({query:'Burgundy',page:3}).pagination.currentPage,1);
 assert.equal(search({query:'nothing',page:99}).pagination.currentPage,1);
 assert.equal(search({page:'bad'}).pagination.currentPage,1);
 assert.equal(rules[0].id,'0','search never reorders or edits saved rules');
});

test('fresh loader snapshots replace renamed or deleted entries without retaining stale search matches',()=>{
 const before=createMergedValueSearchIndex(rules);assert.equal(before({query:'Burgundy shades'}).rules.length,1);
 const updated=rules.map(rule=>rule.id==='0'?{...rule,filterKey:'Updated title'}:rule);
 const after=createMergedValueSearchIndex(updated);assert.equal(after({query:'Burgundy shades'}).rules.length,0);assert.equal(after({query:'Updated title'}).rules.length,1);
 assert.equal(createMergedValueSearchIndex(updated.slice(1))({query:'Updated title'}).rules.length,0);
});
