-- Create Extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

/*
  Warnings:

  - You are about to drop the column `collectionId` on the `PinnedProductRule` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "PinnedProductRule_shop_collectionId_key";

-- AlterTable
ALTER TABLE "MerchandisingRule" ADD COLUMN     "ruleType" TEXT NOT NULL DEFAULT 'collection',
ADD COLUMN     "searchQueries" TEXT[];

-- AlterTable
ALTER TABLE "MergedValue" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PinnedProductRule" DROP COLUMN "collectionId",
ADD COLUMN     "applyToAll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "applyToSearchType" TEXT NOT NULL DEFAULT 'both',
ADD COLUMN     "collections" TEXT[],
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Pinning Rule',
ADD COLUMN     "ruleType" TEXT NOT NULL DEFAULT 'collection',
ADD COLUMN     "searchQueries" TEXT[],
ADD COLUMN     "status" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "FilterGlobalSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "horizontalFilters" BOOLEAN NOT NULL DEFAULT false,
    "mobileFilterLayout" TEXT NOT NULL DEFAULT 'off-canvas',
    "showAttributeBasedBreadcrumb" BOOLEAN NOT NULL DEFAULT true,
    "showFilterOptionsWithOneItem" BOOLEAN NOT NULL DEFAULT false,
    "showProductCount" BOOLEAN NOT NULL DEFAULT true,
    "scrollUpOnFilterValuesChange" BOOLEAN NOT NULL DEFAULT false,
    "hideUnavailableVariantsWhenSelected" BOOLEAN NOT NULL DEFAULT false,
    "desktopLikeOnMobile" BOOLEAN NOT NULL DEFAULT false,
    "darkMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterGlobalSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "cursor" TEXT,
    "productsProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalProducts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Synonym" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "synonyms" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Synonym_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterGlobalSetting_shop_key" ON "FilterGlobalSetting"("shop");

-- CreateIndex
CREATE INDEX "SyncJob_shop_status_idx" ON "SyncJob"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Synonym_shop_word_key" ON "Synonym"("shop", "word");

-- CreateIndex
CREATE INDEX "Product_options_idx" ON "Product" USING GIN ("options");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product" USING GIN ("productType" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_tags_idx" ON "Product" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Product_title_idx" ON "Product" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_vendor_idx" ON "Product" USING GIN ("vendor" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Variant_option1_idx" ON "Variant" USING GIN ("option1" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Variant_option2_idx" ON "Variant" USING GIN ("option2" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Variant_option3_idx" ON "Variant" USING GIN ("option3" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Variant_sku_idx" ON "Variant" USING GIN ("sku" gin_trgm_ops);
