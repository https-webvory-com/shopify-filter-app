import { facetValueKey } from './facetNormalization.js';
import { variantSizeEvidence } from './variantSize.js';

export async function rebuildSizeMappingPage(job, database) {
  const { shop } = job.data;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '')) throw Error('Invalid size mapping shop');
  const mappings = await database.sizeNumericMapping.findMany({ where: { shop }, select: { sourceValue: true, sizeUsNumeric: true } });
  const rows = await database.variant.findMany({ where: { product: { shop }, ...(job.data.cursor ? { id: { gt: job.data.cursor } } : {}) },
    orderBy: { id: 'asc' }, take: 250,
    select: { id: true, option1: true, option2: true, option3: true, product: { select: { options: true } } } });
  if (!rows.length) return { complete: true };
  const updates = rows.map(row => {
    const options = Array.isArray(row.product?.options) ? row.product.options : [];
    const selectedOptions = options.slice(0, 3).map((option, index) => ({ name: option.name, value: row[`option${index + 1}`] }));
    const evidence = variantSizeEvidence(options, selectedOptions, mappings);
    return database.variant.update({ where: { id: row.id }, data: evidence });
  });
  await database.$transaction(updates, { timeout: 30000 });
  await job.updateData({ shop, cursor: rows.at(-1).id });
  return { complete: rows.length < 250, processed: rows.length };
}

export function normalizedSizeSource(value) {
  const source = facetValueKey(value);
  if (!source || source.length > 100) throw Error('Size label must be 1–100 characters');
  return source;
}
