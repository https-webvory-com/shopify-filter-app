import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  try {
    const settings = await prisma.filterSettings.findUnique({
      where: { shop: "thedressoutlet.myshopify.com" }
    });
    console.log("Current DB FilterSettings for shop:", settings);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
