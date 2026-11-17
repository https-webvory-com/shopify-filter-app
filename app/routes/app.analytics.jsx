import { useEffect, useState } from 'react';
import { Form, Link, useLoaderData, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server.js';
import { boundary } from '@shopify/shopify-app-react-router/server';
import AnalyticsChart from '../components/analytics/AnalyticsChart.jsx';
import { analyticsDashboard, analyticsRange } from '../services/searchAnalyticsReport.server.js';

const tabs = [
  ['volume', 'Search volume', 'Search volume over time', 'Date'],
  ['queries', 'Search queries', 'Search queries', 'Query'],
  ['filters', 'Top used filters', 'Top used filters', 'Filter - Label'],
  ['products', 'Top clicked products', 'Top clicked products', 'Product'],
  ['locations', 'Top locations', 'Top locations', 'Country'],
  ['zero', 'Searches with no results', 'Searches with no results', 'Term'],
];
const groups = [['hour', 'Hour'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'],
  ['hour_of_day', 'Hour of day'], ['day_of_week', 'Day of week']];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const range = analyticsRange(new URL(request.url).searchParams);
  const report = await analyticsDashboard(session.shop, range);
  return { shop: session.shop, from: range.from, to: range.to, tab: range.tab,
    group: range.group, rows: report.rows, chart: report.chart, topKeys: report.topKeys || [] };
};

function ResultsTable({ tab, rows, shop }) {
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const shown = rows.slice(page * pageSize, (page + 1) * pageSize);
  const heading = tabs.find(item => item[0] === tab)?.[3] || 'Item';
  return <div className="cfp-analytics-table"><table>
    <thead><tr><th>{heading}</th><th>{tab === 'products' ? 'Clicks' : tab === 'filters' ? 'Uses' : 'Searches'}</th></tr></thead>
    <tbody>{shown.length ? shown.map(row => <tr key={row.key}>
      <td>{tab === 'products' && row.url ? <a href={`https://${shop}${row.url}`} target="_blank" rel="noreferrer">{row.label}</a> : row.label}</td>
      <td>{Number(row.hits).toLocaleString()}</td>
    </tr>) : <tr><td colSpan="2" className="cfp-analytics-empty">No recorded events in this period.</td></tr>}</tbody>
  </table><div className="cfp-analytics-pager">
    <label>Rows per page: <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
      {[5, 10, 20, 25, 50, 100].map(size => <option key={size} value={size}>{size === 100 ? 'All' : size}</option>)}
    </select></label><span>{rows.length ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, rows.length)} of ${rows.length}` : '0 results'}</span>
    <button type="button" aria-label="Previous page" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
    <button type="button" aria-label="Next page" disabled={(page + 1) * pageSize >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
  </div></div>;
}

export default function Analytics() {
  const report = useLoaderData();
  const [from, setFrom] = useState(report.from);
  const [to, setTo] = useState(report.to);
  useEffect(() => setFrom(report.from), [report.from]);
  useEffect(() => setTo(report.to), [report.to]);
  const tab = tabs.find(item => item[0] === report.tab) || tabs[0];
  const preset = value => {
    const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const iso = () => date.toISOString().slice(0, 10);
    if (value === 'today') { setFrom(iso()); setTo(iso()); }
    if (value === 'week') { date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); setFrom(iso()); setTo(new Date().toISOString().slice(0, 10)); }
    if (value === 'last-week') { date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 - 7); setFrom(iso()); date.setUTCDate(date.getUTCDate() + 6); setTo(iso()); }
    if (value === 'month') { date.setUTCDate(1); setFrom(iso()); setTo(new Date().toISOString().slice(0, 10)); }
    if (value === 'last-month') { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 1); setFrom(iso()); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); setTo(iso()); }
  };
  const tabUrl = value => `/app/analytics?${new URLSearchParams({ tab: value, from: report.from, to: report.to, group: report.group })}`;
  return <main className="cfp-analytics-page">
    <header><span className="cfp-analytics-eyebrow">Store insights</span><h1>Analytics</h1><p>Search and collection activity recorded with visitor consent.</p></header>
    <section className="cfp-analytics-panel">
      <nav className="cfp-analytics-tabs" aria-label="Analytics reports">{tabs.map(item => <Link key={item[0]} to={tabUrl(item[0])}
        aria-current={report.tab === item[0] ? 'page' : undefined} className={report.tab === item[0] ? 'active' : ''}>{item[1]}</Link>)}</nav>
      <div className="cfp-analytics-content">
        <div className="cfp-analytics-controls"><h2>{tab[2]}</h2><Form method="get" className="cfp-analytics-form">
          <input type="hidden" name="tab" value={report.tab} />
          <select aria-label="Date preset" defaultValue="custom" onChange={event => preset(event.target.value)}>
            <option value="custom">Custom dates</option><option value="today">Today</option><option value="week">This week</option>
            <option value="last-week">Last week</option><option value="month">This month</option><option value="last-month">Last month</option>
          </select>
          <label>From <input type="date" name="from" value={from} max={to} onChange={event => setFrom(event.target.value)} required /></label>
          <label>To <input type="date" name="to" value={to} min={from} max={new Date().toISOString().slice(0, 10)} onChange={event => setTo(event.target.value)} required /></label>
          {report.tab !== 'locations' && <select key={report.group} name="group" aria-label="Group by" defaultValue={report.group}>{groups.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
          <button type="submit">Apply</button>
        </Form></div>
        {report.tab !== 'locations' && (report.chart.length ? <AnalyticsChart key={`${report.tab}:${report.group}:${report.from}:${report.to}`}
          chart={report.chart} keys={report.topKeys} rows={report.rows} group={report.group} tab={report.tab} />
          : <div className="cfp-analytics-chart-empty">No chart data for this period.</div>)}
        <ResultsTable key={`${report.tab}:${report.from}:${report.to}`} tab={report.tab} rows={report.rows} shop={report.shop} />
        <p className="cfp-analytics-note">{report.tab === 'locations' ? 'Locations use the shopper country reported by Shopify.' : 'Charts show the top five series; the table shows up to 100 rows.'}</p>
      </div>
    </section>
    <style>{`
      .cfp-analytics-page{max-width:1500px;margin:0 auto;padding:24px 28px 36px;color:#111827;font:14px/1.5 Inter,system-ui,sans-serif}
      .cfp-analytics-eyebrow{display:inline-block;color:#6d28d9;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin-bottom:5px}
      .cfp-analytics-page h1{font-size:28px;letter-spacing:-.03em;margin:0}.cfp-analytics-page header p{color:#6b7280;margin:4px 0 22px}
      .cfp-analytics-panel{background:#fff;border:1px solid #ede9fe;border-radius:16px;overflow:hidden;box-shadow:0 1px 8px #5b21b60c}
      .cfp-analytics-tabs{display:flex;overflow:auto;border-bottom:1px solid #ede9fe;padding:0 16px;gap:6px;background:#fcfaff}
      .cfp-analytics-tabs a{white-space:nowrap;padding:16px 15px;color:#6b7280;text-decoration:none;border-bottom:3px solid transparent;font-weight:600}
      .cfp-analytics-tabs a:hover{color:#6d28d9;background:#f5f3ff}.cfp-analytics-tabs a.active{color:#5b21b6;border-color:#7c3aed;background:#f5f3ff}
      .cfp-analytics-content{padding:25px 28px}.cfp-analytics-controls{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .cfp-analytics-controls h2{font-size:19px;letter-spacing:-.02em;margin:0}.cfp-analytics-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .cfp-analytics-form label{display:flex;gap:6px;align-items:center;color:#6b7280}.cfp-analytics-form input,.cfp-analytics-form select,.cfp-analytics-pager select{border:1px solid #d8d3e5;background:#fff;color:#374151;border-radius:8px;padding:8px 10px;font:inherit}
      .cfp-analytics-form button{background:#6d28d9;color:#fff;border:1px solid #6d28d9;border-radius:8px;padding:8px 15px;font:inherit;font-weight:700;cursor:pointer}
      .cfp-analytics-form button:hover{background:#5b21b6}.cfp-analytics-form :focus-visible,.cfp-analytics-page button:focus-visible,.cfp-analytics-tabs a:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}
      .cfp-chart{margin-top:18px;border:1px solid #ede9fe;border-radius:12px;padding:12px 16px 4px;background:#fff}
      .cfp-chart-toolbar{display:flex;justify-content:flex-end;gap:5px;margin:0 0 8px}.cfp-chart-toolbar button,.cfp-chart-toolbar summary{border:1px solid #e9e3f5;background:#faf8ff;color:#5b21b6;padding:6px 10px;border-radius:7px;cursor:pointer;list-style:none;font:inherit}
      .cfp-chart-toolbar button:hover,.cfp-chart-toolbar summary:hover{background:#f3edff}.cfp-chart-toolbar details{position:relative}.cfp-chart-menu{position:absolute;right:0;top:100%;display:grid;background:#fff;border:1px solid #d8d3e5;border-radius:8px;box-shadow:0 8px 24px #3b126622;z-index:2;min-width:145px;padding:5px}
      .cfp-chart-menu button{white-space:nowrap;text-align:left;background:#fff;border:0}.cfp-chart-menu button:hover{background:#f5f3ff}
      .cfp-chart-svg svg{display:block;width:100%;height:auto;min-height:245px}.cfp-chart-legend{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:3px 0 12px}
      .cfp-chart-legend button{border:1px solid #e9e3f5;background:#faf8ff;border-radius:20px;padding:5px 10px;cursor:pointer;color:#374151;font:inherit}.cfp-chart-legend button[aria-pressed=false]{opacity:.45;text-decoration:line-through}
      .cfp-chart-legend span{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
      .cfp-analytics-table{overflow-x:auto;margin-top:20px;border:1px solid #ede9fe;border-radius:12px}.cfp-analytics-table table{width:100%;border-collapse:collapse;min-width:480px}
      .cfp-analytics-table th{text-align:left;font-size:12px;color:#6b7280;font-weight:700;background:#faf8ff}.cfp-analytics-table th,.cfp-analytics-table td{padding:13px 16px;border-bottom:1px solid #f0edf5}
      .cfp-analytics-table tr:last-child td{border-bottom:0}.cfp-analytics-table tbody tr:hover{background:#fcfaff}.cfp-analytics-table th:last-child,.cfp-analytics-table td:last-child{text-align:right}.cfp-analytics-table a{color:#5b21b6}
      .cfp-analytics-empty,.cfp-analytics-chart-empty{color:#6b7280;text-align:center;padding:48px 10px}.cfp-analytics-pager{display:flex;justify-content:flex-end;align-items:center;gap:14px;padding:12px 16px;color:#6b7280;border-top:1px solid #f0edf5}
      .cfp-analytics-pager button{border:1px solid #d8d3e5;border-radius:7px;background:#fff;padding:6px 10px;cursor:pointer;font:inherit;color:#5b21b6}.cfp-analytics-pager button:disabled{opacity:.4;cursor:default}
      .cfp-analytics-note{font-size:12px;color:#6b7280;margin:17px 0 0}@media(max-width:700px){.cfp-analytics-page{padding:15px}.cfp-analytics-content{padding:16px}.cfp-analytics-form{width:100%}}
    `}</style>
  </main>;
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers = boundary.headers;
