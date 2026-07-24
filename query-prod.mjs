import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const prod = await prisma.product.findFirst({
    where: { handle: 'plus-size-long-prom-dress-formal' }
  });
  console.log(JSON.stringify(prod.options, null, 2));
  console.log(JSON.stringify(prod.variants, null, 2));
}
main().finally(() => prisma.$disconnect());
