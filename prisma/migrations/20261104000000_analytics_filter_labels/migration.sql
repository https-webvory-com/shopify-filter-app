ALTER TABLE "SearchAnalyticsEvent"
  ADD COLUMN "filterKey" TEXT,
  ADD COLUMN "filterValue" TEXT;

CREATE INDEX "SearchAnalyticsEvent_shop_at_filterKey_idx"
  ON "SearchAnalyticsEvent" ("shop", "at", "filterKey");
