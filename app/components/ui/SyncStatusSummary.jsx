import {syncDashboardState} from '../../utils/syncDashboard.js';

export default function SyncStatusSummary({status, queueState, progress, completedAt, lastCompletedAt, issue, databaseCount, publishedCount, unpublishedCount}) {
  const state = syncDashboardState({status, queueState, progress, completedAt, issue});
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'Unavailable';
  return <section aria-label="Product synchronization status" style={{fontSize: '13px', color: '#64748b'}}>
    <p role="status" style={{fontWeight: 600, color: state.verified ? '#15803d' : '#475569'}}>{state.label}</p>
    {state.processed !== null && <>
      <p>Product scan: {count(state.processed)}{state.total !== null ? ` / ${count(state.total)} products scanned` : ' products scanned; total unavailable'}.</p>
      <p>The scan includes all Shopify product statuses. Draft, archived and unpublished products are inspected but excluded from storefront storage.</p>
      {state.percent !== null && <div>
        <div role="progressbar" aria-label="Product scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent} style={{height: 8, maxWidth: 340, background: '#e2e8f0', borderRadius: 8}}>
          <div style={{width: `${state.percent}%`, height: '100%', background: state.verified ? '#16a34a' : status === 'FAILED' ? '#dc2626' : '#7c3aed', borderRadius: 8}} />
        </div>
        <p>{state.percent}% of the product scan. This is not a catalog coverage or freshness percentage.</p>
      </div>}
    </>}
    <p>Database rows for this store: <strong>{count(databaseCount)}</strong>.</p>
    <p>Shopify active, published products: <strong>{count(publishedCount)}</strong> (separate current count).</p>
    {Number.isSafeInteger(unpublishedCount) && unpublishedCount >= 0 && <p>{count(unpublishedCount)} active unpublished products excluded from listings. Draft and archived products are excluded separately.</p>}
    <p>Eligible storefront scope: active products published to the Online Store. These store-wide counts are not filtered by market, stock, collection or merchandising rules.</p>
    <p>ID reconciliation not verified. A count difference does not identify missing products; compare complete Shopify, database and index IDs under the same scope before restarting a sync.</p>
    <p>Last verified full sync: {lastCompletedAt ? new Date(lastCompletedAt).toLocaleString() : 'Not recorded'}.</p>
    <p>Incremental freshness: not verified by this dashboard. Product webhooks can update the catalog after a full sync; its date alone does not establish whether the database and index are current.</p>
  </section>;
}
