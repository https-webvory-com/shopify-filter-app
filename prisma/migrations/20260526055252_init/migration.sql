-- CreateTable
CREATE TABLE "PinnedProductRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PinnedProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PinnedProductRule_shop_idx" ON "PinnedProductRule"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedProductRule_shop_collectionId_key" ON "PinnedProductRule"("shop", "collectionId");
