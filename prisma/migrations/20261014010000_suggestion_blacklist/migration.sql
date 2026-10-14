CREATE TABLE "SearchSuggestionBlacklist" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchSuggestionBlacklist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchSuggestionBlacklist_shop_term_operator_key" ON "SearchSuggestionBlacklist"("shop", "term", "operator");
CREATE INDEX "SearchSuggestionBlacklist_shop_isActive_idx" ON "SearchSuggestionBlacklist"("shop", "isActive");
