CREATE TABLE "SearchBanner" (
 "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "query" TEXT NOT NULL,
 "placement" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 1,
 "imageUrl" TEXT NOT NULL DEFAULT '', "targetUrl" TEXT NOT NULL DEFAULT '',
 "description" TEXT NOT NULL DEFAULT '', "heading" TEXT NOT NULL DEFAULT '',
 "content" TEXT NOT NULL DEFAULT '', "buttonLabel" TEXT NOT NULL DEFAULT '',
 "backgroundColor" TEXT NOT NULL DEFAULT '#f4f4f5', "textColor" TEXT NOT NULL DEFAULT '#18181b',
 "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SearchBanner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchBanner_shop_query_placement_position_key" ON "SearchBanner"("shop", "query", "placement", "position");
CREATE INDEX "SearchBanner_shop_query_isActive_idx" ON "SearchBanner"("shop", "query", "isActive");
