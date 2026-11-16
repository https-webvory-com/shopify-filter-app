import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const start=source.indexOf("        else if (type === 'price') {");
const mapping=source.slice(start+"        else if (type === 'price') {".length,source.indexOf("        else if (type === 'vendor')",start)).replace(/}\s*$/,'');
function labels(ranges){const context={facets:{priceRanges:{ranges}},items:[],getGlobalCurrencyRate:()=>1,getGlobalCurrencySymbol:()=>'£'};vm.createContext(context);vm.runInContext(mapping,context);return Array.from(context.items,v=>({value:v.value,label:v.label,count:v.count}));}
test('saved price bands retain bounded custom labels and show an open upper limit without Infinity',()=>{
 const ranges=[{from:'0',to:'50',label:'{0} - {1}',count:4},{from:'50',to:'100',label:'From {0}',count:30},{from:'100',to:'150',label:'{0} - {1}'},{from:'150',to:'200',label:'{0} - {1}'},{from:'200',to:'',label:'{0} - {1}'}];
 const result=labels(ranges);assert.deepEqual(result.map(r=>r.label),['£0 - £50','From £50','£100 - £150','£150 - £200','From £200']);assert.equal(result[4].value,'200:Infinity');assert.equal(result[1].count,30);
 assert.equal(labels([{min:200,max:null,from:'200',to:'',label:'Above {0}'}])[0].label,'Above £200');
});
test('automatic price ordering uses numerical bounds while explicit label ordering remains available',()=>{
 const context={};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function compareFilterOptions'),source.indexOf("  let shop = ''")),context);
 const rows=labels([{from:'100',to:'150',label:'{0} - {1}'},{from:'50',to:'100',label:'From {0}'},{from:'0',to:'50',label:'{0} - {1}'},{from:'200',to:'',label:'{0} - {1}'}]);
 rows.sort((a,b)=>context.compareFilterOptions(a,b,'Automatic','price',''));assert.deepEqual(rows.map(r=>r.value),['0:50','50:100','100:150','200:Infinity']);
 rows.sort((a,b)=>context.compareFilterOptions(a,b,'Label - AZ','price',''));assert.ok(rows.findIndex(r=>r.value==='50:100')>rows.findIndex(r=>r.value==='100:150'));
});
test('admin price preview resolves the same open-ended template without leaving placeholders',async()=>{
 const admin=await fs.readFile('app/components/ui/CreateFilterModal.jsx','utf8');const code=admin.slice(admin.indexOf('        let template = r.label'),admin.indexOf('        return { label, count: totalCount };',admin.indexOf('        let template = r.label')));
 for(const [rFrom,rTo,expected]of [[200,'','From 200'],[0,50,'0 - 50'],[0,0,'0 - 0']]){const context={r:{label:'{0} - {1}'},type:'price',rFrom,rTo};vm.createContext(context);vm.runInContext(code+'\nresult=label;',context);assert.equal(context.result,expected);}
});
