import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const start=source.indexOf('  function emptyFilterState()');
const end=source.indexOf('  parseURLState(); // Call immediately',start);
const clear=source.slice(source.indexOf('  function clearAllFilters()'),source.indexOf('  function clearGroupFilter('));
function fixture(url,{enabled=true,template='search'}={}){
 const listeners={},calls=[],writes=[],input={value:''},sidebar={dataset:{searchTerms:'stale theme query'}};
 const entries=[new URL(url,'https://fixture.test')];let cursor=0;
 const window={get location(){return entries[cursor];},cfpSearchSettings:{changeBrowserUrl:enabled},
  addEventListener:(name,fn)=>listeners[name]=fn,history:{state:{theme:'keep'},
   pushState(state,_title,url){writes.push({type:'push',url});entries.splice(++cursor);entries[cursor]=new URL(url,entries[cursor-1]);this.state=state;},
   replaceState(state,_title,url){writes.push({type:'replace',url});entries[cursor]=new URL(url,entries[cursor]);this.state=state;}}};
 const context={window,URLSearchParams,JSON,templateName:template,searchTerms:'stale theme query',sidebar,cfpLastSettings:null,
  document:{querySelector:selector=>selector.includes('input[name="q"]')?input:null,querySelectorAll:()=>[],getElementById:()=>null},
  syncCheckboxSelections(){},renderBreadcrumbs(){},updateActiveCountBadge(){},updateVerticalFilterSummary(){},cfpLastTotalCount:0,calls};
 vm.runInNewContext(source.slice(start,end)+clear+`
 function fetchAndRenderData(){syncStateToURL();calls.push({state:JSON.parse(JSON.stringify(activeFilters)),query:searchTerms});}
 parseURLState();syncStateToURL();
 this.api={state:()=>JSON.parse(JSON.stringify(activeFilters)),query:()=>searchTerms,
 facet:(key,values)=>{activeFilters.options[key]=values;activeFilters.page=1;fetchAndRenderData();},
 sort:selectSort,refresh:()=>fetchAndRenderData(),clear:clearAllFilters};`,context);
 return {...context,writes,calls,input,entries,back(){assert.ok(cursor>0);cursor--;listeners.popstate();},forward(){assert.ok(cursor<entries.length-1);cursor++;listeners.popstate();},restore(url){entries[cursor]=new URL(url,window.location);listeners.popstate();}};
}
const preview='?q=red+dress&preview_theme_id=12345&_fd=0&_sc=1&tracking=keep#results';
test('search filter and sort entries round-trip through Back/Forward without overwriting restored URLs or extra fetches',()=>{
 const f=fixture('/search'+preview);
 f.api.facet('Color',['Red']);f.api.sort('price-ascending');f.api.facet('Color',[]);
 assert.equal(f.entries.length,4);const written=f.writes.length,called=f.calls.length;
 f.back();assert.deepEqual(f.api.state().options.Color,['Red']);assert.equal(f.api.state().sortBy,'price-ascending');
 f.back();assert.deepEqual(f.api.state().options.Color,['Red']);assert.equal(f.api.state().sortBy,'relevance');
 f.back();assert.deepEqual(f.api.state().options,{});assert.equal(f.api.query(),'red dress');
 f.forward();f.forward();f.forward();assert.deepEqual(f.api.state().options,{});assert.equal(f.api.state().sortBy,'price-ascending');
 assert.equal(f.writes.length,written,'history navigation must not rewrite entries');
 assert.equal(f.calls.length-called,6,'one request per history navigation');
 for(const url of f.entries){assert.equal(url.searchParams.get('preview_theme_id'),'12345');assert.equal(url.searchParams.get('_fd'),'0');assert.equal(url.searchParams.get('_sc'),'1');assert.equal(url.searchParams.get('tracking'),'keep');assert.equal(url.hash,'#results');}
 assert.equal(f.window.history.state.theme,'keep');
});

test('refresh/direct links hydrate complete repeated state, punctuation and fractional prices; absent parameters reset all old facets',()=>{
 const params=new URLSearchParams({q:'blue dress',sort_by:'price-descending',page:'3',minPrice:'12.5',maxPrice:'99.95',preview_theme_id:'12345'});
 for(const [k,v]of [['options[Color][]','Blue, Silver'],['options[Color][]','Navy'],['metafields[custom.fabric][]','Silk, Satin'],['vendors[]','A, Inc'],['title[]','Dress, long'],['price[]','12.5:99.95'],['availability[]','in_stock'],['weight[]','0:10'],['rating[]','4:5'],['location[]','London'],['sale[]','10:20']])params.append(k,v);
 const f=fixture('/search?'+params);
 assert.equal(f.api.state().page,3);assert.equal(f.api.state().minPrice,12.5);assert.equal(f.api.state().maxPrice,99.95);
 assert.deepEqual(f.api.state().options.Color,['Blue, Silver','Navy']);assert.deepEqual(f.api.state().vendors,['A, Inc']);
 assert.deepEqual(f.api.state().metafields['custom.fabric'],['Silk, Satin']);assert.equal(f.input.value,'blue dress');
 const reloaded=fixture(f.window.location.href);assert.deepEqual(reloaded.api.state(),f.api.state());
 f.restore('/search?q=green+dress');
 const cleared=f.api.state();assert.equal(cleared.q,'green dress');assert.equal(f.api.query(),'green dress');assert.equal(f.input.value,'green dress');
 for(const key of ['vendors','types','tags','titles','collections','availability','priceRanges','weightRanges','ratingRanges','locations','saleRanges'])assert.deepEqual(cleared[key],[]);
 assert.deepEqual(cleared.options,{});assert.deepEqual(cleared.metafields,{});assert.equal(cleared.page,1);assert.equal(cleared.sortBy,'relevance');assert.equal(cleared.minPrice,0);assert.equal(cleared.maxPrice,999999);
 f.restore('/search');assert.equal(f.api.query(),'');assert.equal(f.input.value,'');assert.equal(f.calls.at(-1).query,'');
});

test('Clear all retains search query, sorting and draft parameters, and repeated fetches do not grow history',()=>{
 const f=fixture('/search'+preview);f.api.facet('Color',['Red']);f.api.sort('price-ascending');f.api.clear();
 assert.equal(f.api.state().q,'red dress');assert.equal(f.window.location.searchParams.get('q'),'red dress');assert.equal(f.api.state().sortBy,'price-ascending');assert.equal(f.window.location.searchParams.get('option_Color'),null);
 const count=f.writes.length;f.api.refresh();f.api.refresh();assert.equal(f.writes.length,count);
 assert.equal(f.window.location.searchParams.get('preview_theme_id'),'12345');
});

test('URL updates disabled remain respected, while supplied direct links still hydrate',()=>{
 const f=fixture('/search?q=red+dress&option_Color=Red',{enabled:false});const initial=f.window.location.href;
 f.api.facet('Size',['M']);f.api.sort('price-ascending');assert.equal(f.window.location.href,initial);assert.equal(f.writes.length,0);
 assert.deepEqual(f.api.state().options.Color,['Red']);
});

test('collection sort keeps its existing history behavior and one request',()=>{
 const f=fixture('/collections/dresses?preview_theme_id=12345',{template:'collection'});const writes=f.writes.length;
 f.api.sort('price-ascending');assert.equal(f.writes.slice(writes).filter(w=>w.type==='push').length,1);assert.equal(f.calls.length,1);
 assert.equal(f.window.location.searchParams.get('preview_theme_id'),'12345');
});
