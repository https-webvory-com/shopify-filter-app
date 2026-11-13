import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const read=async()=>await(await fetch(origin+'/__state')).json();
try{
 const original=(await read()).saved.compactCollections;assert.equal(original.length,4);
 await page.goto(origin+'/admin-ui');const toggle=page.getByRole('checkbox',{name:'Enable instant search',exact:true});await toggle.waitFor();
 for(const enabled of [false,true]){
  await toggle.setChecked(enabled);await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Search settings saved.'}).waitFor();
  const state=await read();assert.equal(state.saved.instantSearchEnabled,enabled);assert.deepEqual(state.saved.compactCollections,original,'toggle must retain main tabs, groups and links');
  await page.reload();await toggle.waitFor();assert.equal(await toggle.isChecked(),enabled);assert.deepEqual((await read()).saved.compactCollections,original);
 }
 // A second tab can save a newer menu while this form still has an old copy.
 const newest=original.slice(0,2),current=(await read()).saved;
 const concurrent=await(await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',compactCollectionsChanged:'true',compactCollectionsBase:JSON.stringify(original),settings:JSON.stringify({...current,compactCollections:newest})})})).json();assert.equal(concurrent.success,true,concurrent.error);assert.deepEqual((await read()).saved.compactCollections,newest);
 await toggle.uncheck();await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Search settings saved.'}).waitFor();
 assert.deepEqual((await read()).saved.compactCollections,newest,'an untouched stale form must retain the latest menu');
 await page.reload();await toggle.waitFor();
 await page.getByRole('textbox',{name:'Women column 1 heading',exact:true}).fill('Stale edit');
 const updated=structuredClone(newest);updated[0].groups[0].title='Newer saved heading';
 await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',compactCollectionsChanged:'true',compactCollectionsBase:JSON.stringify(newest),settings:JSON.stringify({...current,compactCollections:updated})})});
 await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByRole('alert').filter({hasText:'Compact collections changed in another tab.'}).waitFor();
 assert.deepEqual((await read()).saved.compactCollections,updated,'stale menu edits must not overwrite newer saved links');
 console.log('PASS disabling/saving/reloading/enabling instant search preserves all four main tabs and every subcollection');
 console.log('PASS stale untouched menus preserve the current server menu; conflicting menu edits are rejected');
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
