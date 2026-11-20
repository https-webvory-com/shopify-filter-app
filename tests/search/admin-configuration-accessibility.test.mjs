import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const code=(await transform(await fs.readFile('app/components/ui/RuleControls.jsx','utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'})).code;
const context={module:{exports:{}},exports:{},require:name=>name==='react/jsx-runtime'?jsxRuntime:React};vm.runInNewContext(code,context);
const {RuleStatusSwitch,RuleAction}=context.module.exports;
test('rule switch exposes a stable name, checked state, visible state and pending lock',()=>{
 const html=checked=>renderToStaticMarkup(React.createElement(RuleStatusSwitch,{name:'Prom',checked,disabled:true,onChange(){}}));
 assert.match(html(true),/role="switch"/);assert.match(html(true),/aria-label="Status for Prom"/);assert.match(html(false),/aria-label="Status for Prom"/);
 assert.match(html(true),/aria-checked="true"/);assert.match(html(false),/aria-checked="false"/);assert.match(html(true),/disabled/);assert.match(html(true),/aria-busy="true"/);assert.match(html(false),/Disabled/);
});
test('rule actions are native named controls and navigation retains an href',()=>{
 const button=renderToStaticMarkup(React.createElement(RuleAction,{label:'Delete Prom',title:'Existing tooltip',onClick(){}},'Icon'));
 assert.match(button,/<button/);assert.match(button,/type="button"/);assert.match(button,/aria-label="Delete Prom"/);assert.match(button,/title="Existing tooltip"/);
 const link=renderToStaticMarkup(React.createElement(RuleAction,{label:'Edit Prom',href:'/app/rules/1',onClick(){}},'Edit'));
 assert.match(link,/<a /);assert.match(link,/href="\/app\/rules\/1"/);
});
test('settings descriptions describe existing controls and supported adapters',async()=>{
 const overview=await fs.readFile('app/routes/app.settings._index.jsx','utf8');
 assert.ok(!overview.includes('automatic sync frequency'));assert.ok(!overview.includes('manage Storefront API credentials'));assert.ok(overview.includes('Manage inventory visibility, quick view, country availability and wholesale settings.'));
 const integrations=await fs.readFile('app/routes/app.settings.integrations.jsx','utf8');assert.ok(!integrations.includes('add rating stars, currency conversion'));assert.ok(integrations.includes('Connection health: not verified.'));
});
test('UK review is explicitly non-applying and does not invent approved synonyms or activate groups',async()=>{
 const review=JSON.parse(await fs.readFile('docs/reviews/uk-store-configuration-review.json','utf8'));
 assert.equal(review.shop,'thedressoutletuk.myshopify.com');assert.equal(review.approvedForImport,false);assert.equal(review.productionChangesPerformed,false);
 assert.deepEqual(review.synonyms.reviewOnlyCandidates,[]);assert.deepEqual(review.synonyms.existingEntriesToRemove,[]);assert.deepEqual(review.groups.groupsToEnable,[]);
 assert.ok(review.merges.every(m=>m.proposedChange===null&&!m.approved&&Array.isArray(m.rawValues)));
 assert.equal(review.country.activationApproved,false);assert.equal(review.integrations.wishlistTestingExcluded,true);
});
