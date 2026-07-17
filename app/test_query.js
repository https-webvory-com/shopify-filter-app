const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  const session = await prisma.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    console.log('No session found');
    return;
  }
  console.log('Token:', session.accessToken, 'Shop:', session.shop);
  const query = `
    query {
      products(first: 5) {
        nodes {
          id
          title
          onlineStoreUrl
          status
          publications(first: 10) {
            nodes {
              catalog {
                title
              }
              publication {
                id
                name
              }
            }
          }
        }
      }
    }
  `;
  const res = await fetch(`https://${session.shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': session.accessToken
    },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test().catch(console.error).finally(() => prisma.$disconnect());
