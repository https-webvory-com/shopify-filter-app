import prisma from '../db.server.js';

// Replace a shop's sales scores in one database statement. A failed order
// fetch must never clear the scores currently used by collection ranking.
export async function replaceSalesMetrics(shop, aggregations, database = prisma) {
  const rows = Object.entries(aggregations).map(([id, stats]) => ({
    id,
    unitsLifetime: stats.unitsLifetime,
    unitsSold60Days: stats.unitsSold60Days,
    unitsSold7Days: stats.unitsSold7Days,
    grossRevenue: stats.revenueLifetime,
    orderCount: stats.orderCount,
    bestSellingScore: stats.unitsLifetime,
    trendingScore: Number((stats.unitsLifetime * 0.4 + stats.unitsSold7Days * 0.6).toFixed(2)),
  }));
  return database.$executeRaw`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS metric(
        id text, "unitsLifetime" integer, "unitsSold60Days" integer,
        "unitsSold7Days" integer, "grossRevenue" double precision,
        "orderCount" integer, "bestSellingScore" double precision,
        "trendingScore" double precision
      )
    ), scoped AS (
      SELECT product.id,
        COALESCE(metric."unitsLifetime", 0) AS "unitsLifetime",
        COALESCE(metric."unitsSold60Days", 0) AS "unitsSold60Days",
        COALESCE(metric."unitsSold7Days", 0) AS "unitsSold7Days",
        COALESCE(metric."grossRevenue", 0) AS "grossRevenue",
        COALESCE(metric."orderCount", 0) AS "orderCount",
        COALESCE(metric."bestSellingScore", 0) AS "bestSellingScore",
        COALESCE(metric."trendingScore", 0) AS "trendingScore"
      FROM "Product" AS product
      LEFT JOIN incoming AS metric ON metric.id = product.id
      WHERE product.shop = ${shop}
    )
    UPDATE "Product" AS product SET
      "unitsLifetime" = scoped."unitsLifetime",
      "unitsSold60Days" = scoped."unitsSold60Days",
      "unitsSold7Days" = scoped."unitsSold7Days",
      "grossRevenue" = scoped."grossRevenue",
      "orderCount" = scoped."orderCount",
      "bestSellingScore" = scoped."bestSellingScore",
      "trendingScore" = scoped."trendingScore",
      "updatedAt" = NOW()
    FROM scoped WHERE product.id = scoped.id AND product.shop = ${shop}
  `;
}
