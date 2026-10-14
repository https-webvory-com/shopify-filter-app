CREATE TABLE "SearchRedirect" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchRedirect_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SearchRedirectQuery" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "redirectId" TEXT NOT NULL,
  CONSTRAINT "SearchRedirectQuery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SearchRedirect_shop_idx" ON "SearchRedirect"("shop");
CREATE UNIQUE INDEX "SearchRedirectQuery_shop_query_key" ON "SearchRedirectQuery"("shop", "query");
CREATE INDEX "SearchRedirectQuery_redirectId_idx" ON "SearchRedirectQuery"("redirectId");
ALTER TABLE "SearchRedirectQuery" ADD CONSTRAINT "SearchRedirectQuery_redirectId_fkey" FOREIGN KEY ("redirectId") REFERENCES "SearchRedirect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
