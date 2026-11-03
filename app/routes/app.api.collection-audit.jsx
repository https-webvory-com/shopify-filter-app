import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import redis from '../services/redis.server.js';
import { enqueueCollectionMembershipAudit } from '../services/collectionMembershipAudit.server.js';

async function ownedCollection(shop, request) {
  const url = new URL(request.url);
  const handle = request.method === 'POST'
    ? String((await request.formData()).get('handle') || '')
    : String(url.searchParams.get('handle') || '');
  if (!/^[a-z0-9][a-z0-9-]{0,254}$/i.test(handle)) return null;
  return prisma.collection.findFirst({ where: { shop, handle }, select: { id: true, handle: true } });
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const collection = await ownedCollection(session.shop, request);
  if (!collection) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const raw = await redis.get(`membershipAuditStatus:${session.shop}:${collection.id}`);
  return Response.json({ collection: collection.handle, status: raw ? JSON.parse(raw) : null });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const collection = await ownedCollection(session.shop, request);
  if (!collection) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const job = await enqueueCollectionMembershipAudit(session.shop, collection.id);
  return Response.json({ collection: collection.handle, ...job }, { status: 202 });
}
