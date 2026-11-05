CREATE TABLE "SizeNumericMapping" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sourceValue" TEXT NOT NULL,
  "sizeUsNumeric" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SizeNumericMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SizeNumericMapping_shop_sourceValue_key" ON "SizeNumericMapping"("shop", "sourceValue");
CREATE INDEX "SizeNumericMapping_shop_idx" ON "SizeNumericMapping"("shop");
ALTER TABLE "Variant" ADD COLUMN "sizeUsNumeric" INTEGER;
ALTER TABLE "Variant" ADD COLUMN "sizeMappingFlag" TEXT;
