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
  const selected = Object.entries(filters || {}).filter(([, values]) => values.length);
  // Use a conservative database prefilter, then retain the exact option-position
  // check below. This avoids transferring every available variant in a large
  // collection just to test a selected color/size in the web process.
  const variantWhere = { available: true };
  if (selected.length) variantWhere.AND = selected.map(([name, values]) => {
    const expanded = new Set(values.map(normalize));
    for (const rule of mergedValues || []) {
      if ((!rule.optionName || normalize(rule.optionName) === normalize(name)) &&
          values.some(value => normalize(value) === normalize(rule.targetValue))) {
        for (const value of rule.sourceValues || []) expanded.add(normalize(value));
      }
    }
    return { OR: [...expanded].flatMap(value => [1, 2, 3].flatMap(position => [
      { [`option${position}`]: { contains: value, mode: 'insensitive' } },
      ...(value === '' ? [{ [`option${position}`]: null }] : []),
    ])) };
  });
  let cursor;
  for (;;) {
    const rows = await productModel.findMany({
      where: { ...where, variants: { some: variantWhere } },
      select: selected.length
        ? { id: true, options: true, variants: { where: variantWhere, select: { available: true, option1: true, option2: true, option3: true } } }
        : { id: true },
      orderBy: { id: 'asc' }, take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) if (!selected.length || matchingAvailableVariants(row, filters, mergedValues).length) ids.push(row.id.split('/').pop());
    if (rows.length < 1000) break;
    cursor = rows.at(-1).id;
  }
  return ids;
}
