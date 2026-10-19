CREATE TABLE "CollectionLoadingSnapshot" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "generation" TEXT NOT NULL,
  "payload" BYTEA NOT NULL,
  "size" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "validatedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionLoadingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CollectionLoadingSnapshot_shop_kind_updatedAt_idx" ON "CollectionLoadingSnapshot"("shop", "kind", "updatedAt");
CREATE INDEX "CollectionLoadingSnapshot_aliases_idx" ON "CollectionLoadingSnapshot" USING GIN ("aliases");
CREATE INDEX "CollectionLoadingSnapshot_expiresAt_idx" ON "CollectionLoadingSnapshot"("expiresAt");
