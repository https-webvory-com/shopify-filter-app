import prisma from '../app/db.server.js';

async function main() {
  const shop = "test-wishlist-prov.myshopify.com";
  const baseWhere = {
    shop,
    status: "active",
  };

  const baseProducts = await prisma.product.findMany({
    where: baseWhere,
    select: {
      tags: true,
    },
  });

  const tagCounts = {};
  baseProducts.forEach((p) => {
     if (p.tags) {
       p.tags.forEach((tag) => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
     }
  });

  console.log("tagCounts keys count:", Object.keys(tagCounts).length);
  // filter tags starting with Length or length
  const lengthTags = {};
  Object.keys(tagCounts).forEach(k => {
    if (k.toLowerCase().startsWith('length')) {
      lengthTags[k] = tagCounts[k];
    }
  });
  console.log("Length Tags in facets:", lengthTags);
}

main().catch(console.error).finally(() => prisma.$disconnect());
