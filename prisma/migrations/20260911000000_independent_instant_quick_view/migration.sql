ALTER TABLE "FilterGlobalSetting"
  ADD COLUMN IF NOT EXISTS "quickViewInstantSearchStyle" TEXT,
  ADD COLUMN IF NOT EXISTS "showQuickViewInstantSearchSizeChart" BOOLEAN;

UPDATE "FilterGlobalSetting"
SET "quickViewInstantSearchStyle" = COALESCE("quickViewInstantSearchStyle", "quickViewStyle"),
    "showQuickViewInstantSearchSizeChart" = COALESCE("showQuickViewInstantSearchSizeChart", "showQuickViewSizeChart")
WHERE "quickViewInstantSearchStyle" IS NULL OR "showQuickViewInstantSearchSizeChart" IS NULL;
