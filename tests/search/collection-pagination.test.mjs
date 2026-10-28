import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const pagination=source.slice(source.indexOf('  function renderPagination('),source.indexOf('  function renderFilterSidebar('));

test('every pagination entry point withholds Load more for unknown totals and incomplete first pages',()=>{
  for(const [total,displayed]of [[null,25],[undefined,25],[NaN,25],[Infinity,25],[-1,25],[30,0],[30,5],[30,24]]){
    let created=0,removed=0;
    const context={PAGE_SIZE:25,browserCacheRendering:false,activeFilters:{page:1},document:{querySelector:()=>({remove(){removed++;}}),createElement(){created++;throw Error('Premature Load more');}}};
    vm.createContext(context);vm.runInContext(pagination,context);
    context.renderPagination({querySelectorAll:()=>Array(displayed)},total);
    assert.equal(created,0,`Unexpected button for total ${total}, cards ${displayed}`);
    assert.equal(removed,1,'An old button must also be removed');
  }
});

test('a complete first page enables exactly the next canonical page on shopper activation',()=>{
  let click,appended,fetches=0;
  const button={style:{},addEventListener(_type,callback){click=callback;}};
  const context={PAGE_SIZE:25,browserCacheRendering:false,activeFilters:{page:1},fetchAndRenderData(loadMore){assert.equal(loadMore,true);fetches++;},document:{querySelector:()=>null,createElement:()=>({style:{},querySelector:()=>button})}};
  vm.createContext(context);vm.runInContext(pagination,context);
  context.renderPagination({querySelectorAll:()=>Array(25),appendChild(node){appended=node;}},40);
  assert.ok(appended);assert.equal(fetches,0);
  click({target:button});assert.equal(context.activeFilters.page,2);assert.equal(fetches,1);
});
