import { merchandisingRuleIds } from "../utils/merchandisingSelection.js";
import { importMerchandisingRules } from '../services/merchandisingImport.server.js';
import { normalizeCondition, validConditions } from "../utils/merchandisingCondition.js";
import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  useFetcher,
  useNavigation,
  useLoaderData,
} from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import FilterModal from "../components/merchandising/FilterModal";
import CreateRuleModal from "../components/merchandising/CreateRuleModal";
import CustomizeColumnsModal from "../components/merchandising/CustomizeColumnsModal";
import ImportMerchandisingRulesModal from "../components/merchandising/ImportMerchandisingRulesModal";
import ExportMerchandisingRulesModal from "../components/merchandising/ExportMerchandisingRulesModal";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const { invalidateShop } = await import("../services/shopCache.server");

  if (actionType === "createRule") {
    const name = formData.get("name") || "Untitled Rule";
    const collections = JSON.parse(formData.get("collections") || "[]");
    const customerTags = formData.get("customerTags");
    const locales = formData.get("locales");
    const startDateStr = formData.get("startDate");
    const endDateStr = formData.get("endDate");
    const conditions = JSON.parse(formData.get("conditions") || "[]");
    if (!String(formData.get("name") || "").trim() || !validConditions(conditions)) return Response.json({ error: "Enter a name and complete every condition." }, { status: 400 });

    const startDate =
      startDateStr && startDateStr !== "null" && startDateStr.trim() !== ""
        ? new Date(startDateStr)
        : null;
    const endDate =
      endDateStr && endDateStr !== "null" && endDateStr.trim() !== ""
        ? new Date(endDateStr)
        : null;

    const newRule = await prisma.merchandisingRule.create({
      data: {
        shop,
        name,
        collections,
        customerTags,
        locales,
        startDate,
        endDate,
        conditions: {
          create: conditions.map(normalizeCondition),
        },
      },
    });

    await invalidateShop(shop);
    return Response.json({ success: true, intent: "create", rule: newRule });
  }

  if (actionType === "editRule") {
    const id = formData.get("id");
    const name = formData.get("name") || "Untitled Rule";
    const collections = JSON.parse(formData.get("collections") || "[]");
    const customerTags = formData.get("customerTags");
    const locales = formData.get("locales");
    const startDateStr = formData.get("startDate");
    const endDateStr = formData.get("endDate");
    const conditions = JSON.parse(formData.get("conditions") || "[]");
    if (!String(formData.get("name") || "").trim() || !validConditions(conditions)) return Response.json({ error: "Enter a name and complete every condition." }, { status: 400 });

    const startDate =
      startDateStr && startDateStr !== "null" && startDateStr.trim() !== ""
        ? new Date(startDateStr)
        : null;
    const endDate =
      endDateStr && endDateStr !== "null" && endDateStr.trim() !== ""
        ? new Date(endDateStr)
        : null;

    const updatedRule = await prisma.merchandisingRule.update({
      where: { id, shop },
      data: {
        name,
        collections,
        customerTags,
        locales,
        startDate,
        endDate,
        conditions: {
          deleteMany: {},
          create: conditions.map(normalizeCondition),
        },
      },
    });
    await invalidateShop(shop);
    return Response.json({ success: true, intent: "edit", rule: updatedRule });
  }

  if (actionType === "bulkDeleteRules") {
    let ids;
    try { ids = merchandisingRuleIds(formData.get("ids")); }
    catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    const result = await prisma.merchandisingRule.deleteMany({
      where: { shop, ruleType: "collection", id: { in: ids } },
    });
    await invalidateShop(shop);
    return Response.json({ success: true, intent: "bulkDelete", count: result.count });
  }

  if (actionType === "deleteRule") {
    const id = formData.get("id");
    await prisma.merchandisingRule.deleteMany({ where: { id, shop } });
    await invalidateShop(shop);
    return Response.json({ success: true, intent: "delete" });
  }

  if (actionType === "toggleRule") {
    const id = formData.get("id");
    const status = formData.get("status") === "true";
    await prisma.merchandisingRule.updateMany({
      where: { id, shop },
      data: { status },
    });
    await invalidateShop(shop);
    return Response.json({ success: true, intent: "toggle" });
  }

  if (actionType === "duplicateRule") {
    const id = formData.get("id");
    const existingRule = await prisma.merchandisingRule.findFirst({
      where: { id, shop },
      include: { conditions: true },
    });

    if (!existingRule) return Response.json({ error: "Rule not found" });

    const newRule = await prisma.merchandisingRule.create({
      data: {
        shop,
        name: `${existingRule.name} (Copy)`,
        collections: existingRule.collections || [],
        customerTags: existingRule.customerTags || "",
        locales: existingRule.locales || "",
        startDate: existingRule.startDate || null,
        endDate: existingRule.endDate || null,
        status: existingRule.status,
        conditions: {
          create: existingRule.conditions.map(normalizeCondition),
        },
      },
    });
    await invalidateShop(shop);
    return Response.json({ success: true, intent: "duplicate", rule: newRule });
  }

  if (actionType === "importRules") {
    let rules;
    try { rules = JSON.parse(formData.get("rules") || "[]"); if (!Array.isArray(rules)) throw Error(); }
    catch { return Response.json({ intent: "import", error: "Invalid import data. Please select the CSV again." }, { status: 400 }); }
    const report = await importMerchandisingRules(shop, rules, "collection");
    if (report.imported) {
      try { await invalidateShop(shop); }
      catch { report.warnings.push({ name: "Storefront refresh", reason: "Rules were saved, but refreshing storefront data could not be confirmed. Refresh and check the rules before retrying." }); }
    }
    return Response.json({ success: true, intent: "import", count: report.imported, ...report });
  }

  return Response.json({ error: "Invalid action" });
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // These reads are independent; do not add every database round trip to page load.
  const [graphqlQuery, vendorsData, productTypesData, tagsRaw, productsData, skusData, optionsRaw, merchandisingRules] = await Promise.all([
    admin.graphql(`
    #graphql
    query {
      collections(first: 250) {
        nodes {
          id
          title
        }
      }
      locations(first: 250, includeInactive: true) {
        nodes {
          id
          name
        }
      }
      shop {
        fulfillmentServices {
          location {
            id
            name
          }
        }
      }
    }
  `),
    prisma.product.groupBy({
    by: ["vendor"],
    where: { shop, vendor: { not: "" } },
  }),
    prisma.product.groupBy({
    by: ["productType"],
    where: { shop, productType: { not: "" } },
  }),
    prisma.$queryRaw`
    SELECT DISTINCT unnest(tags) as tag
    FROM "Product"
    WHERE shop = ${shop} AND array_length(tags, 1) > 0
  `,
    prisma.$queryRaw`
    SELECT title,
           COALESCE(
             images->0->>'url',
             images->0->>'src',
             images->0->>'originalSrc',
             CASE WHEN jsonb_typeof(images->0) = 'string' THEN images->>0 ELSE NULL END
           ) as image
    FROM "Product"
    WHERE shop = ${shop}
    LIMIT 250
  `,
    prisma.$queryRaw`
    SELECT v.sku, p.title as "productTitle", v.option1, v.option2, v.option3, v."imageUrl" as image
    FROM "Variant" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE p.shop = ${shop} AND v.sku IS NOT NULL AND v.sku != ''
    LIMIT 250
  `,
    prisma.$queryRaw`
    SELECT DISTINCT
      el->>'name' as name,
      jsonb_array_elements_text(el->'values') as value
    FROM "Product",
    jsonb_array_elements(options) as el
    WHERE shop = ${shop} AND options IS NOT NULL AND options::text != 'null' AND options::text != '[]'
  `,
    prisma.merchandisingRule.findMany({
    where: { shop, ruleType: "collection" },
    orderBy: { createdAt: "desc" },
    include: { conditions: true },
  })
  ]);
  const graphqlData = await graphqlQuery.json();
  const shopifyCollections =
    graphqlData?.data?.collections?.nodes
      ?.map((c) => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title)) || [];

  const allLocsSet = new Set();
  graphqlData?.data?.locations?.nodes?.forEach((l) => {
    if (l.name) allLocsSet.add(l.name);
  });
  graphqlData?.data?.shop?.fulfillmentServices?.forEach((fs) => {
    if (fs.location && fs.location.name) {
      allLocsSet.add(fs.location.name);
    }
  });
  const shopifyLocations = Array.from(allLocsSet).sort();

  const shopifyVendors = vendorsData.map((v) => v.vendor).sort();

  const shopifyProductTypes = productTypesData.map((p) => p.productType).sort();

  const shopifyTags = tagsRaw.map(t => t.tag.trim()).sort();

  const shopifyProducts = productsData.map((p) => ({ title: p.title, image: p.image || null }));

  const shopifySkus = skusData.map((v) => {
    let variantTitleParts = [v.option1, v.option2, v.option3].filter(Boolean);
    let variantTitle = variantTitleParts.join(" / ");
    return {
      title: `${v.sku}|${v.productTitle} ${variantTitle !== "Default Title" ? variantTitle : ""}`.trim(),
      image: v.image || null,
    };
  });
  
  const shopifyBarcodes = [];


  const shopifyOptions = {};
  for (const row of optionsRaw) {
    if (row.name && row.value) {
      if (!shopifyOptions[row.name]) shopifyOptions[row.name] = new Set();
      shopifyOptions[row.name].add(row.value);
    }
  }
  for (const key in shopifyOptions) {
    shopifyOptions[key] = Array.from(shopifyOptions[key]).sort();
  }


  return {
    shopifyCollections,
    shopifyVendors,
    shopifyOptions,
    shopifyLocations,
    shopifyProductTypes,
    shopifyTags,
    shopifyProducts,
    shopifySkus,
    shopifyBarcodes,
    merchandisingRules,
  };
};

export default function MerchandisingIndex() {
  const {
    shopifyCollections,
    shopifyVendors,
    shopifyOptions,
    shopifyLocations,
    shopifyProductTypes,
    shopifyTags,
    shopifyProducts,
    shopifySkus,
    shopifyBarcodes,
    merchandisingRules,
  } = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCreateRuleModalOpen, setIsCreateRuleModalOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState(null);
  const [ruleToEdit, setRuleToEdit] = useState(null);
  const [ruleMatchType, setRuleMatchType] = useState("all");
  const [ruleFilters, setRuleFilters] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);
  const [selectedRules, setSelectedRules] = useState([]);

  const defaultColumns = [
    { id: "Name", label: "Name", visible: true },
    { id: "Collections", label: "Collections", visible: true },
    { id: "Status", label: "Status", visible: true },
    { id: "Action", label: "Action", visible: true },
    { id: "Date Range", label: "Date Range", visible: true },
  ];
  const [tableColumns, setTableColumns] = useState(defaultColumns);
  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);

  const filteredRules = merchandisingRules.filter((rule) => {
    if (statusFilter === "active" && !rule.status) return false;
    if (statusFilter === "inactive" && rule.status) return false;

    if (
      searchQuery &&
      !rule.name.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    if (ruleFilters.length === 0) return true;

    const matchesFilter = (filter) => {
      if (filter.field === "Active") {
        const isActive = rule.status;
        return filter.operator === "equals"
          ? isActive === filter.value
          : isActive !== filter.value;
      }
      if (filter.field === "Item name") {
        const val = filter.value.toLowerCase();
        const ruleName = rule.name.toLowerCase();
        switch (filter.operator) {
          case "contains":
            return ruleName.includes(val);
          case "does not contains":
            return !ruleName.includes(val);
          case "equals":
            return ruleName === val;
          case "does not equal":
            return ruleName !== val;
          case "starts with":
            return ruleName.startsWith(val);
          case "ends with":
            return ruleName.endsWith(val);
          default:
            return true;
        }
      }
      if (filter.field === "Collections") {
        const val = filter.value.toLowerCase();
        const cols = rule.collections || [];
        const colString = cols.join(" ").toLowerCase();
        switch (filter.operator) {
          case "contains":
            return colString.includes(val);
          case "does not contains":
            return !colString.includes(val);
          case "equals":
            return cols.some((c) => c.toLowerCase() === val);
          case "does not equal":
            return !cols.some((c) => c.toLowerCase() === val);
          case "starts with":
            return cols.some((c) => c.toLowerCase().startsWith(val));
          case "ends with":
            return cols.some((c) => c.toLowerCase().endsWith(val));
          default:
            return true;
        }
      }
      return true;
    };

    if (ruleMatchType === "all") {
      return ruleFilters.every(matchesFilter);
    } else {
      return ruleFilters.some(matchesFilter);
    }
  });

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.merch-dropdown-inside')) {
        setIsStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      if (fetcher.data.intent === "create")
        shopify.toast.show("Rule created successfully");
      if (fetcher.data.intent === "edit")
        shopify.toast.show("Rule updated successfully");
      if (fetcher.data.intent === "bulkDelete") {
        setSelectedRules([]);
        shopify.toast.show(`${fetcher.data.count} rule${fetcher.data.count === 1 ? "" : "s"} deleted successfully`);
      }
      if (fetcher.data.intent === "delete")
        shopify.toast.show("Rule deleted successfully");
      if (fetcher.data.intent === "toggle")
        shopify.toast.show("Rule status updated");
      if (fetcher.data.intent === "duplicate")
        shopify.toast.show("Rule duplicated successfully");
      if (fetcher.data.intent === "import")
        shopify.toast.show(`${fetcher.data.count} imported, ${fetcher.data.skipped || 0} skipped. See the import report for details.`, { duration: 8000 });
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <s-page heading="Merchandising">
      <ui-title-bar title="Merchandising">
        <button
          variant="breadcrumb"
          onClick={() => navigate("/app/collections")}
        >
          Collections
        </button>
      </ui-title-bar>

      <style>{`
        .merch-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #ffffff !important;
          padding: 16px 24px !important;
          border-radius: 12px !important;
          box-shadow: 0 1px 3px rgba(30, 27, 75, 0.05) !important;
          border: 1px solid rgba(30, 27, 75, 0.05) !important;
        }

        .merch-back-link {
          color: #5B21B6 !important;
          text-decoration: none;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
          width: fit-content;
          font-size: 14px;
        }
        .merch-back-link:hover {
          color: #1E1B4B !important;
          transform: translateX(-2px);
        }

        .merch-btn-secondary {
          display: flex;
          align-items: center;
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 8px 16px !important;
          border-radius: 10px !important;
          cursor: pointer !important;
          color: #1E1B4B !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.02) !important;
        }
        .merch-btn-secondary:hover {
          background: rgba(91, 33, 182, 0.04) !important;
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
        }

        .merch-btn-primary {
          display: flex;
          align-items: center;
          background: #5B21B6 !important;
          padding: 8px 16px !important;
          border-radius: 10px !important;
          cursor: pointer !important;
          color: #ffffff !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          border: none !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(91, 33, 182, 0.15) !important;
        }
        .merch-btn-primary:hover {
          background: #1e1b4b !important;
          box-shadow: 0 4px 8px rgba(30, 27, 75, 0.2) !important;
        }

        .merch-search-container {
          display: flex;
          align-items: center;
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 8px 16px !important;
          border-radius: 10px !important;
          width: 250px !important;
          transition: all 0.2s ease !important;
        }
        .merch-search-container:focus-within {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 2px rgba(91, 33, 182, 0.1) !important;
        }

        .merch-icon-btn {
          background: none !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          border-radius: 10px !important;
          width: 38px !important;
          height: 38px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          color: #64748b !important;
          transition: all 0.2s ease !important;
        }
        .merch-icon-btn:hover {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
          background: rgba(91, 33, 182, 0.04) !important;
        }

        /* Empty State */
        .merch-empty-heading {
          font-size: 38px !important;
          font-weight: 800 !important;
          color: #1E1B4B !important;
          margin-bottom: 16px !important;
          letter-spacing: -0.5px !important;
        }
        .merch-empty-desc {
          font-size: 15px !important;
          color: #4b5563 !important;
          line-height: 1.6 !important;
          margin-bottom: 32px !important;
          max-width: 650px !important;
        }
      `}</style>

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <a
          href="/app/collections"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/collections");
          }}
          className="merch-back-link"
        >
          <svg
            style={{ width: "16px", height: "16px" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            ></path>
          </svg>
          Back to Collections
        </a>
      </div>

      <div
        style={{
          fontFamily: "Inter, sans-serif",
          background: "#f8f9fa",
          padding: "20px",
        }}
      >
        <div className="merch-toolbar">
          <div style={{ display: "flex", gap: "12px" }}>
            {/* All rules dropdown */}
            <div style={{ position: "relative" }} className="merch-dropdown-inside">
              <div
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className="merch-btn-secondary"
              >
                {statusFilter === "all"
                  ? "All rules"
                  : statusFilter === "active"
                    ? "Active rules"
                    : "Inactive rules"}{" "}
                ({filteredRules.length})
                <svg
                  style={{ width: "12px", height: "12px", marginLeft: "8px" }}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>

              {isStatusDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: "8px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                    zIndex: 50,
                    width: "200px",
                  }}
                >
                  <div
                    onClick={() => {
                      setStatusFilter("all");
                      setIsStatusDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: statusFilter === "all" ? "#5B21B6" : "#1E1B4B",
                      fontWeight: statusFilter === "all" ? "500" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    All rules
                    <svg
                      style={{
                        width: "16px",
                        height: "16px",
                        color: statusFilter === "all" ? "#5B21B6" : "rgba(91, 33, 182, 0.2)",
                      }}
                      fill={statusFilter === "all" ? "currentColor" : "none"}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      ></path>
                    </svg>
                  </div>
                  <div
                    onClick={() => {
                      setStatusFilter("active");
                      setIsStatusDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: statusFilter === "active" ? "#5B21B6" : "#1E1B4B",
                      fontWeight: statusFilter === "active" ? "500" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Active rules
                    <svg
                      style={{
                        width: "16px",
                        height: "16px",
                        color:
                          statusFilter === "active" ? "#5B21B6" : "rgba(91, 33, 182, 0.2)",
                      }}
                      fill={statusFilter === "active" ? "currentColor" : "none"}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      ></path>
                    </svg>
                  </div>
                  <div
                    onClick={() => {
                      setStatusFilter("inactive");
                      setIsStatusDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      fontSize: "14px",
                      color:
                        statusFilter === "inactive" ? "#5B21B6" : "#1E1B4B",
                      fontWeight: statusFilter === "inactive" ? "500" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Inactive rules
                    <svg
                      style={{
                        width: "16px",
                        height: "16px",
                        color:
                          statusFilter === "inactive" ? "#5B21B6" : "rgba(91, 33, 182, 0.2)",
                      }}
                      fill={
                        statusFilter === "inactive" ? "currentColor" : "none"
                      }
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      ></path>
                    </svg>
                  </div>
                </div>
              )}
            </div>

            {/* Create rule button & Export logic */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {selectedRules.length > 0 && (
                <>
                  <button
                    onClick={() => setRuleToDelete({ ids: selectedRules.slice() })}
                    disabled={fetcher.state !== "idle"}
                    aria-label="Delete Selected"
                    title="Delete Selected"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#fff",
                      border: "1px solid #fca5a5",
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      cursor: "pointer",
                      color: "#dc2626",
                    }}
                  >
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                  <button
                    onClick={() => setIsExportModalOpen(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "#fff",
                    border: "1px solid #cbd5e1",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    color: "#334155",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Export
                </button>
                </>
              )}
              <div style={{ position: "relative" }} className="create-dropdown-inside">
                <div
                  className="merch-btn-primary"
                  onClick={() => setIsCreateDropdownOpen(!isCreateDropdownOpen)}
                >
                  Create rule
                  <div
                    style={{
                      borderLeft: "1px solid rgba(255,255,255,0.3)",
                      marginLeft: "12px",
                      paddingLeft: "8px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <svg
                      style={{
                        width: "12px",
                        height: "12px",
                        transform: isCreateDropdownOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s ease"
                      }}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </div>
                </div>

                {isCreateDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      left: 0,
                      width: "200px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      zIndex: 50,
                      overflow: "hidden"
                    }}
                  >
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        setIsCreateDropdownOpen(false);
                        setRuleToEdit(null);
                        setIsCreateRuleModalOpen(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1e293b"
                      }}
                    >
                      Create manual rule
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        setIsCreateDropdownOpen(false);
                        setIsImportModalOpen(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1e293b"
                      }}
                    >
                      Import from CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right side search */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div className="merch-search-container">
              <svg
                style={{
                  width: "16px",
                  height: "16px",
                  color: "#64748b",
                  marginRight: "8px",
                }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                ></path>
              </svg>
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  fontSize: "14px",
                  color: "#333",
                  width: "100%",
                }}
              />
            </div>
            <button
              onClick={() => setIsFilterModalOpen(true)}
              className="merch-icon-btn"
            >
              <svg
                style={{ width: "20px", height: "20px" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                ></path>
              </svg>
            </button>
            <button
              onClick={() => setIsCustomizeColumnsOpen(true)}
              className="merch-icon-btn"
            >
              <svg
                style={{ width: "20px", height: "20px" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                ></path>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div
          style={{ maxWidth: "1200px", margin: "0 auto", textAlign: "left" }}
        >
          {navigation.state !== "idle" || fetcher.state !== "idle" ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "100px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  border: "4px solid rgba(91, 33, 182, 0.2)",
                  borderTop: "4px solid #5B21B6",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              ></div>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : filteredRules.length > 0 ||
            (merchandisingRules.length > 0 &&
              (searchQuery || ruleFilters.length > 0)) ? (
            <div
              style={{
                background: "#fff",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                  color: "#1E1B4B",
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      color: "#64748b",
                      fontWeight: "600",
                      textAlign: "left",
                    }}
                  >
                    {tableColumns
                      .filter((c) => c.visible)
                      .map((c) => (
                        <th key={c.id} style={{ padding: "16px 24px" }}>
                          {c.id === "Name" ? (
                            <>
                              <input
                                type="checkbox"
                                style={{ marginRight: "12px", accentColor: "#5B21B6", cursor: "pointer" }}
                                checked={
                                  filteredRules.length > 0 &&
                                  filteredRules.every(rule => selectedRules.includes(rule.id))
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRules(filteredRules.map((r) => r.id));
                                  } else {
                                    setSelectedRules([]);
                                  }
                                }}
                              />{" "}
                              {c.label}
                            </>
                          ) : (
                            c.label
                          )}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.length > 0 ? (
                    filteredRules.map((rule) => (
                      <tr
                        key={rule.id}
                        style={{ borderBottom: "1px solid #f1f5f9" }}
                      >
                        {tableColumns
                          .filter((c) => c.visible)
                          .map((c) => {
                            if (c.id === "Name") {
                              return (
                                <td
                                  key={c.id}
                                  style={{
                                    padding: "16px 24px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                  }}
                                >
                                  <svg
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      cursor: "grab",
                                      color: "rgba(91, 33, 182, 0.2)",
                                    }}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      d="M4 8h16M4 16h16"
                                    ></path>
                                  </svg>
                                  <input
                                    type="checkbox"
                                    style={{ accentColor: "#5B21B6", cursor: "pointer" }}
                                    checked={selectedRules.includes(rule.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedRules([...selectedRules, rule.id]);
                                      } else {
                                        setSelectedRules(
                                          selectedRules.filter((id) => id !== rule.id)
                                        );
                                      }
                                    }}
                                  />
                                  <span
                                    onClick={() => {
                                      setRuleToEdit(rule);
                                      setIsCreateRuleModalOpen(true);
                                    }}
                                    style={{
                                      color: "#5B21B6",
                                      fontWeight: "500",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {rule.name}
                                  </span>
                                </td>
                              );
                            }
                            if (c.id === "Collections") {
                              return (
                                <td key={c.id} style={{ padding: "16px 24px" }}>
                                  {rule.collections &&
                                  rule.collections.length > 0 ? (
                                    <span
                                      style={{
                                        background: "rgba(91, 33, 182, 0.08)",
                                        color: "#5B21B6",
                                        padding: "4px 12px",
                                        borderRadius: "12px",
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      {rule.collections[0]}{" "}
                                      {rule.collections.length > 1 &&
                                        `+${rule.collections.length - 1}`}
                                    </span>
                                  ) : (
                                    <span style={{ color: "#94a3b8" }}>
                                      All
                                    </span>
                                  )}
                                </td>
                              );
                            }
                            if (c.id === "Status") {
                              return (
                                <td key={c.id} style={{ padding: "16px 24px" }}>
                                  <div
                                    onClick={() =>
                                      fetcher.submit(
                                        {
                                          actionType: "toggleRule",
                                          id: rule.id,
                                          status: !rule.status,
                                        },
                                        { method: "POST" },
                                      )
                                    }
                                    style={{
                                      width: "40px",
                                      height: "24px",
                                      background: rule.status
                                        ? "#5B21B6"
                                        : "rgba(91, 33, 182, 0.2)",
                                      borderRadius: "12px",
                                      position: "relative",
                                      cursor: "pointer",
                                      transition: "0.2s",
                                      opacity:
                                        fetcher.state !== "idle" ? 0.7 : 1,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: "20px",
                                        height: "20px",
                                        background: "#fff",
                                        borderRadius: "50%",
                                        position: "absolute",
                                        top: "2px",
                                        left: rule.status ? "18px" : "2px",
                                        transition: "0.2s",
                                      }}
                                    ></div>
                                  </div>
                                </td>
                              );
                            }
                            if (c.id === "Action") {
                              return (
                                <td
                                  key={c.id}
                                  style={{
                                    padding: "16px 24px",
                                    color: "rgba(91, 33, 182, 0.2)",
                                  }}
                                >
                                  <div style={{ display: "flex", gap: "16px" }}>
                                    <div
                                      style={{ position: "relative" }}
                                      title="Duplicate"
                                    >
                                      <svg
                                        onClick={() =>
                                          fetcher.submit(
                                            {
                                              actionType: "duplicateRule",
                                              id: rule.id,
                                            },
                                            { method: "POST" },
                                          )
                                        }
                                        style={{
                                          width: "16px",
                                          height: "16px",
                                          cursor: "pointer",
                                          color:
                                            fetcher.state !== "idle"
                                              ? "#e2e8f0"
                                              : "#64748b",
                                        }}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                                        ></path>
                                      </svg>
                                    </div>
                                    <svg
                                      onClick={() => setRuleToDelete(rule)}
                                      style={{
                                        width: "16px",
                                        height: "16px",
                                        cursor: "pointer",
                                        color:
                                          fetcher.state !== "idle"
                                            ? "#e2e8f0"
                                            : "#ef4444",
                                      }}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      ></path>
                                    </svg>
                                  </div>
                                </td>
                              );
                            }
                            if (c.id === "Date Range") {
                              return (
                                <td
                                  key={c.id}
                                  style={{
                                    padding: "16px 24px",
                                    color: "#64748b",
                                  }}
                                >
                                  {rule.startDate || rule.endDate
                                    ? "Scheduled"
                                    : "Always"}
                                </td>
                              );
                            }
                            return null;
                          })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={tableColumns.filter((c) => c.visible).length}
                        style={{
                          padding: "40px 24px",
                          textAlign: "center",
                          color: "#64748b",
                        }}
                      >
                        No rules matched your search or filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                maxWidth: "800px",
                margin: "40px auto",
                textAlign: "center",
                background: "#ffffff",
                padding: "60px 40px",
                borderRadius: "16px",
                boxShadow: "0 10px 30px rgba(30, 27, 75, 0.03)",
                border: "1px solid rgba(30, 27, 75, 0.05)",
              }}
            >
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: "rgba(91, 33, 182, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 24px auto",
                  color: "#5B21B6",
                }}
              >
                <svg
                  style={{ width: "32px", height: "32px" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  ></path>
                </svg>
              </div>

              <h1 className="merch-empty-heading">
                Add your merchandising rules
              </h1>
              <p
                className="merch-empty-desc"
                style={{ margin: "0 auto 32px auto" }}
              >
                Help manipulate groups of products - push them to the top, bury
                to the bottom of the results by adding new merchandising rules
                to your store, or import your existing rules.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={() => {
                    setRuleToEdit(null);
                    setIsCreateRuleModalOpen(true);
                  }}
                  style={{
                    background: "#5B21B6",
                    color: "#fff",
                    border: "none",
                    padding: "12px 28px",
                    borderRadius: "10px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(91, 33, 182, 0.2)",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#1e1b4b";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#5B21B6";
                  }}
                >
                  Add rule
                </button>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  style={{
                    background: "#ffffff",
                    color: "#5B21B6",
                    border: "1px solid rgba(91, 33, 182, 0.2)",
                    padding: "12px 28px",
                    borderRadius: "10px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(91, 33, 182, 0.04)";
                    e.currentTarget.style.borderColor = "#5B21B6";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#ffffff";
                    e.currentTarget.style.borderColor =
                      "rgba(91, 33, 182, 0.2)";
                  }}
                >
                  Import rules
                </button>
              </div>
            </div>
          )}
        </div>

        <FilterModal
          isOpen={isFilterModalOpen}
          onClose={() => setIsFilterModalOpen(false)}
          currentMatchType={ruleMatchType}
          currentFilters={ruleFilters}
          onApply={(match, filters) => {
            setRuleMatchType(match);
            setRuleFilters(filters);
            setIsFilterModalOpen(false);
          }}
        />

          {ruleToDelete?.ids && (
            <div
              onClick={() => setRuleToDelete(null)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                background: "rgba(0,0,0,0.5)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#fff",
                  borderRadius: "8px",
                  width: "400px",
                  maxWidth: "90%",
                  padding: "24px",
                  boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                }}
              >
                <h2
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: "18px",
                    fontWeight: "600",
                    color: "#1e293b",
                  }}
                >
                  Bulk Delete Merchandising Rules
                </h2>
                <p
                  style={{
                    margin: "0 0 24px 0",
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.5",
                  }}
                >
                  Are you sure you want to delete {ruleToDelete.ids.length} rules? This action cannot be undone.
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "12px",
                  }}
                >
                  <button
                    onClick={() => setRuleToDelete(null)}
                    style={{
                      background: "#fff",
                      border: "1px solid rgba(91, 33, 182, 0.2)",
                      color: "#1E1B4B",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      fetcher.submit({ actionType: "bulkDeleteRules", ids: JSON.stringify(ruleToDelete.ids) }, { method: "POST" });
                      setRuleToDelete(null);
                    }}
                    style={{
                      background: "#ef4444",
                      border: "none",
                      color: "#fff",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Delete Rules
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* Delete Confirmation Modal */}
        {ruleToDelete && !ruleToDelete.ids && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "#fff",
                width: "400px",
                padding: "24px",
                borderRadius: "12px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                textAlign: "center",
              }}
            >
              <h2
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#1E1B4B",
                }}
              >
                Delete Rule
              </h2>
              <p
                style={{
                  margin: "0 0 24px 0",
                  fontSize: "14px",
                  color: "#64748b",
                }}
              >
                Are you sure you want to delete the rule "{ruleToDelete.name}"?
                This action cannot be undone.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "12px",
                }}
              >
                <button
                  onClick={() => setRuleToDelete(null)}
                  style={{
                    padding: "10px 24px",
                    background: "#f8fafc",
                    border: "1px solid rgba(91, 33, 182, 0.2)",
                    borderRadius: "24px",
                    color: "#64748b",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    fetcher.submit(
                      { actionType: "deleteRule", id: ruleToDelete.id },
                      { method: "POST" },
                    );
                    setRuleToDelete(null);
                  }}
                  style={{
                    padding: "10px 24px",
                    background: "#ef4444",
                    border: "none",
                    borderRadius: "24px",
                    color: "#fff",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: "pointer",
                    boxShadow: "0 4px 6px -1px rgba(239, 68, 68, 0.2)",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        <CreateRuleModal
          isOpen={isCreateRuleModalOpen}
          onClose={() => {
            setIsCreateRuleModalOpen(false);
            setRuleToEdit(null);
          }}
          ruleToEdit={ruleToEdit}
          shopifyCollections={shopifyCollections}
          shopifyVendors={shopifyVendors}
          shopifyOptions={shopifyOptions}
          shopifyLocations={shopifyLocations}
          shopifyProductTypes={shopifyProductTypes}
          shopifyTags={shopifyTags}
          shopifyProducts={shopifyProducts}
          shopifySkus={shopifySkus}
          shopifyBarcodes={shopifyBarcodes}
        />
        {isImportModalOpen && (
          <ImportMerchandisingRulesModal
            isOpen={isImportModalOpen}
            importResult={fetcher.data}
            isSubmitting={fetcher.state !== "idle"}
            onClose={() => setIsImportModalOpen(false)}
            onSubmit={(rules) => {
              const formData = new FormData();
              formData.append("actionType", "importRules");
              formData.append("rules", JSON.stringify(rules));
              fetcher.submit(formData, { method: "POST" });
            }}
          />
        )}

        {isExportModalOpen && (
          <ExportMerchandisingRulesModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            selectedRuleIds={selectedRules}
            allRules={merchandisingRules}
            onExport={() => {
              setIsExportModalOpen(false);
              setSelectedRules([]);
            }}
          />
        )}

        <CustomizeColumnsModal
          isOpen={isCustomizeColumnsOpen}
          onClose={() => setIsCustomizeColumnsOpen(false)}
          currentColumns={tableColumns}
          onApply={(cols) => {
            setTableColumns(cols);
            setIsCustomizeColumnsOpen(false);
          }}
        />
      </div>
    </s-page>
  );
}
