import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(await fs.readFile('extensions/theme-extension/assets/quickView.js','utf8'), {window,document:{readyState:'loading',addEventListener(){}}});
const display = window.CfpQuickView.prototype.displaySku;
const product = {options:[{name:'Color',position:1},{name:'Size',position:2}]};

test('Quick View shows the style SKU without selected colour and size suffixes',()=>{
  for(const [sku,options,expected] of [
    ['1579-Pink-4',['Pink','4'],'1579'],
    ['STYLE-1579-Dusty-Rose-14W',['Dusty-Rose','14W'],'STYLE-1579'],
    ['1579-6-Blue',['Blue','6'],'1579'],
    ['1579',['Pink','4'],'1579'],
    ['STYLE-1579',['Pink','4'],'STYLE-1579'],
    ['STYLE-4',['Pink','6'],'STYLE-4'],
    ['', ['Pink','4'], ''],
  ])assert.equal(display(product,{sku,options}),expected);
});

test('SKU display leaves the actual variant SKU unchanged and supports Colour spelling',()=>{
  const variant={sku:'1579-Pink-4',options:['Pink','4']};
  assert.equal(display({options:[{name:'Colour',position:1},{name:'Size',position:2}]},variant),'1579');
  assert.equal(variant.sku,'1579-Pink-4');
  assert.equal(display({options:[{name:'Material',position:1}]},{sku:'STYLE-Silk',options:['Silk']}),'STYLE-Silk');
});
