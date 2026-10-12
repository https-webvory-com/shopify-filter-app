const normalize = value => String(value ?? '').trim().toLowerCase();

export async function ensureVariantEligibilityFilter(index, tasks) {
  const attributes = await index.getFilterableAttributes();
  if (attributes.includes('id')) return;
  const task = await index.updateFilterableAttributes([...attributes, 'id']);
  const completed = await tasks.waitForTask(task.taskUid, {timeout: 120000});
  if (completed.status !== 'succeeded') throw new Error('Variant availability filter could not be prepared');
}

// OR within an option; AND across options, on the same available variant.
export function matchingAvailableVariants(product, filters = {}, mergedValues = []) {
  return (product.variants || product.variantPrices || []).filter(variant => {
    if (variant.available !== true) return false;
    return Object.entries(filters).every(([name, selected]) => {
      if (!selected.length) return true;
      const position = (product.options || []).findIndex(option => normalize(option.name) === normalize(name));
      if (position < 0) return false;
      const actual = normalize(variant[`option${position + 1}`]);
      return selected.some(value => {
        if (actual === normalize(value)) return true;
        return mergedValues.some(rule => normalize(rule.targetValue) === normalize(value) &&
          (!rule.optionName || normalize(rule.optionName) === normalize(name)) &&
          (rule.sourceValues || []).some(source => normalize(source) === actual));
      });
    });
  });
}

export async function availableProductIds(productModel, where, filters, mergedValues) {
  const ids = [];
  let cursor;
  for (;;) {
    const rows = await productModel.findMany({
      where: { ...where, variants: { some: { available: true } } },
      select: { id: true, options: true, variants: { where: { available: true }, select: { available: true, option1: true, option2: true, option3: true } } },
      orderBy: { id: 'asc' }, take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) if (matchingAvailableVariants(row, filters, mergedValues).length) ids.push(row.id.split('/').pop());
    if (rows.length < 1000) break;
    cursor = rows.at(-1).id;
  }
  return ids;
}
