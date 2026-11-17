import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
async function load(filename, imports) {
  const source = await fs.readFile(filename, 'utf8');
  const compiled = (await transform(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' })).code;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => imports[name] || require(name), console, URL, URLSearchParams, Date });
  return module.exports;
}

test('analytics renders six reports with real table data, date controls and chart tools', async () => {
  const chart = await load('app/components/analytics/AnalyticsChart.jsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  });
  const report = { shop: 'fixture.myshopify.com', from: '2026-10-05', to: '2026-11-04',
    tab: 'products', group: 'day', rows: [{ key: '123', label: 'Black dress', hits: 12, url: '/products/black-dress' }],
    chart: [{ bucket: '2026-11-04', values: { '123': 12 } }], topKeys: ['123'] };
  const route = await load('app/routes/app.analytics.jsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-router': { useLoaderData: () => report, useRouteError: () => null,
      Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
      Form: ({ children, ...props }) => React.createElement('form', props, children) },
    '../shopify.server.js': { authenticate: { admin: async () => ({ session: { shop: report.shop } }) } },
    '@shopify/shopify-app-react-router/server': { boundary: { error: () => null, headers: () => ({}) } },
    '../components/analytics/AnalyticsChart.jsx': chart,
    '../services/searchAnalyticsReport.server.js': { analyticsRange: () => report,
      analyticsDashboard: async () => report },
  });
  const html = renderToStaticMarkup(React.createElement(route.default));
  for (const label of ['Search volume', 'Search queries', 'Top used filters', 'Top clicked products',
    'Top locations', 'Top 0 result', 'Rows per page:', 'Download CSV', 'Download SVG', 'Download PNG',
    'Black dress', 'From', 'To', 'Group by']) assert.ok(html.includes(label), label);
  assert.match(html, /fixture\.myshopify\.com\/products\/black-dress/);
  assert.match(html, /aria-label="products chart"/);
  assert.match(html, /stroke="#6d28d9" stroke-width="2.5" stroke-linecap="round"/);
  assert.match(html, /Store insights/);
  const singleDay = renderToStaticMarkup(React.createElement(chart.default, { tab: 'queries', group: 'day',
    chart: [{ bucket: '2026-11-04', values: { first: 1, second: 1 } }],
    keys: ['first', 'second'], rows: [{ key: 'first', label: 'First' }, { key: 'second', label: 'Second' }] }));
  const markerX = [...singleDay.matchAll(/<circle[^>]*cx="([^"]+)"/g)].map(match => match[1]);
  assert.equal(markerX.length, 2);
  assert.notEqual(markerX[0], markerX[1]);
  const range = renderToStaticMarkup(React.createElement(chart.default, {tab:'volume',group:'day',
    chart:['2026-11-04','2026-11-05','2026-11-17'].map(bucket=>({bucket,values:{total:5}})),
    keys:['total'],rows:[{key:'total',label:'Searches'}]}));
  assert.match(range, /text-anchor="start"[^>]*>2026-11-04/);
  assert.match(range, /text-anchor="middle"[^>]*>2026-11-05/);
  assert.match(range, /text-anchor="end"[^>]*>2026-11-17/);
});
