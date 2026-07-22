import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let shopifyStats = null;

  try {
    const shop = session.shop;
    const token = session.accessToken;
    const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
    const apiBase = `https://${shop}/admin/api/2025-10`;

    const [activeRes, draftRes, archivedRes] = await Promise.all([
      fetch(`${apiBase}/products/count.json?status=active`, { headers }),
      fetch(`${apiBase}/products/count.json?status=draft`,  { headers }),
      fetch(`${apiBase}/products/count.json?status=archived`, { headers }),
    ]);

    const activeCount   = (await activeRes.json())?.count   ?? 0;
    const draftCount    = (await draftRes.json())?.count    ?? 0;
    const archivedCount = (await archivedRes.json())?.count ?? 0;

    const colRes = await admin.graphql(`#graphql
      query {
        allCollections: collectionsCount { count }
        publishedCollections: collectionsCount(query: "published_status:published") { count }
        smartCollections: collectionsCount(query: "collection_type:smart") { count }
      }
    `);
    const colData = (await colRes.json())?.data;

    shopifyStats = {
      activeProducts:       activeCount,
      draftProducts:        draftCount,
      archivedProducts:     archivedCount,
      totalProducts:        activeCount + draftCount + archivedCount,
      allCollections:       colData?.allCollections?.count       ?? 0,
      publishedCollections: colData?.publishedCollections?.count ?? 0,
      smartCollections:     colData?.smartCollections?.count     ?? 0,
    };
  } catch (e) {
    console.error("CFP: Store stats fetch error:", e?.message);
  }

  return Response.json(shopifyStats);
};
