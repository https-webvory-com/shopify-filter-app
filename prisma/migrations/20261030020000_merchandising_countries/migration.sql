ALTER TABLE "MerchandisingRule" ADD COLUMN "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
