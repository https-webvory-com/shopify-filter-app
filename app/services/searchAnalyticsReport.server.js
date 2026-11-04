import prisma from '../db.server.js';
import { Prisma } from '@prisma/client';

const metric = value => Number(value || 0);

export async function searchAnalyticsReport(shop, { days = 30, now = new Date(), database = prisma } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '') ||
      !Number.isInteger(days) || days < 1 || days > 90) throw Error('Invalid analytics report scope');
  const since = new Date(now.getTime() - days * 86400000);
  const rows = await database.$queryRaw`
    WITH searches AS (
      SELECT "searchId", "query", "hits", "market", "at"
      FROM "SearchAnalyticsEvent"
      WHERE "shop" = ${shop} AND "event" = 'search_query' AND "at" >= ${since}
        AND "searchId" IS NOT NULL
    ), clicks AS (
      SELECT DISTINCT "searchId" FROM "SearchAnalyticsEvent"
      WHERE "shop" = ${shop} AND "event" = 'result_click' AND "at" >= ${since}
    ), carts AS (
      SELECT DISTINCT "searchId" FROM "SearchAnalyticsEvent"
      WHERE "shop" = ${shop} AND "event" = 'add_to_cart' AND "at" >= ${since}
    ), grouped AS (
      SELECT searches."query", COUNT(*) AS "searches",
        COUNT(*) FILTER (WHERE searches."hits" = 0) AS "zeroResults",
        COUNT(clicks."searchId") AS "clicks", COUNT(carts."searchId") AS "cartAdds"
      FROM searches
      LEFT JOIN clicks ON clicks."searchId" = searches."searchId"
      LEFT JOIN carts ON carts."searchId" = searches."searchId"
      GROUP BY searches."query"
    ), totals AS (
      SELECT SUM("searches") AS "totalSearches", SUM("zeroResults") AS "totalZeroResults",
        SUM("clicks") AS "totalClicks", SUM("cartAdds") AS "totalCartAdds" FROM grouped
    )
    SELECT grouped.*, totals.* FROM grouped CROSS JOIN totals
    ORDER BY grouped."searches" DESC LIMIT 1000
  `;
  const queries = rows.map(row => {
    const searches = metric(row.searches), clicks = metric(row.clicks), cartAdds = metric(row.cartAdds);
    return { query: row.query || '', searches, zeroResults: metric(row.zeroResults), clicks, cartAdds,
      ctr: searches ? clicks / searches : 0, cartRate: searches ? cartAdds / searches : 0 };
  });
  const summary = { searches: metric(rows[0]?.totalSearches), zeroResults: metric(rows[0]?.totalZeroResults),
    clicks: metric(rows[0]?.totalClicks), cartAdds: metric(rows[0]?.totalCartAdds) };
  return { shop, days, since: since.toISOString(), summary: { ...summary,
    zeroRate: summary.searches ? summary.zeroResults / summary.searches : 0,
    ctr: summary.searches ? summary.clicks / summary.searches : 0,
    cartRate: summary.searches ? summary.cartAdds / summary.searches : 0 },
    top: queries.slice(0, 20),
    zero: [...queries].sort((a,b) => b.zeroResults - a.zeroResults).filter(row => row.zeroResults > 0).slice(0, 20),
    lowCtr: queries.filter(row => row.searches >= 10).sort((a,b) => a.ctr - b.ctr || b.searches - a.searches).slice(0, 20) };
}

export const ANALYTICS_TABS = ['volume', 'queries', 'filters', 'products', 'locations', 'zero'];
export const ANALYTICS_GROUPS = ['hour', 'day', 'week', 'month', 'year', 'hour_of_day', 'day_of_week'];

const utcDay = date => date.toISOString().slice(0, 10);
const asNumber = value => Number(value || 0);
const friendlyFilter = key => ({ vendors: 'Vendor', types: 'Product type', tags: 'Tag', titles: 'Title',
  collections: 'Collection', minPrice: 'Minimum price', maxPrice: 'Maximum price',
  availability: 'Availability', weightRanges: 'Weight', ratingRanges: 'Rating',
  locations: 'Location', saleRanges: 'Sale', priceRanges: 'Price' })[key] ||
  key.replace(/^(options|metafields)\./, '').replace(/([a-z])([A-Z])/g, '$1 $2');

export function analyticsRange(searchParams, now = new Date()) {
  const endDefault = utcDay(now);
  const startDefault = utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30)));
  const from = searchParams.get('from') || startDefault;
  const to = searchParams.get('to') || endDefault;
  const tab = ANALYTICS_TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'volume';
  const group = ANALYTICS_GROUPS.includes(searchParams.get('group')) ? searchParams.get('group') : 'day';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Error('Invalid analytics dates');
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const span = (end - start) / 86400000;
  if (!Number.isFinite(span) || utcDay(start) !== from || utcDay(end) !== to || span < 0 || span > 395 ||
      end > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
    throw Error('Invalid analytics date range');
  return { from, to, tab, group, start, endExclusive: new Date(end.getTime() + 86400000) };
}

const tabQuery = {
  volume: { event: 'search_query', key: Prisma.sql`'Volume'`, extra: Prisma.empty },
  queries: { event: 'search_query', key: Prisma.sql`COALESCE("query", '')`, extra: Prisma.sql`AND "query" IS NOT NULL AND "query" <> ''` },
  filters: { event: 'filter_apply', key: Prisma.sql`("filterKey" || ' - ' || "filterValue")`, extra: Prisma.sql`AND "filterKey" IS NOT NULL AND "filterValue" IS NOT NULL` },
  products: { event: 'result_click', key: Prisma.sql`"productId"`, extra: Prisma.sql`AND "productId" IS NOT NULL` },
  locations: { event: 'search_query', key: Prisma.sql`"market"`, extra: Prisma.sql`AND "market" IS NOT NULL` },
  zero: { event: 'search_query', key: Prisma.sql`COALESCE("query", '')`, extra: Prisma.sql`AND "hits" = 0 AND "query" IS NOT NULL AND "query" <> ''` },
};

function bucketLabel(value, group) {
  if (group === 'hour_of_day' || group === 'day_of_week') return String(value).padStart(2, '0');
  const date = new Date(value);
  if (group === 'hour') return date.toISOString().slice(0, 13) + ':00';
  if (group === 'day') return utcDay(date);
  if (group === 'month') return date.toISOString().slice(0, 7);
  if (group === 'year') return String(date.getUTCFullYear());
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7));
  return utcDay(monday);
}

const bucketSql = {
  hour: Prisma.sql`date_trunc('hour', "at")`,
  day: Prisma.sql`date_trunc('day', "at")`,
  week: Prisma.sql`date_trunc('week', "at")`,
  month: Prisma.sql`date_trunc('month', "at")`,
  year: Prisma.sql`date_trunc('year', "at")`,
  hour_of_day: Prisma.sql`EXTRACT(HOUR FROM "at")::int`,
  day_of_week: Prisma.sql`((EXTRACT(DOW FROM "at")::int + 6) % 7)`,
};

export async function analyticsDashboard(shop, range, database = prisma) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '') || !tabQuery[range.tab])
    throw Error('Invalid analytics scope');
  const { event, key, extra } = tabQuery[range.tab];
  const scope = Prisma.sql`"shop" = ${shop} AND "at" >= ${range.start} AND "at" < ${range.endExclusive} AND "event" = ${event} ${extra}`;
  const rawRows = await database.$queryRaw(Prisma.sql`
    SELECT ${key} AS "key", COUNT(*) AS "hits"
    FROM "SearchAnalyticsEvent" WHERE ${scope}
    GROUP BY 1 ORDER BY "hits" DESC, "key" ASC LIMIT 100`);
  const rows = rawRows.map(row => ({ key: String(row.key ?? ''), label: String(row.key ?? ''), hits: asNumber(row.hits) }));
  if (range.tab === 'filters') for (const row of rows) {
    const separator = row.key.indexOf(' - ');
    if (separator > 0) row.label = `${friendlyFilter(row.key.slice(0, separator))} - ${row.key.slice(separator + 3)}`;
  }
  if (range.tab === 'products' && rows.length) {
    const products = await database.product.findMany({ where: { shop, id: { in: rows.map(row => `gid://shopify/Product/${row.key}`) } },
      select: { id: true, title: true, handle: true } });
    const lookup = new Map(products.map(product => [product.id.split('/').pop(), product]));
    for (const row of rows) {
      const product = lookup.get(row.key);
      row.label = product?.title || `Product ${row.key}`;
      row.url = product?.handle ? `/products/${encodeURIComponent(product.handle)}` : null;
    }
  }
  if (range.tab === 'locations' || !rows.length) return { ...range, rows, chart: [] };
  const topKeys = rows.slice(0, range.tab === 'volume' ? 1 : 5).map(row => row.key);
  const bucket = bucketSql[range.group] || bucketSql.day;
  const rawChart = await database.$queryRaw(Prisma.sql`
    SELECT ${bucket} AS "bucket", ${key} AS "key", COUNT(*) AS "hits"
    FROM "SearchAnalyticsEvent" WHERE ${scope} AND ${key} IN (${Prisma.join(topKeys)})
    GROUP BY 1, 2 ORDER BY 1 ASC`);
  const grouped = new Map();
  for (const row of rawChart) {
    const bucket = bucketLabel(row.bucket, range.group);
    const item = grouped.get(bucket) || { bucket, values: {} };
    item.values[String(row.key)] = (item.values[String(row.key)] || 0) + asNumber(row.hits);
    grouped.set(bucket, item);
  }
  const chart = [...grouped.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  if (range.tab === 'volume') return { ...range,
    rows: chart.map(point => ({ key: point.bucket, label: point.bucket, hits: point.values.Volume || 0 })),
    chart, topKeys };
  return { ...range, rows, chart, topKeys };
}
