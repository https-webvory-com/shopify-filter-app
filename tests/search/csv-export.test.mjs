import * as pinImportOrder from "../../app/utils/pinImportOrder.js";
import * as searchPinCsv from "../../app/utils/searchPinCsv.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import Papa from 'papaparse';

async function exportModal(file, props) {
  let blob, clicked = false, closed = false;
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] };
  const context = { module: { exports: {} }, exports: {}, Blob, URL: { createObjectURL: value => { blob = value; return 'blob:fixture'; } },
    document: { createElement: () => ({ style: {}, setAttribute() {}, click() { clicked = true; } }), body: { appendChild() {}, removeChild() {} } },
    require(name) { if (name === '../../utils/pinImportOrder.js') return pinImportOrder; if (name === '../../utils/searchPinCsv') return searchPinCsv; if (name === 'react') return { __esModule: true, default: react, ...react }; if (name === 'papaparse') return { __esModule: true, default: Papa }; return {}; } };
  vm.runInNewContext((await transform(await fs.readFile(file, 'utf8'), { loader: 'jsx', format: 'cjs' })).code, context);
  const component = context.module.exports.default || context.module.exports.ExportFilterGroupsModal;
  const tree = component({ ...props, isOpen: true, onClose() { closed = true; } });
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.props?.onClick?.name === 'handleExport') node.props.onClick(); for (const child of node.children || []) (Array.isArray(child) ? child : [child]).forEach(visit); if (node.props?.footer) visit(node.props.footer); };
  visit(tree);
  assert.equal(clicked, true); assert.equal(closed, true);
  return Papa.parse(await blob.text(), { header: true }).data;
}

test('collection merchandising supplies the export modal with its required selection props', async () => {
  const source = await fs.readFile('app/routes/app.collections.merchandising.jsx', 'utf8');
  const modal = source.slice(source.indexOf('<ExportMerchandisingRulesModal'), source.indexOf('/>', source.indexOf('<ExportMerchandisingRulesModal')));
  assert.match(modal, /selectedRuleIds=\{selectedRules\}/);
  assert.match(modal, /allRules=\{merchandisingRules\}/);
});

test('merchandising export downloads only selected rules with intact commas, quotes and conditions', async () => {
  const rows = await exportModal('app/components/merchandising/ExportMerchandisingRulesModal.jsx', {
    selectedRuleIds: ['one'], allRules: [{ id: 'one', name: 'Black, "formal"', status: true, ruleType: 'collection', collections: ['Dresses'], conditions: [{ action: 'Boost', field: 'Color (product option)', value: 'Black', operator: 'equals' }] }, { id: 'two', name: 'Excluded' }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].Name, 'Black, "formal"');
  assert.equal(JSON.parse(rows[0].Conditions)[0].Field, 'option:Color');
  assert.deepEqual(JSON.parse(rows[0].CollectionTitles), ['Dresses']);
});

test('filter group export preserves collection titles containing quotes and missing collection lists', async () => {
  const rows = await exportModal('app/components/ui/ExportFilterGroupsModal.jsx', { selectedGroups: ['one', 'two'], allGroups: [{ id: 'one', name: 'Formal', status: true, collections: [{ pageType: 'collection', collectionTitle: 'The "Formal", Edit', collectionId: 'gid://shopify/Collection/123' }] }, { id: 'two', name: 'Empty' }] });
  assert.deepEqual(JSON.parse(rows[0]['Collection titles']), ['The "Formal", Edit']);
  assert.equal(rows.length, 2);
});

for (const kind of ['Collection','Search']) test(`${kind} pin export retains CSV rule order and product order`, async () => {
  const group = '1792129204954:12345678-1234-4234-9234-123456789abc';
  const ordered = pinImportOrder.orderedPinImportRows([
    {id:'first',sourceRow:2,name:'First',collections:['Summer'],searchQueries:['first'],products:[{id:'gid://shopify/Product/2'},{id:'gid://shopify/Product/1'}]},
    {id:'second',sourceRow:3,name:'Second',collections:['Winter'],searchQueries:['second'],products:[]},
  ],group);
  const rows = await exportModal(`app/components/merchandising/Export${kind}PinsModal.jsx`, {selectedRuleIds:['first','second'],allRules:ordered.slice().reverse()});
  assert.deepEqual(rows.map(r=>r.Id),['first','second']);
  assert.deepEqual(JSON.parse(rows[0].Products).map(p=>String(p.Id||p.id).split('/').pop()),['2','1']);
});
