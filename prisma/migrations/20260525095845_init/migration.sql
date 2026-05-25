-- CreateTable
CREATE TABLE "SavedFilterView" (
    "id" TEXT NOT NULL,
    "filterGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Custom Filter',
    "matchType" TEXT NOT NULL DEFAULT 'all',
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilterView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandisingRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collections" TEXT[],
    "customerTags" TEXT,
    "locales" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchandisingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandisingRuleCondition" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "operator" TEXT,
    "operand" TEXT,
    "minValue" TEXT,
    "maxValue" TEXT,
    "dateValue" TEXT,

    CONSTRAINT "MerchandisingRuleCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedFilterView_filterGroupId_idx" ON "SavedFilterView"("filterGroupId");

-- CreateIndex
CREATE INDEX "MerchandisingRule_shop_idx" ON "MerchandisingRule"("shop");

-- CreateIndex
CREATE INDEX "MerchandisingRuleCondition_ruleId_idx" ON "MerchandisingRuleCondition"("ruleId");

-- AddForeignKey
ALTER TABLE "SavedFilterView" ADD CONSTRAINT "SavedFilterView_filterGroupId_fkey" FOREIGN KEY ("filterGroupId") REFERENCES "FilterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandisingRuleCondition" ADD CONSTRAINT "MerchandisingRuleCondition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MerchandisingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
