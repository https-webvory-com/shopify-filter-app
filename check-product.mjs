import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const p = await prisma.product.findFirst({
    where: {
      title: 'Classic Black Formal Evening Gown with 3D Flowers'
    },
    select: {
      id: true,
      title: true,
      bestSellingScore: true,
      unitsSold60Days: true,
      unitsSold7Days: true,
      orderCount: true
    }
  });
  console.log(JSON.stringify(p, null, 2));
}

run();
