// Validate the complete selection before any destructive database operation.
export function merchandisingRuleIds(raw) {
  let ids;
  try { ids = JSON.parse(raw); } catch { throw new Error('Select at least one rule to delete.'); }
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error('Select at least one rule to delete.');
  }
  return [...new Set(ids)];
}
