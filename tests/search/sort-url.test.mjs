import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('a shared sort_by URL restores sort on a new page and survives URL sync', async () => {
  const source = (await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8')).replace(/\r\n/g, '\n');
  const parse = source.slice(source.indexOf('  function parseURLState()'), source.indexOf('  function syncSortControls()'));
  const defaults = source.slice(source.indexOf('  function emptyFilterState()'),source.indexOf('  let activeFilters = emptyFilterState();'));
  const start = source.indexOf('  function syncStateToURL()');
  const sync = source.slice(start, source.indexOf('\n  }', start) + 4);
  for (const [path, defaultSort] of [['/collections/prom-dresses', 'best-selling'], ['/search', 'relevance']]) {
    const activeFilters = {options:{},metafields:{},page:1,sortBy:defaultSort,minPrice:0,maxPrice:999999};
    let saved;
    const context = {URLSearchParams,activeFilters,searchTerms:'',sidebar:null,document:{querySelector:()=>null},templateName:path==='/search'?'search':'collection',
      window:{location:{pathname:path,search:'?q=black+prom+dress&sort_by=price-ascending',hash:''},
        history:{replaceState:(_a,_b,url)=>{saved=url;}}}};
    vm.runInNewContext(defaults+'let searchHistoryState=null;'+parse+sync+'\nparseURLState();syncStateToURL();',context);
    assert.equal(activeFilters.sortBy,'price-ascending');
    assert.equal(new URL(saved||path+context.window.location.search,'http://fixture').searchParams.get('sort_by'),'price-ascending');
    assert.equal(new URL(saved||path+context.window.location.search,'http://fixture').searchParams.get('q'),'black prom dress');
  }
});
