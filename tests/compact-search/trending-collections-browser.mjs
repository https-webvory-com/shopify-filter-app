import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const {settings}=await(await fetch(origin+'/admin')).json();
 for(const [layout,column,width] of [['fullscreen','left',1440],['fullscreen','right',1440],['fullscreen','left',390],['compact','left',1440]]){
  assert.ok((await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',settings:JSON.stringify({...settings,instantLayout:layout,productColumn:column,collectionLimit:4})})})).ok);
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#cfp-main-search-input').waitFor({state:'attached'});
  await page.locator('header input').click();
  await page.waitForFunction(layout=>document.querySelector('.cfp-search-modal')?.dataset.cfpLayout===layout,layout);
  const verify=async(query='')=>{
   await page.locator('#cfp-search-collections a').first().waitFor({state:layout==='fullscreen'?'visible':'attached'});
   const state=await page.evaluate(()=>{
    const list=document.getElementById('cfp-search-collections'),heading=document.getElementById('cfp-collections-title'),grid=document.getElementById('cfp-search-products'),a=list.querySelector('a'),s=getComputedStyle(a);
    return {parent:list.parentElement.className,heading:heading.textContent,headingNext:heading.nextElementSibling===list,above:grid.getBoundingClientRect().top>=list.getBoundingClientRect().bottom,pill:{background:s.backgroundColor,border:s.borderTopWidth,padding:s.padding,lineHeight:s.lineHeight},links:[...list.querySelectorAll('a')].map(x=>x.getAttribute('href')),overflow:list.scrollWidth>list.clientWidth+1,wrap:getComputedStyle(list).flexWrap,titleClamp:getComputedStyle(grid.querySelector('.cfp-search-product-title')).webkitLineClamp};
   });
   assert.equal(state.links.length,4);assert.ok(state.links.every(x=>x.startsWith('/collections/')));
   assert.ok(state.headingNext);
   if(layout==='fullscreen'){
    assert.ok((await page.locator('.cfp-search-section-title').evaluateAll(nodes=>nodes.map(x=>getComputedStyle(x).color))).every(x=>x==='rgb(0, 0, 0)'),'all Full screen section headings match Windsor black');
    assert.equal(state.parent,'cfp-search-column-left');assert.equal(state.heading,query?'Collection results':'Trending collections');assert.ok(state.above);
    assert.equal(state.pill.background,'rgb(242, 241, 241)');assert.equal(state.pill.border,'0px');assert.equal(state.pill.padding,'8px 16px');assert.equal(state.pill.lineHeight,width<=768?'16px':'18px');if(width<=768)assert.equal(state.wrap,'nowrap');else assert.equal(state.overflow,false);assert.equal(state.titleClamp,'2');
   }else assert.equal(state.parent,'cfp-search-column-right');
  };
  await page.waitForFunction(()=>document.querySelector('#cfp-search-products .cfp-search-product-title'));
  await verify();
  await page.locator('#cfp-main-search-input').fill('dress');
  await page.locator('#cfp-view-all-results').waitFor();await verify('dress');
  if(layout==='fullscreen')await page.screenshot({path:`scratch/trending-collections-${column}-${width}.png`});
  assert.deepEqual(errors,[]);
  await page.close();console.log(`PASS ${layout} ${column} ${width}: collection placement, styling, links, search and product title preserved`);
 }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
