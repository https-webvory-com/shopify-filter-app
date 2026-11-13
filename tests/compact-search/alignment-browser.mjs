import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const width of [1440,1100,768,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin-ui');
  await page.getByRole('textbox',{name:'Women column 1 heading',exact:true}).waitFor();
  const rows=await page.locator('.cs-group-head').evaluateAll(nodes=>nodes.map(node=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
   return {row:rect(node),input:rect(node.querySelector('input')),button:rect(node.querySelector('button:last-child')),handle:rect(node.querySelector('.cs-drag-handle'))};
  }));
  assert.equal(rows.length,3);
  for(const {row,input,button,handle} of rows){
   assert.ok(Math.abs(input.bottom-handle.bottom)<1,'drag handle aligns with heading input');
   if(width>=768){assert.ok(Math.abs(input.top-button.top)<1,'picker and heading share a top edge');assert.ok(Math.abs(input.bottom-button.bottom)<1,'picker and heading share a bottom edge');}
   assert.ok(button.left>=row.left&&button.right<=row.right+1,'picker stays within its column');
  }
  await page.close();console.log('PASS Compact column controls aligned at '+width+'px');
 }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
