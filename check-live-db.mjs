import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.SERVER_DATABASE_URL,
    },
  },
});

async function run() {
  try {
    // Let's get the store
    const store = await prisma.session.findFirst();
    const shop = store ? store.shop : 'unknown';
    console.log("Connected to live DB. Found shop:", shop);

    // Let's check "Classic Black Formal Evening Gown with 3D Flowers" in LIVE DB
    const productByLiveID = await prisma.product.findUnique({
      where: {
        id: "gid://shopify/Product/15290791428467" // This was the ID the user showed in JSON earlier, maybe it's the real one
      },
      select: {
        id: true, title: true, bestSellingScore: true, orderCount: true, grossRevenue: true,
        unitsSold60Days: true, unitsSold7Days: true
      }
    });

    const productsByName = await prisma.product.findMany({
      where: {
        title: {
          contains: "Classic Black Formal Evening Gown with 3D Flowers"
        }
      },
      select: {
        id: true, title: true, bestSellingScore: true, orderCount: true, grossRevenue: true,
        unitsSold60Days: true, unitsSold7Days: true
      },
      take: 2
    });

    console.log("\n--- By Live ID (if valid) ---");
    console.log(productByLiveID);

    console.log("\n--- By Name ---");
    console.log(productsByName);

    // Check top 10 best-selling products overall
    const topProducts = await prisma.product.findMany({
      orderBy: { bestSellingScore: 'desc' },
      take: 10,
      select: {
        id: true, title: true, bestSellingScore: true, orderCount: true, unitsSold60Days: true
      }
    });
    console.log("\n--- Top 10 Best Selling Products in LIVE DB ---");
    topProducts.forEach((p, i) => {
      console.log(`${i+1}. [${p.bestSellingScore}] ${p.title} (ID: ${p.id}, Orders: ${p.orderCount})`);
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
