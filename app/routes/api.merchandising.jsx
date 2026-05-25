import { data } from "react-router";
import { getActiveRuleForCollection } from "../services/merchandising.server";
import prisma from "../db.server";

/**
 * API Endpoint: /api/merchandising
 * Method: GET
 * Purpose: Returns the active merchandising rule for a given collection on the storefront.
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const collectionHandle = url.searchParams.get("collectionHandle");
  const collectionId = url.searchParams.get("collectionId");

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  try {
    let resolvedCollectionTitle = "";

    // Resolve Collection Title
    if (collectionHandle && collectionHandle.toLowerCase() !== 'all') {
      const coll = await prisma.collection.findFirst({
        where: { handle: collectionHandle, shop }
      });
      if (coll) resolvedCollectionTitle = coll.title;
    } else if (collectionId) {
      const coll = await prisma.collection.findUnique({
        where: { id: collectionId }
      });
      if (coll) resolvedCollectionTitle = coll.title;
    }

    if (!resolvedCollectionTitle) {
      return data({ rule: null, message: "No collection matched." }, { status: 404 });
    }

    const activeRule = await getActiveRuleForCollection(shop, resolvedCollectionTitle);

    return data({ rule: activeRule });
  } catch (error) {
    console.error("Error in api.merchandising.jsx:", error);
    return data({ error: "Internal Server Error" }, { status: 500 });
  }
};
