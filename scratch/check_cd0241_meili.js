import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const prod = await prisma.product.findUnique({
    where: { id: "gid://shopify/Product/15138310390131" },
    include: { variants: true }
  });
  console.log("Product 15138310390131 in Prisma DB:");
  if (prod) {
    console.log("Title:", prod.title);
    console.log("Images:", prod.images);
    console.log("Variants:", JSON.stringify(prod.variants, null, 2));
  } else {
    console.log("Not found in Prisma DB");
  }
}

check().finally(() => prisma.$disconnect());
