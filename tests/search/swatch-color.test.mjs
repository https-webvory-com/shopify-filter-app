import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeSwatchHex } from '../../app/utils/swatchColor.js';

test('pasted swatch hex accepts a hash, whitespace, case and supported lengths', () => {
  for (const [input, expected] of [['e91e63','#e91e63'],[' #ABC ','#abc'],['1234','#1234'],['AABBCCDD','#aabbccdd'],['#123456','#123456']]) assert.equal(normalizeSwatchHex(input), expected);
  for (const input of ['',null,'#12','12345','gggggg','red','red; display:none']) assert.equal(normalizeSwatchHex(input), null);
});

test('storefront recovers existing hashless hex and retains the normal color for invalid overrides', () => {
  const source = fs.readFileSync('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
  const start = source.indexOf("if (matchedData.type === 'color' && matchedData.value)");
  const end = source.indexOf("else if (matchedData.type === 'image'",start);
  const block = source.slice(start,end);
  for (const [input,expected] of [['e91e63','#e91e63'],[' #123456 ','#123456'],['#abc','#abc'],['broken','#1a1a1a'],['red; display:none','#1a1a1a']]) {
    const context = {matchedData:{type:'color',value:input},colorValue:'#1a1a1a'};
    vm.runInNewContext(block,context);
    assert.equal(context.colorValue,expected);
  }
});
