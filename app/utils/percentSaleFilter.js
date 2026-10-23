export function saleRange(from, to) {
  const min = from === '' || from == null ? 0 : Number(from);
  const max = to === '' || to == null ? 100 : Number(to);
  return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max <= 100 && min <= max ? {min, max} : null;
}

export function parseSaleSelections(params) {
  const values = params.getAll('sale[]');
  if (values.length > 100) throw new Error('Too many sale ranges');
  return values.map(value => {
    if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid sale range');
    const range = saleRange(...value.split(':'));
    if (!range) throw new Error('Invalid sale range');
    return range;
  });
}

export function configuredSaleRanges(settings) {
  return (settings || []).filter(f => f.isEnabled && f.filterType === 'percent_sale').flatMap(f => {
    let config; try { config = typeof f.config === 'string' ? JSON.parse(f.config) : f.config; } catch { return []; }
    return (Array.isArray(config?.saleRanges) ? config.saleRanges : []).slice(0,100).flatMap(r => {
      const bounds = saleRange(r.from ?? r.min, r.to ?? r.max);
      return bounds ? [{...r,...bounds,value:`${bounds.min}:${bounds.max}`}]:[];
    });
  });
}

// Match the existing merchandising definition: the largest markdown among a
// product's variants. Keep full decimal precision and count each product once.
export async function readProductSalePercentages(database, shop) {
  const rows = await database.$queryRaw`
    SELECT p.id, COALESCE(MAX(CASE WHEN v."compareAtPrice" > v.price AND v."compareAtPrice" > 0
      THEN (v."compareAtPrice" - v.price) * 100.0 / v."compareAtPrice" ELSE 0 END),0)::double precision AS percent
    FROM "Product" p LEFT JOIN "Variant" v ON v."productId" = p.id
    WHERE p.shop = ${shop} AND LOWER(p.status) = 'active'
    GROUP BY p.id
  `;
  return rows.map(row => ({id:String(row.id).split('/').pop(),percent:Number(row.percent)}));
}

export function saleIdsFilter(rows, ranges) {
  const ids = rows.filter(row => ranges.some(r => row.percent >= r.min && row.percent <= r.max)).map(row => row.id);
  return ids.length ? `id IN ${JSON.stringify(ids)}` : 'id = "__no_sale_match__"';
}

export function hasUsableSaleFacets(payload) {
  if (!(payload?.settings || []).some(f => f.isEnabled && f.filterType === 'percent_sale')) return true;
  if (!payload.facets) return payload.cfpCards?.facetsReady !== true;
  return payload.facets.percentSale?.version === 1;
}
