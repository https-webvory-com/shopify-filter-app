import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const item = await prisma.filterGroupItem.findUnique({
    where: { id: "cmq7s0rh4000eujd8y7u3wkks" }
  });
  if (item && item.config) {
    const config = typeof item.config === 'string' ? JSON.parse(item.config) : item.config;
    config.excludedValues = []; // Clear excluded values
    
    await prisma.filterGroupItem.update({
      where: { id: "cmq7s0rh4000eujd8y7u3wkks" },
      data: {
        config: config
      }
    });
    console.log("Updated filter group config. Excluded values cleared.");
  } else {
    console.log("Filter item not found or no config.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
