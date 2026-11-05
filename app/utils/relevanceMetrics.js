export function normalizeProductId(value) {
  const id = String(value ?? '').trim();
  if (!id || !/^[a-zA-Z0-9:/_-]+$/.test(id)) throw Error('Invalid relevance product ID');
  return id.split('/').pop();
}

export function ndcgAt10(ids, grades) {
  if (!Array.isArray(ids) || !grades || typeof grades !== 'object') throw Error('Invalid relevance ranking');
  const grade = id => {
    const value = Number(grades[normalizeProductId(id)] || 0);
    if (!Number.isInteger(value) || value < 0 || value > 3) throw Error('Relevance grades must be 0–3');
    return value;
  };
  const dcg = values => values.slice(0, 10).reduce((sum, value, index) =>
    sum + (2 ** value - 1) / Math.log2(index + 2), 0);
  const ideal = dcg(Object.keys(grades).map(grade).sort((a, b) => b - a));
  if (!ideal) throw Error('Each judged query needs a relevant product');
  const seen = new Set();
  const actual = ids.slice(0, 10).map(id => {
    const key = normalizeProductId(id);
    if (seen.has(key)) throw Error('Duplicate product in relevance ranking');
    seen.add(key);
    return grade(key);
  });
  return dcg(actual) / ideal;
}

export function validateGoldenQueries(rows) {
  if (!Array.isArray(rows) || rows.length !== 200) throw Error('Golden set must contain exactly 200 judged queries');
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.query !== 'string' || !row.query.trim() ||
      !(typeof row.shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(row.shop) || ['US', 'UK'].includes(row.store)))
      throw Error('Golden query needs a Shopify shop or known store and query');
    const key = `${row.shop || row.store}:${row.query.trim().toLocaleLowerCase('en')}`;
    if (seen.has(key)) throw Error('Duplicate golden query');
    seen.add(key);
    if (!row.grades || typeof row.grades !== 'object') throw Error('Golden query needs product grades');
    if (row.expectedZero === true) {
      if (Object.keys(row.grades).length) throw Error('Zero-result query must have no relevant products');
    } else ndcgAt10([], row.grades);
  }
  return rows;
}
