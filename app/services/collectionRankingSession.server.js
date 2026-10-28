import { createHash } from 'node:crypto';
import redis from './redis.server.js';

const lifetimeSeconds = 3600;
export function collectionRankingFingerprint(requestUrl) {
  const url = new URL(requestUrl);
  url.searchParams.delete('page');
  url.searchParams.delete('rankingToken');
  url.searchParams.delete('responseProfile');
  url.searchParams.delete('membershipParentToken');
  url.searchParams.delete('membershipParentQuery');
  url.searchParams.sort();
  return createHash('sha256').update(url.pathname + '?' + url.searchParams.toString()).digest('hex');
}

// A token freezes both eligibility and final ordering for subsequent pages.
export async function getCollectionRankingSession(shop, fingerprint, token) {
  if (!token) return null;
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid collection ranking token');
  const raw = await redis.get(`collectionRankingSession:${shop}:${token}`);
  const session = raw ? JSON.parse(raw) : null;
  if (!session || session.fingerprint !== fingerprint || !Array.isArray(session.ids)) {
    throw new Error('Collection ranking session expired; reload the collection');
  }
  return { ...session, token };
}

export async function saveCollectionRankingSession(shop, fingerprint, ids, updatedAt, metadata = {}, membershipProof = null) {
  const session = { fingerprint, ids, updatedAt, metadata, ...(membershipProof?{membershipProof}:{}) };
  // Identical sequences share one immutable record rather than duplicating a
  // large collection for every visitor. Changed sequences get a new token.
  const digest = createHash('sha256').update(JSON.stringify(session)).digest('hex').slice(0, 32);
  const token = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
  await redis.setex(`collectionRankingSession:${shop}:${token}`, lifetimeSeconds, JSON.stringify(session));
  return { ...session, token };
}
