import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const prod = await prisma.product.findUnique({
    where: { id: "gid://shopify/Product/7222430662717" },
    include: { variants: true }
  });
  console.log("Product 7222430662717:");
  console.log(JSON.stringify(prod, null, 2));
}

check().finally(() => prisma.$disconnect());
