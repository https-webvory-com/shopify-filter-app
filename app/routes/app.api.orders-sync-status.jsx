import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GET /app/api/orders-sync-status
 * Returns the current orders sync job status for polling from the dashboard UI.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Find the most recent orders sync job (IN_PROGRESS or COMPLETED within last hour)
    const latestJob = await prisma.syncJob.findFirst({
      where: {
        shop,
        status: { in: ["IN_PROGRESS", "COMPLETED", "FAILED"] },
        OR: [{ kind: "ORDERS" }, { kind: null, totalProducts: null }]
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestJob) {
      return Response.json({ status: "IDLE", ordersProcessed: 0, totalOrders: null });
    }

    // Auto-expire IN_PROGRESS jobs that haven't updated in 5 minutes (stuck)
    if (latestJob.status === "IN_PROGRESS") {
      const now = new Date();
      const lastUpdate = new Date(latestJob.updatedAt);
      const diffMinutes = (now - lastUpdate) / 1000 / 60;
      if (diffMinutes > 5) {
        await prisma.syncJob.update({
          where: { id: latestJob.id },
          data: { status: "FAILED" }
        });
        return Response.json({
          status: "FAILED",
          ordersProcessed: latestJob.productsProcessed,
          totalOrders: latestJob.totalProducts,
        });
      }
    }

    return Response.json({
      status: latestJob.status,
      ordersProcessed: latestJob.productsProcessed ?? 0,
      totalOrders: latestJob.totalProducts ?? null,
      updatedAt: latestJob.updatedAt,
    });
  } catch (e) {
    console.error("orders-sync-status error:", e);
    return Response.json({ status: "IDLE", ordersProcessed: 0, totalOrders: null });
  }
};
