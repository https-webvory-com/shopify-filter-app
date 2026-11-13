import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const requests=[];page.on('request',r=>{const u=new URL(r.url());if(['/api/search','/api/search-settings','/search/suggest.json','/collections.json'].includes(u.pathname))requests.push({path:u.pathname,q:u.searchParams.get('q')});});
const type=async text=>{await page.locator('#cfp-main-search-input').fill(text);await page.waitForTimeout(400);};
try{
  for(const layout of ['fullscreen','compact'])for(const minimum of [5,3]){
    const {settings}=await(await fetch(origin+'/admin')).json();
    const result=await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',settings:JSON.stringify({...settings,instantLayout:layout,minChars:minimum,showPages:true,pageLimit:3})})});assert.ok(result.ok);
    await page.goto(origin);await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
    await page.locator('.cfp-search-modal.cfp-open').waitFor();await page.waitForFunction(()=>document.querySelector('#cfp-search-products [href]')&&document.querySelector('#cfp-search-products').getAttribute('aria-busy')==='false');
    await page.waitForTimeout(400);const baseline=requests.length;
    await page.evaluate(()=>{window.minimumMutations=[];const ids=['cfp-search-body','cfp-search-products','cfp-search-collections','cfp-compact-browse','cfp-compact-tabs'];window.minimumObserver=new MutationObserver(rows=>minimumMutations.push(...rows.filter(r=>r.type==='childList'||ids.includes(r.target.id)).map(r=>r.type+':'+r.target.id)));for(const id of ids){const el=document.getElementById(id);if(el)minimumObserver.observe(el,{attributes:true,childList:true,subtree:true});}});
    for(let length=1;length<minimum;length++){await type('dress'.slice(0,length));assert.equal(requests.length,baseline,layout+' requested below minimum');assert.deepEqual(await page.evaluate(()=>minimumMutations),[],layout+' repainted below minimum');}
    const query='dress'.slice(0,minimum);
    await page.evaluate(()=>minimumObserver.disconnect());await type(query);await page.waitForFunction(()=>document.getElementById('cfp-view-all-results')?.hidden===false);
    const qualifying=requests.slice(baseline);assert.equal(qualifying.filter(r=>r.path==='/api/search'&&r.q===query).length,1,layout+' must search at configured minimum '+minimum);
    assert.ok(qualifying.some(r=>r.path==='/search/suggest.json'&&r.q===query));
    const after=requests.length;await type('dr');await type('d');assert.equal(requests.length,after,layout+' searched after deleting below minimum');assert.equal(await page.locator('#cfp-view-all-results').isVisible(),false);
    await type('dresses');await page.waitForFunction(()=>document.getElementById('cfp-view-all-results')?.hidden===false);assert.ok(requests.some(r=>r.q==='dresses'));
    // Slow eligible responses must not resurrect results after shortening the query.
    await fetch(origin+'/__settings-control',{method:'POST',body:JSON.stringify({searchDelay:800})});
    await type('party');await type('pa');await page.waitForTimeout(900);assert.equal(await page.locator('#cfp-view-all-results').isVisible(),false);assert.equal(await page.locator('#cfp-search-products').getAttribute('aria-busy'),'false');
    await fetch(origin+'/__settings-control',{method:'POST',body:'{}'});
    await type('Long "Evening" <Dress> with Sleeves');await page.waitForFunction(()=>document.getElementById('cfp-view-all-results')?.hidden===false);
    const card=page.locator('.cfp-search-result-card').first(),title=await card.locator('.cfp-search-product-title').textContent();
    assert.equal(await card.getAttribute('title'),layout==='compact'?title:null,layout+' full product-name tooltip');
    await card.hover();assert.equal(await card.getAttribute('title'),layout==='compact'?title:null);
    assert.equal(await card.locator('dress').count(),0,'product title must remain escaped text');
    assert.deepEqual(errors,[]);console.log('PASS '+layout+' minimum '+minimum+': zero requests/repaints below setting, search at exact threshold, delete below threshold, resume, stale response ignored');
  }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
