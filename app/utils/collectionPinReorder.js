const pinRows = value => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
};
const stable = value => value instanceof Date ? value.toJSON() : Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const id = value => String(value).split('/').pop();

// A changed order or one added pin may reuse a complete ranking when all other
// rule inputs are identical. An added pin must already occur in that ranking.
export function isSafeCollectionPinEdit(before, after) {
  if (!before || !after || before.id !== after.id || before.status !== true || after.status !== true ||
      before.ruleType !== 'collection' || after.ruleType !== 'collection') return false;
  const oldPins = pinRows(before.products), newPins = pinRows(after.products);
  if (!Array.isArray(oldPins) || !Array.isArray(newPins) || !oldPins.length ||
      (newPins.length !== oldPins.length && newPins.length !== oldPins.length + 1) ||
      oldPins.some(pin => !/^gid:\/\/shopify\/Product\/\d+$/.test(pin?.id || '')) ||
      newPins.some(pin => !/^gid:\/\/shopify\/Product\/\d+$/.test(pin?.id || ''))) return false;
  const oldById = new Map(oldPins.map(pin => [pin.id, JSON.stringify(stable(pin))]));
  if (oldById.size !== oldPins.length || new Set(newPins.map(pin => pin.id)).size !== newPins.length ||
      oldPins.some(pin => !newPins.some(next => next.id === pin.id && JSON.stringify(stable(next)) === oldById.get(pin.id)))) return false;
  if (oldPins.every((pin, index) => pin.id === newPins[index].id)) return false;
  const omit = rule => Object.fromEntries(Object.entries(rule).filter(([key]) => !['products', 'updatedAt'].includes(key)));
  return JSON.stringify(stable(omit(before))) === JSON.stringify(stable(omit(after)));
}

export const isPureCollectionPinReorder = (before, after) =>
  pinRows(before?.products)?.length === pinRows(after?.products)?.length && isSafeCollectionPinEdit(before, after);

export function reorderVerifiedPinPrefix(ids, oldPinnedIds, newPinnedIds) {
  if (!Array.isArray(ids) || !Array.isArray(oldPinnedIds) || !Array.isArray(newPinnedIds) ||
      !newPinnedIds.length || (oldPinnedIds.length > 0 && newPinnedIds.length !== oldPinnedIds.length && newPinnedIds.length !== oldPinnedIds.length + 1) ||
      new Set(ids).size !== ids.length) return null;
  const present = new Set(ids);
  const oldOrder = oldPinnedIds.map(id).filter(value => present.has(value));
  const nextOrder = newPinnedIds.map(id).filter(value => present.has(value));
  if (new Set(oldOrder).size !== oldOrder.length || new Set(nextOrder).size !== nextOrder.length ||
      oldPinnedIds.some(value => !newPinnedIds.includes(value)) ||
      oldOrder.some((value, index) => ids[index] !== value) ||
      nextOrder.some(value => !oldOrder.includes(value) && !ids.slice(oldOrder.length).includes(value)) ||
      newPinnedIds.some(value => !oldPinnedIds.includes(value) && !present.has(id(value)))) return null;
  const nextSet = new Set(nextOrder);
  return [...nextOrder, ...ids.slice(oldOrder.length).filter(value => !nextSet.has(value))];
}

export function activePinsInSavedOrder(rule, eligibleIds) {
  const pins = pinRows(rule?.products);
  if (!Array.isArray(pins)) return null;
  const eligible = new Set(eligibleIds || []);
  return pins.filter(pin => eligible.has(pin?.id)).map(pin => pin.id);
}
