-- Run before db push. Safe on first install, existing shops and container restarts.
-- Existing rows opt into charts only when the column is first introduced.
DO $$
BEGIN
  IF to_regclass('"FilterGlobalSetting"') IS NOT NULL THEN
    ALTER TABLE "FilterGlobalSetting"
      ADD COLUMN IF NOT EXISTS "quickViewStyle" TEXT NOT NULL DEFAULT 'app',
      ADD COLUMN IF NOT EXISTS "showQuickViewSizeChart" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "FilterGlobalSetting"
      ALTER COLUMN "showQuickViewSizeChart" SET DEFAULT false;
    ALTER TABLE "FilterGlobalSetting"
      ADD COLUMN IF NOT EXISTS "quickViewInstantSearchStyle" TEXT,
      ADD COLUMN IF NOT EXISTS "showQuickViewInstantSearchSizeChart" BOOLEAN;
    UPDATE "FilterGlobalSetting"
      SET "quickViewInstantSearchStyle" = COALESCE("quickViewInstantSearchStyle", "quickViewStyle"),
          "showQuickViewInstantSearchSizeChart" = COALESCE("showQuickViewInstantSearchSizeChart", "showQuickViewSizeChart")
      WHERE "quickViewInstantSearchStyle" IS NULL OR "showQuickViewInstantSearchSizeChart" IS NULL;
  END IF;
END $$;
