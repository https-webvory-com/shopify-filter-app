import prisma from '../db.server.js';
import redis from './redis.server.js';
import meiliClient from './meiliClient.server.js';
import { productRevisionKey } from '../utils/shopCacheInvalidation.js';

const key = (shop, country) => `marketPriceIntentReady:${shop}:${country}`;
const validShop = shop => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
const validCountry = country => /^[A-Z]{2}$/.test(country || '');
const observedCountriesKey = shop => `marketPriceObservedCountries:${shop}`;
const observedShopsKey = 'marketPriceObservedShops';

export async function marketPriceCountriesForShop(shop) {
  if (!validShop(shop)) return [];
  const [observed, connection] = await Promise.all([
    redis.smembers?.(observedCountriesKey(shop)) || [],
    prisma.marketStorefrontConnection?.findUnique?.({ where: { shop }, select: { countries: true } }) || null,
  ]);
  return [...new Set([...(observed || []), ...(connection?.countries || [])])].filter(validCountry).sort();
}

export async function allMarketPriceCountries() {
  const [observed, connections] = await Promise.all([
    redis.smembers?.('marketPriceObservedAllCountries') || [],
    prisma.marketStorefrontConnection?.findMany?.({ select: { countries: true } }) || [],
  ]);
  return [...new Set([...(observed || []), ...connections.flatMap(row => row.countries || [])])].filter(validCountry).sort();
}

async function revisions(shop) {
  const [products, index] = await Promise.all([
    redis.get(productRevisionKey(shop, 'all')), redis.get(`searchIndexRevision:${shop}`),
  ]);
  return { products: products || '0', index: index || '0' };
}

export async function marketPriceIntentReady(shop, country) {
  if (!validShop(shop) || !validCountry(country)) return false;
  try {
    if (redis.sadd) await Promise.all([
      redis.sadd(observedCountriesKey(shop), country),
      redis.sadd(observedShopsKey, shop),
      redis.sadd('marketPriceObservedAllCountries', country),
    ]);
    const [raw, current] = await Promise.all([
      redis.get(key(shop, country)), revisions(shop),
    ]);
    if (!raw) return false;
    const proof = JSON.parse(raw);
    return proof.products === current.products && proof.index === current.index &&
      proof.uid === 'products' && proof.country === country && proof.complete === true;
  } catch { return false; }
}

export async function refreshMarketPriceCoverage(shop, country) {
  if (!validShop(shop) || !validCountry(country)) throw Error('Invalid market price coverage scope');
  const before = await revisions(shop);
  const rows = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT p."id")::integer AS products,
      COUNT(v."id")::integer AS variants,
      COUNT(v."id") FILTER (WHERE v."marketPrices" -> ${country} ->> 'price' IS NOT NULL
        AND v."marketPrices" -> ${country} ->> 'currency' IS NOT NULL)::integer AS priced
    FROM "Product" p LEFT JOIN "Variant" v ON v."productId" = p."id"
    WHERE p."shop" = ${shop} AND lower(p."status") = 'active'
  `;
  const row = rows[0] || {};
  let complete = row.products > 0 && row.variants > 0 && row.variants === row.priced;
  if (complete) {
    const index = meiliClient.index('products');
    const field = `marketPriceMin_${country}`;
    const settings = await index.getFilterableAttributes();
    complete = Array.isArray(settings) && settings.includes(field) &&
      settings.includes(`marketAvailablePriceMin_${country}`);
    if (complete) {
      const base = [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'"];
      const [all, priced, inStock, pricedInStock] = await Promise.all([
        index.search('', { filter: base, hitsPerPage: 1, page: 1, attributesToRetrieve: [] }),
        index.search('', { filter: [...base, `${field} EXISTS`], hitsPerPage: 1, page: 1, attributesToRetrieve: [] }),
        index.search('', { filter: [...base, 'available = true'], hitsPerPage: 1, page: 1, attributesToRetrieve: [] }),
        index.search('', { filter: [...base, 'available = true', `marketAvailablePriceMin_${country} EXISTS`], hitsPerPage: 1, page: 1, attributesToRetrieve: [] }),
      ]);
      complete = Number.isSafeInteger(all.totalHits) && all.totalHits === row.products &&
        priced.totalHits === all.totalHits && pricedInStock.totalHits === inStock.totalHits;
    }
  }
  const after = await revisions(shop);
  if (before.products !== after.products || before.index !== after.index) complete = false;
  if (complete) await redis.setex(key(shop, country), 900, JSON.stringify({ ...after, uid: 'products', country, complete: true }));
  else await redis.del(key(shop, country));
  return { shop, country, complete, products: row.products || 0, variants: row.variants || 0, priced: row.priced || 0 };
}

export async function refreshConnectedMarketPriceCoverage() {
  const connections = await prisma.marketStorefrontConnection.findMany({ select: { shop: true, countries: true } });
  const observedShops = await redis.smembers?.(observedShopsKey) || [];
  const shops = [...new Set([...connections.map(connection => connection.shop), ...observedShops])].filter(validShop);
  const results = [];
  for (const shop of shops) for (const country of await marketPriceCountriesForShop(shop)) {
    if (!validCountry(country)) continue;
    try {
      const result = await refreshMarketPriceCoverage(shop, country);
      results.push(result);
      // Price coverage is observed here. Rebuilding the entire catalog for a
      // missing country price is an explicit merchant operation, not a timer
      // side effect; shoppers can use the saved-price partial ranking meanwhile.
    } catch (error) { console.error('Market price coverage unavailable:', shop, country, error.name); }
  }
  return results;
}
