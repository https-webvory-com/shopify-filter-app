import { unauthenticated } from '../shopify.server.js';
import { getCached } from './shopCache.server.js';
import { readCollectionBestSellingIds } from '../utils/collectionBestSelling.js';

const pending = new Map();
export async function getCollectionBestSellingIds(shop, collectionId, waitMs = 1500) {
  const key = `collectionBestSelling:${shop}:${collectionId}`;
  let work = pending.get(key);
  if (!work) {
    work = getCached(key, async () => {
      const {admin} = await unauthenticated.admin(shop);
      return readCollectionBestSellingIds(admin, collectionId);
    }, 300);
    pending.set(key, work);
    work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(()=>{});
    work.catch(error => console.error('CFP: Collection order refresh failed:', shop, error.message));
  }
  // Large collections warm their ID-only snapshot in the background. A slow or
  // unavailable Shopify API must never prevent product cards from rendering.
  let timer;
  try {
    return await Promise.race([work, new Promise(resolve=>{timer=setTimeout(()=>resolve(null),waitMs);})]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
