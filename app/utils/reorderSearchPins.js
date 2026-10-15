export function reorderSearchPins(products, fromIndex, targetIndex, selectedIds = []) {
  const dragged = products[fromIndex];
  if (!dragged) return products;
  const ids = new Set(selectedIds.includes(dragged.id) ? selectedIds : [dragged.id]);
  if (products[targetIndex] && ids.has(products[targetIndex].id)) return products;
  const moving = products.filter(p => ids.has(p.id));
  const remaining = products.filter(p => !ids.has(p.id));
  const before = products.slice(0, targetIndex).filter(p => !ids.has(p.id)).length;
  return [...remaining.slice(0, before), ...moving, ...remaining.slice(before)];
}
