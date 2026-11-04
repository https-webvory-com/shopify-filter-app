CREATE TABLE "SearchAnalyticsEvent" (
  "eventId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anonId" TEXT NOT NULL,
  "sessionId" TEXT,
  "searchId" TEXT,
  "listingId" TEXT,
  "market" TEXT,
  "locale" TEXT,
  "query" TEXT,
  "hits" INTEGER,
  "position" INTEGER,
  "productId" TEXT,
  "variantId" TEXT,
  "ruleId" TEXT,
  "experimentId" TEXT,
  "experimentVariant" TEXT,
  CONSTRAINT "SearchAnalyticsEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "SearchAnalyticsEvent_shop_at_event_idx" ON "SearchAnalyticsEvent"("shop", "at", "event");
CREATE INDEX "SearchAnalyticsEvent_shop_searchId_idx" ON "SearchAnalyticsEvent"("shop", "searchId");
CREATE INDEX "SearchAnalyticsEvent_shop_experimentId_at_idx" ON "SearchAnalyticsEvent"("shop", "experimentId", "at");
CREATE INDEX "SearchAnalyticsEvent_at_idx" ON "SearchAnalyticsEvent"("at");
