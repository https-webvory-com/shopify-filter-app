-- Preserve size-chart opt-in for existing settings, then default new shops to off.
BEGIN;
ALTER TABLE "FilterGlobalSetting"
  ADD COLUMN "quickViewStyle" TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN "showQuickViewSizeChart" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FilterGlobalSetting"
  ALTER COLUMN "showQuickViewSizeChart" SET DEFAULT false;
COMMIT;
