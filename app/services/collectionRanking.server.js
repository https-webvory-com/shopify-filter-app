import redis from "./redis.server.js";
import { unauthenticated } from "../shopify.server";
import { fetchCollectionBestSellingIds } from "../utils/collectionBestSelling.js";
import { createBackgroundSnapshot } from "../utils/backgroundSnapshot.js";

const getSnapshot = createBackgroundSnapshot({
  read: async key => {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },
  // Retain the last successful order through refresh failures.
  write: (key, value) => redis.setex(key, 86400, JSON.stringify(value)),
  refresh: async ({ shop, collectionId }) => {
    const { admin } = await unauthenticated.admin(shop);
    const id = String(collectionId).startsWith("gid://") ? collectionId : `gid://shopify/Collection/${collectionId}`;
    return fetchCollectionBestSellingIds(admin, id);
  },
  onError: error => console.error("CFP collection ranking refresh failed:", error.message),
});

export function getCollectionRanking(shop, collectionId) {
  return getSnapshot(`collectionRanking:v2:${shop}:${collectionId}`, { shop, collectionId });
}
