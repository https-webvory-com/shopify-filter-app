-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "options" JSONB;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "option1" TEXT,
ADD COLUMN     "option2" TEXT,
ADD COLUMN     "option3" TEXT;

-- CreateTable
CREATE TABLE "ProductMetafield" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "ProductMetafield_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductMetafield_namespace_key_idx" ON "ProductMetafield"("namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMetafield_productId_namespace_key_key" ON "ProductMetafield"("productId", "namespace", "key");

-- AddForeignKey
ALTER TABLE "ProductMetafield" ADD CONSTRAINT "ProductMetafield_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
