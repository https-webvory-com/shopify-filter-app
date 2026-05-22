import prisma from "../app/db.server.js";
import shopify from "../app/shopify.server.js";

async function run() {
  const sessions = await prisma.session.findMany({
    where: { shop: "collection-filter-pro.myshopify.com" }
  });
  if (sessions.length === 0) {
    console.error("No session found for shop");
    return;
  }
  const session = sessions[0];
  const client = new shopify.api.clients.Graphql({ session });
  
  const response = await client.request(
    `#graphql
    query getProduct($id: ID!) {
      product(id: $id) {
        id
        title
        status
        totalInventory
        variants(first: 10) {
          nodes {
            id
            title
            price
            inventoryQuantity
            availableForSale
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 10) {
                nodes {
                  id
                  location {
                    id
                    name
                    isActive
                  }
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: { id: "gid://shopify/Product/7455481135159" }
    }
  );
  console.log(JSON.stringify(response.data, null, 2));
}

run().catch(console.error);
