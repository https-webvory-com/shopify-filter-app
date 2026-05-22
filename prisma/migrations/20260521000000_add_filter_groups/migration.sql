-- CreateTable
CREATE TABLE "FilterGroup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterGroupCollection" (
    "id" TEXT NOT NULL,
    "filterGroupId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'collection',

    CONSTRAINT "FilterGroupCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterGroupItem" (
    "id" TEXT NOT NULL,
    "filterGroupId" TEXT NOT NULL,
    "filterType" TEXT NOT NULL,
    "filterKey" TEXT,
    "label" TEXT NOT NULL,
    "displayMode" TEXT NOT NULL DEFAULT 'list',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,

    CONSTRAINT "FilterGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergedValue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "filterType" TEXT NOT NULL,
    "filterKey" TEXT,
    "targetValue" TEXT NOT NULL,
    "sourceValues" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MergedValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilterGroup_shop_idx" ON "FilterGroup"("shop");

-- CreateIndex
CREATE INDEX "FilterGroupCollection_filterGroupId_idx" ON "FilterGroupCollection"("filterGroupId");

-- CreateIndex
CREATE INDEX "FilterGroupItem_filterGroupId_idx" ON "FilterGroupItem"("filterGroupId");

-- CreateIndex
CREATE INDEX "MergedValue_shop_filterType_idx" ON "MergedValue"("shop", "filterType");

-- AddForeignKey
ALTER TABLE "FilterGroupCollection" ADD CONSTRAINT "FilterGroupCollection_filterGroupId_fkey" FOREIGN KEY ("filterGroupId") REFERENCES "FilterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterGroupItem" ADD CONSTRAINT "FilterGroupItem_filterGroupId_fkey" FOREIGN KEY ("filterGroupId") REFERENCES "FilterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
