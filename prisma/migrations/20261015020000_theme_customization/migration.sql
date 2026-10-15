CREATE TABLE "ThemeCustomization" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "themeId" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThemeCustomization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ThemeCustomization_shop_themeId_key" ON "ThemeCustomization"("shop", "themeId");
