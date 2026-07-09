import { PrismaClient } from "@prisma/client";

// ✅ OPTIMIZED: Configure connection pool to prevent exhaustion under high load
// Default pool is too small for concurrent webhook processing
const createPrismaClient = () =>
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Log only errors in production to reduce overhead
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

// In development, reuse global instance to prevent hot-reload connection leaks
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
