import { importRowInfo } from './csvImportReport.js';

export async function postPinImportBatch(rows, ruleType) {
  const response = await fetch('/api/import-pins-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, ruleType }) });
  if (!response.ok) throw Error(`Import request failed (HTTP ${response.status}). The result could not be confirmed; check existing rules before retrying.`);
  let result;
  try { result = await response.json(); } catch { throw Error('The server returned an unreadable import result. Check existing rules before retrying.'); }
  if (!Number.isInteger(result.imported) || !Number.isInteger(result.skipped) || result.imported < 0 || result.skipped < 0 || result.imported + result.skipped !== rows.length || !Array.isArray(result.errors)) throw Error('The server returned an incomplete import result. Check existing rules before retrying.');
  return result;
}
export function unconfirmedPinRows(rows, error) {
  return rows.map((row, index) => ({ ...importRowInfo(row, index), status: 'unconfirmed', reason: error?.message || 'The import request failed before its result could be confirmed. Check existing rules before retrying.' }));
}
