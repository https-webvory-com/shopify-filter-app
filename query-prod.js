const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const prod = await prisma.product.findFirst({
    where: { title: { contains: 'Peplum Jersey Floor Length' } }
  });
  console.log(JSON.stringify(prod, null, 2));
}
main().finally(() => prisma.$disconnect());
