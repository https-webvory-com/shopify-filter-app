import { parsePinImportOrder, collectionPinSortKey } from "../utils/pinImportOrder.js";
import { normalizePinImportRow, importRowInfo, importWriteError } from '../utils/csvImportReport.js';
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { invalidateShop } from '../services/shopCache.server.js';

/**
 * POST /api/import-pins-batch
 * Body: { rows: [...up to 50], ruleType: "collection" | "search" }
 * Each row (already mapped from CSV):
 *   externalId, active, collectionTitles[], products[{Id, Title, ImageUrl}],
 *   searchQuery, applyToSearchType
 */
export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const body = await request.json();
    let { rows = [], ruleType = "collection" } = body;
    if (!["collection", "search"].includes(ruleType)) return Response.json({ error: "Invalid rule type." }, { status: 400 });

    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ imported: 0, skipped: 0, errors: [] });
    }

    // ─── Batch-validate all product IDs at once ───────────────────────────
    rows = rows.map(normalizePinImportRow);
    const allProductIds = new Set();
    for (const row of rows) {
      if (row.importError) continue;
      for (const p of row.products || []) {
        const numericId = p.Id ?? p.id;
        if (numericId) {
          // Convert numeric ID → gid format for DB lookup
          const gid = String(numericId).includes("gid://")
            ? String(numericId)
            : `gid://shopify/Product/${numericId}`;
          allProductIds.add(gid);
        }
      }
    }

    const validProductsInDB = await prisma.product.findMany({
      where: { shop, id: { in: Array.from(allProductIds) } },
      select: { id: true, title: true, images: true },
    });
    const validProductMap = new Map(validProductsInDB.map((p) => [p.id, p]));



    // ─── Batch-validate collection titles at once ─────────────────────────
    const allCollectionTitles = new Set();
    const allCollectionIds = new Set();
    const collectionGid = id => String(id).startsWith("gid://shopify/Collection/") ? String(id) : `gid://shopify/Collection/${id}`;
    for (const row of rows) {
      if (row.importError) continue;
      for (const id of row.collectionIds || []) {
        if (id) allCollectionIds.add(collectionGid(id));
      }
      for (const t of row.collectionTitles || []) {
        if (t) allCollectionTitles.add(t);
      }
    }

    let validCollectionTitleSet = new Set();
    let collectionTitlesById = new Map();
    if (allCollectionTitles.size > 0 || allCollectionIds.size > 0) {
      const validCols = await prisma.collection.findMany({
        where: { shop, OR: [{ title: { in: Array.from(allCollectionTitles) } }, { id: { in: Array.from(allCollectionIds) } }] },
        select: { id: true, title: true },
      });
      validCollectionTitleSet = new Set(validCols.map((c) => c.title));
      collectionTitlesById = new Map(validCols.map(c => [c.id, c.title]));
    }

    // ─── Process each row individually with try/catch ─────────────────────
    const importedIds = [];
    const skippedRows = [];
    const warnings = [];

    for (const row of rows) {
      try {
        const externalId = row.externalId || "imported-row";
        const info = importRowInfo(row);
        if (row.importError) { skippedRows.push({ id: externalId, ...info, reason: row.importError }); continue; }
        if (row.importOrder != null && !parsePinImportOrder(row.importOrder)) {
          skippedRows.push({ id: externalId, ...info, reason: "The CSV rule order is invalid. Select the CSV again and retry." });
          continue;
        }
        const orderData = row.importOrder == null ? {} : { importOrder: row.importOrder };
        if (ruleType === 'collection' && (row.collectionIds.length || !row.collectionTitles.length)) {
          const key = collectionPinSortKey(row.collectionIds);
          if (key === null) { skippedRows.push({ id: externalId, ...info, reason: 'Collection IDs must be valid Shopify collection IDs.' }); continue; }
          orderData.collectionSortKey = key;
        }
        const rowWarnings = [];

        // Map and validate products
        const validProducts = [];
        for (const p of row.products || []) {
          const numericId = p.Id ?? p.id;
          if (!numericId) continue;

          const gid = String(numericId).includes("gid://")
            ? String(numericId)
            : `gid://shopify/Product/${numericId}`;

          if (validProductMap.has(gid)) {
            const dbProduct = validProductMap.get(gid);
            const imgUrl = p.ImageUrl || p.imageUrl || p.image || (Array.isArray(dbProduct.images) && (typeof dbProduct.images[0] === "string" ? dbProduct.images[0] : dbProduct.images[0]?.url || dbProduct.images[0]?.src)) || "";
            validProducts.push({
              id: gid,
              title: p.Title || p.title || dbProduct.title || "",
              imageUrl: imgUrl,
              image: imgUrl, // Added image field for UI rendering
            });
          }
        }

        if (validProducts.length === 0) {
          skippedRows.push({
            id: externalId,
            ...info,
            reason: "No matching products were found in this store’s synced catalog. Product IDs from another Shopify store cannot be reused; check the IDs and sync products first.",
          });
          continue;
        }

        if (validProducts.length < row.products.length) rowWarnings.push({ ...info, reason: `${row.products.length - validProducts.length} product(s) were not found or have no ID; this rule was imported with ${validProducts.length} matching product(s).` });

        // Stable IDs survive renamed collections; titles support older exports.
        let validCollections = row.collectionTitles || [];
        if (ruleType === "collection" && (validCollections.length > 0 || row.collectionIds?.length > 0)) {
          validCollections = row.collectionIds?.length
            ? [...new Set(row.collectionIds.map(id => collectionTitlesById.get(collectionGid(id))).filter(Boolean))]
            : validCollections.filter((t) => validCollectionTitleSet.has(t));
          if (validCollections.length === 0) {
            skippedRows.push({
              id: externalId,
              ...info,
              reason: `Collection(s) not found in store: ${(row.collectionTitles || []).join(", ") || (row.collectionIds || []).join(", ")}`,
            });
            continue;
          }
        }

        if (ruleType === "collection" && validCollections.length && validCollections.length < Math.max(row.collectionIds.length, row.collectionTitles.length)) rowWarnings.push({ ...info, reason: "Some target collections were not found; only the matching collections were imported." });

        // Determine applyToSearchType
        const applyToSearchType = row.applyToSearchType === "search" ? "page" : row.applyToSearchType || "both";
        const searchQueries = Array.isArray(row.searchQueries)
          ? row.searchQueries.filter(query => typeof query === "string" && query.trim()).map(query => query.trim())
          : row.searchQuery ? [row.searchQuery] : [];

        if (ruleType === "search" && applyToSearchType === "none") rowWarnings.push({ ...info, reason: "Neither instant search nor the search results page is selected in this CSV. The saved rule will not apply to either surface." });
        if (ruleType === "search" && row.applyToAll === false && !searchQueries.length) { skippedRows.push({ id: externalId, ...info, reason: "Search queries are missing and ApplyToAll is false." }); continue; }

        // Determine rule name and applyToAll
        let ruleName = "Imported Pin";
        let applyToAll = false;
        
        if (ruleType === "collection") {
          applyToAll = validCollections.length === 0;
          const originalTitles = (row.collectionTitles && row.collectionTitles.length > 0) 
            ? row.collectionTitles.join(", ") 
            : "";
          ruleName = originalTitles || "All Collections";
        } else {
          applyToAll = row.applyToAll === true || (row.applyToAll == null && searchQueries.length === 0);
          ruleName = applyToAll ? "All Searches" : searchQueries.join(", ");
        }
        
        // Ensure ruleName is not empty string
        if (!ruleName.trim()) {
          ruleName = `Imported ${ruleType === "collection" ? "Collection" : "Search"} Pin`;
        }

        // Our collection exports carry the rule ID, while the collection title
        // can differ from its custom rule name. Prefer that identity for a
        // same-store reimport; foreign/legacy IDs retain name-based importing.
        const existingRule = ruleType === "collection" && typeof row.externalId === "string" && row.externalId.trim()
          ? await prisma.pinnedProductRule.findFirst({
              where: { id: row.externalId.trim(), shop, ruleType },
              select: { id: true },
            })
          : null;
        const updateData = {
          ...orderData,
          status: row.active !== false,
          collections: validCollections,
          products: validProducts,
          searchQueries,
          applyToSearchType,
          applyToAll,
        };
        if (existingRule) {
          // Keep the original name, creation date and any metadata absent from
          // the CSV. Repeat the tenant/type guard on the write as well.
          await prisma.pinnedProductRule.update({
            where: { id: existingRule.id, shop, ruleType },
            data: updateData,
          });
        } else await prisma.pinnedProductRule.upsert({
          where: {
            shop_name_ruleType: {
              shop,
              name: ruleName,
              ruleType,
            },
          },
          update: updateData,
          create: {
            ...orderData,
            shop,
            name: ruleName,
            status: row.active !== false,
            applyToAll,
            collections: validCollections,
            products: validProducts,
            searchQueries,
            ruleType,
            applyToSearchType,
          },
        });

        importedIds.push(externalId);
        warnings.push(...rowWarnings);
      } catch (rowErr) {
        skippedRows.push({
          id: row.externalId || "unknown",
          ...importRowInfo(row),
          reason: importWriteError(rowErr),
        });
      }
    }

    if (importedIds.length) {
      try { await invalidateShop(shop); }
      catch { warnings.push({ name: "Storefront refresh", reason: "Rules were saved, but storefront refresh could not be confirmed. Check the saved rules before retrying." }); }
    }
    return Response.json({
      imported: importedIds.length,
      skipped: skippedRows.length,
      errors: skippedRows,
      warnings,
    });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[import-pins-batch] Fatal error:", err);
    return Response.json(
      { imported: 0, skipped: 0, errors: [{ id: "batch", reason: "The batch could not be confirmed. Check existing rules before retrying." }] },
      { status: 500 }
    );
  }
};
