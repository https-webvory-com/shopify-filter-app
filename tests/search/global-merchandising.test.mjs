import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

test('collection rules combine global and specific rules while excluding search and customer-only rules',async()=>{
 const rules=[
  {id:'specific',name:'Top Formal',collections:['Formal Dresses'],conditions:[{action:'Dynamic',field:'Tags',value:'BestFormal',operator:'Set',operand:'1000'}]},
  {id:'global',name:'Champagne Prom Dresses',collections:[],conditions:[{action:'Pin',field:'Tags',value:'Champagne'}]},
  {id:'unrelated',name:'Prom',collections:['Prom Dresses'],conditions:[]},
  {id:'customer',name:'VIP',collections:[],customerTags:'vip',conditions:[]},
 ];
 const prisma={merchandisingRule:{findMany:async({where})=>{assert.equal(where.shop,'fixture');assert.equal(where.ruleType,'collection');return rules;}}};
 const context={module:{exports:{}},exports:{},console,require:()=>({__esModule:true,default:prisma})};
 vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,context);
 const rule=await context.module.exports.getActiveRuleForCollection('fixture','Formal Dresses');
 assert.equal(rule.name,'Top Formal + Champagne Prom Dresses');
 assert.deepEqual(Array.from(rule.conditions,c=>c.action),['Pin','Dynamic']);
});
