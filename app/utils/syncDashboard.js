export function syncDashboardState({status = 'IDLE', queueState, progress, completedAt, issue}) {
  const processed = Number.isSafeInteger(progress?.processed) && progress.processed >= 0 ? progress.processed : null;
  const total = Number.isSafeInteger(progress?.total) && progress.total > 0 ? progress.total : null;
  const scanComplete = processed !== null && total !== null && processed >= total;
  const percent = processed !== null && total !== null ? Math.min(scanComplete ? 100 : 99, Math.round(processed / total * 100)) : null;
  const queued = ['waiting', 'delayed', 'prioritized', 'waiting-children'].includes(queueState);
  const verified = status === 'COMPLETED' && Boolean(completedAt) && !issue;
  let label = 'No full sync recorded';
  if (verified) label = 'Last sync completed';
  else if (status === 'FAILED' || status === 'COMPLETED') label = scanComplete ? 'Scan complete — sync stopped before verified completion' : 'Full sync stopped';
  else if (status === 'IN_PROGRESS') label = queueState === 'unavailable' ? 'Sync status temporarily unavailable' : queueState === 'missing' ? 'Sync activity unconfirmed' : queued ? 'Full sync queued' : scanComplete ? 'Scan complete — finalization pending' : 'Product scan in progress';
  return {label, processed, total, percent, scanComplete, verified};
}

// Compare complete snapshots only. Matching totals never establish membership.
export function reconcileProductIds({shopify, database, index}) {
  const snapshots = [shopify, database, index];
  if (snapshots.some(snapshot => snapshot?.complete !== true || !Array.isArray(snapshot.ids))) throw Error('Complete ID snapshots are required');
  const scope = snapshot => JSON.stringify([snapshot.scope?.shop, snapshot.scope?.publication, snapshot.scope?.status, snapshot.scope?.market ?? null]);
  if (!shopify.scope?.shop || !shopify.scope?.publication || !shopify.scope?.status || snapshots.some(snapshot => scope(snapshot) !== scope(shopify))) throw Error('ID snapshots must have identical store, publication, status and market scopes');
  const canonical = snapshot => new Set(snapshot.ids.map(id => {
    const token = String(id).replace(/^gid:\/\/shopify\/Product\//, '');
    if (!/^\d+$/.test(token)) throw Error('Invalid product ID');
    return token;
  }));
  const [eligible, stored, indexed] = snapshots.map(canonical);
  const difference = (left, right) => [...left].filter(id => !right.has(id)).sort();
  const missingDatabase = difference(eligible, stored), missingIndex = difference(eligible, indexed);
  const extraDatabase = difference(stored, eligible), extraIndex = difference(indexed, eligible);
  return {scope: shopify.scope, capturedAt: snapshots.map(snapshot => snapshot.capturedAt ?? null),
    counts: {eligible: eligible.size, database: stored.size, index: indexed.size},
    missingDatabase, missingIndex, extraDatabase, extraIndex,
    matches: !missingDatabase.length && !missingIndex.length && !extraDatabase.length && !extraIndex.length};
}
