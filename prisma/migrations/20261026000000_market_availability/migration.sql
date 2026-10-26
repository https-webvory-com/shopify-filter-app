CREATE TABLE "MarketStorefrontConnection" (
  "shop" TEXT NOT NULL PRIMARY KEY,
  "accessToken" TEXT NOT NULL,
  "countries" TEXT[] NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MarketAvailabilitySnapshot" (
  "shop" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "connection" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  "ids" TEXT[] NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("shop", "country")
);
