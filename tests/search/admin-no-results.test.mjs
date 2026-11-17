import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
const require=createRequire(import.meta.url);
const {code}=await transform(await fs.readFile('app/components/ui/AdminNoSearchResults.jsx','utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'});
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require});
const Empty=module.exports.default;
test('admin no-results feedback names the entered query and safely renders special characters',()=>{
 const html=renderToStaticMarkup(React.createElement(Empty,{query:'<img src=x onerror=alert(1)>'},'No columns available.'));
 assert.ok(html.includes('No results found for “&lt;img src=x onerror=alert(1)&gt;”'));
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('No columns available.'));
 assert.match(html,/role="status"/);assert.match(html,/overflow-wrap:anywhere/);
});
test('an empty or whitespace-only query retains the page-specific normal empty state',()=>{
 for(const query of ['', '   ']){
  const html=renderToStaticMarkup(React.createElement(Empty,{query},'No columns available.'));
  assert.ok(html.includes('No columns available.'));assert.ok(!html.includes('No results found for'));
 }
});
