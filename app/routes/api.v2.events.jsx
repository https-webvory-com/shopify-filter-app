import prisma from '../db.server.js';
import { rateLimit } from '../services/rateLimiter.server.js';
import { normalizeSearchEventBatch } from '../utils/searchAnalytics.js';

const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store' };
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing event body');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new Error('Event body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

export const action = async ({ request }) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  if (!await rateLimit(request)) return Response.json({ error: 'Too many requests' }, { status: 429, headers });
  const shop = new URL(request.url).searchParams.get('shop');
  if (!SHOP.test(shop || '')) return Response.json({ error: 'Invalid shop' }, { status: 400, headers });
  try {
    const installed = await prisma.session.findFirst({ where: { shop, isOnline: false }, select: { id: true } });
    if (!installed) return Response.json({ error: 'Shop not found' }, { status: 404, headers });
    const input = await boundedJson(request);
    const events = normalizeSearchEventBatch(input, { shop });
    const result = await prisma.searchAnalyticsEvent.createMany({ data: events, skipDuplicates: true });
    return Response.json({ accepted: result.count }, { status: 202, headers });
  } catch (error) {
    if (error instanceof SyntaxError || /^(Invalid|Missing|Duplicate|Event body)/.test(error.message))
      return Response.json({ error: error.message }, { status: 400, headers });
    console.error('Search event ingestion failed:', error.name);
    return Response.json({ error: 'Unable to save events' }, { status: 503, headers });
  }
};
