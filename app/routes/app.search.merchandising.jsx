import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  useFetcher,
  useNavigation,
  useLoaderData,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import FilterModal from "../components/merchandising/FilterModal";
import CreateSearchRuleModal from "../components/merchandising/CreateSearchRuleModal";
import CustomizeColumnsModal from "../components/merchandising/CustomizeColumnsModal";
import ImportMerchandisingRulesModal from "../components/merchandising/ImportMerchandisingRulesModal";
import ExportMerchandisingRulesModal from "../components/merchandising/ExportMerchandisingRulesModal";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "createRule") {
    const name = formData.get("name") || "Untitled Rule";
    const searchQueries = JSON.parse(formData.get("searchQueries") || "[]");
    const customerTags = formData.get("customerTags");
    const locales = formData.get("locales");
    const startDateStr = formData.get("startDate");
    const endDateStr = formData.get("endDate");
    const conditions = JSON.parse(formData.get("conditions") || "[]");

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
        searchQueries,
        ruleType: "search",
        customerTags,
        locales,
        startDate,
        endDate,
        conditions: {
          create: conditions.map((c) => ({
            action: c.action,
            field: c.field,
            value:
              typeof c.value === "string" ? c.value : JSON.stringify(c.value),
            maxValue:
              c.value2 ? (typeof c.value2 === "string" ? c.value2 : JSON.stringify(c.value2)) : null,
            operator: c.operator,
            operand: c.operand,
            dateValue: c.dateValue,
          })),
        },
      },
    });
    return Response.json({ success: true, intent: "create", rule: newRule });
  }

  if (actionType === "editRule") {
    const id = formData.get("id");
    const name = formData.get("name") || "Untitled Rule";
    const searchQueries = JSON.parse(formData.get("searchQueries") || "[]");
    const customerTags = formData.get("customerTags");
    const locales = formData.get("locales");
    const startDateStr = formData.get("startDate");
    const endDateStr = formData.get("endDate");
    const conditions = JSON.parse(formData.get("conditions") || "[]");

    const startDate =
      startDateStr && startDateStr !== "null" && startDateStr.trim() !== ""
        ? new Date(startDateStr)
        : null;
    const endDate =
      endDateStr && endDateStr !== "null" && endDateStr.trim() !== ""
        ? new Date(endDateStr)
        : null;

    // First delete old conditions
    await prisma.merchandisingRuleCondition.deleteMany({
      where: { ruleId: id },
    });

    const updatedRule = await prisma.merchandisingRule.update({
      where: { id, shop },
      data: {
        name,
        searchQueries,
        ruleType: "search",
        customerTags,
        locales,
        startDate,
        endDate,
        conditions: {
          create: conditions.map((c) => ({
            action: c.action,
            field: c.field,
            value:
              typeof c.value === "string" ? c.value : JSON.stringify(c.value),
            maxValue:
              c.value2 ? (typeof c.value2 === "string" ? c.value2 : JSON.stringify(c.value2)) : null,
            operator: c.operator,
            operand: c.operand,
            dateValue: c.dateValue,
          })),
        },
      },
    });
    return Response.json({ success: true, intent: "edit", rule: updatedRule });
  }

  if (actionType === "deleteRule") {
    const id = formData.get("id");
    await prisma.merchandisingRule.deleteMany({ where: { id, shop } });
    return Response.json({ success: true, intent: "delete" });
  }

  if (actionType === "toggleRule") {
    const id = formData.get("id");
    const status = formData.get("status") === "true";
    await prisma.merchandisingRule.updateMany({
      where: { id, shop },
      data: { status },
    });
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
        searchQueries: existingRule.searchQueries || [],
        ruleType: "search",
        customerTags: existingRule.customerTags || "",
        locales: existingRule.locales || "",
        startDate: existingRule.startDate || null,
        endDate: existingRule.endDate || null,
        status: existingRule.status,
        conditions: {
          create: existingRule.conditions.map((c) => ({
            action: c.action,
            field: c.field,
            value: c.value,
            maxValue: c.maxValue,
            operator: c.operator,
            operand: c.operand,
            dateValue: c.dateValue,
          })),
        },
      },
    });
    return Response.json({ success: true, intent: "duplicate" });
  }

  if (actionType === "importRules") {
    const rules = JSON.parse(formData.get("rules") || "[]");
    let importedCount = 0;
    
    for (const r of rules) {
      const ruleName = r.name || "Imported Rule";
      
      const existingRule = await prisma.merchandisingRule.findFirst({
        where: { shop, name: ruleName, ruleType: "search" }
      });
      
      if (existingRule) {
        await prisma.merchandisingRule.delete({ where: { id: existingRule.id } });
      }
      
      await prisma.merchandisingRule.create({
        data: {
          shop,
          name: ruleName,
          searchQueries: r.searchQueries || [],
          ruleType: "search",
          customerTags: r.customerTags || "",
          locales: r.locales || "",
          startDate: r.startDate ? new Date(r.startDate) : null,
          endDate: r.endDate ? new Date(r.endDate) : null,
          status: r.status,
          conditions: {
            create: (r.conditions || []).map((c) => ({
              action: c.action,
              field: c.field,
              value: typeof c.value === "string" ? c.value : JSON.stringify(c.value),
              maxValue: c.value2 ? (typeof c.value2 === "string" ? c.value2 : JSON.stringify(c.value2)) : null,
              operator: c.operator,
              operand: c.operand,
              dateValue: c.dateValue,
            })),
          },
        },
      });
      importedCount++;
    }
    
    return Response.json({ success: true, intent: "importRules", count: importedCount });
  }

  return Response.json({ error: "Invalid action" });
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let graphqlData;
  let lookupWarning = null;
  try {
    const graphqlQuery = await admin.graphql(`
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
    `);
    graphqlData = await graphqlQuery.json();
    if (graphqlData.errors?.length) {
      throw new Error("Shopify returned errors loading merchandising options");
    }
  } catch (error) {
    // Authentication responses must reach Shopify's boundary unchanged.
    if (error instanceof Response) throw error;
    console.error("Error fetching search merchandising options:", error);
    lookupWarning = "Some collection and location options could not be loaded. Refresh the page to retry before editing rules that use these options.";
  }
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

  const vendorsData = await prisma.product.groupBy({
    by: ["vendor"],
    where: { shop, vendor: { not: "" } },
  });
  const shopifyVendors = vendorsData.map((v) => v.vendor).sort();

  const productTypesData = await prisma.product.groupBy({
    by: ["productType"],
    where: { shop, productType: { not: "" } },
  });
  const shopifyProductTypes = productTypesData.map((p) => p.productType).sort();

  const tagsRaw = await prisma.$queryRaw`
    SELECT DISTINCT unnest(tags) as tag
    FROM "Product"
    WHERE shop = ${shop} AND array_length(tags, 1) > 0
  `;
  const shopifyTags = tagsRaw.map(t => t.tag.trim()).sort();

  const productsData = await prisma.$queryRaw`
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
  `;
  const shopifyProducts = productsData.map((p) => ({ title: p.title, image: p.image || null }));

  const skusData = await prisma.$queryRaw`
    SELECT v.sku, p.title as "productTitle", v.option1, v.option2, v.option3, v."imageUrl" as image
    FROM "Variant" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE p.shop = ${shop} AND v.sku IS NOT NULL AND v.sku != ''
    LIMIT 250
  `;
  const shopifySkus = skusData.map((v) => {
    let variantTitleParts = [v.option1, v.option2, v.option3].filter(Boolean);
    let variantTitle = variantTitleParts.join(" / ");
    return {
      title: `${v.sku}|${v.productTitle} ${variantTitle !== "Default Title" ? variantTitle : ""}`.trim(),
      image: v.image || null,
    };
  });
  
  const shopifyBarcodes = [];

  const optionsRaw = await prisma.$queryRaw`
    SELECT 
      el->>'name' as name, 
      jsonb_array_elements_text(el->'values') as value 
    FROM "Product", 
    jsonb_array_elements(options) as el 
    WHERE shop = ${shop} AND options IS NOT NULL AND options::text != 'null' AND options::text != '[]'
  `;

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

  const merchandisingRules = await prisma.merchandisingRule.findMany({
    where: { shop, ruleType: "search" },
    orderBy: { createdAt: "desc" },
    include: { conditions: true },
  });

  return {
    lookupWarning,
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

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function MerchandisingIndex() {
  const {
    lookupWarning,
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
  const [isCreateSearchRuleModalOpen, setIsCreateSearchRuleModalOpen] =
    useState(false);
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedRules, setSelectedRules] = useState([]);
  const [ruleToDelete, setRuleToDelete] = useState(null);
  const [ruleToEdit, setRuleToEdit] = useState(null);
  const [ruleMatchType, setRuleMatchType] = useState("all");
  const [ruleFilters, setRuleFilters] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  const defaultColumns = [
    { id: "Name", label: "Name", visible: true },
    { id: "Search Queries", label: "Search Queries", visible: true },
    { id: "Status", label: "Status", visible: true },
    { id: "Action", label: "Action", visible: true },
    { id: "Date Range", label: "Date Range", visible: true },
  ];
  const [tableColumns, setTableColumns] = useState(defaultColumns);
  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isCreateDropdownOpen && !e.target.closest('.create-dropdown-inside')) {
        setIsCreateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCreateDropdownOpen]);

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
      if (filter.field === "Search Queries") {
        const val = filter.value.toLowerCase();
        const queries = rule.searchQueries || [];
        const queriesString = queries.join(" ").toLowerCase();
        switch (filter.operator) {
          case "contains":
            return queriesString.includes(val);
          case "does not contains":
            return !queriesString.includes(val);
          case "equals":
            return queries.some((q) => q.toLowerCase() === val);
          case "does not equal":
            return !queries.some((q) => q.toLowerCase() === val);
          case "starts with":
            return queries.some((q) => q.toLowerCase().startsWith(val));
          case "ends with":
            return queries.some((q) => q.toLowerCase().endsWith(val));
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
      if (!e.target.closest(".merch-dropdown-inside")) {
        setIsStatusDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      if (fetcher.data.intent === "create")
        shopify.toast.show("Rule created successfully");
      if (fetcher.data.intent === "edit")
        shopify.toast.show("Rule updated successfully");
      if (fetcher.data.intent === "delete")
        shopify.toast.show("Rule deleted successfully");
      if (fetcher.data.intent === "toggle")
        shopify.toast.show("Rule status updated");
      if (fetcher.data.intent === "duplicate")
        shopify.toast.show("Rule duplicated successfully");
      if (fetcher.data.intent === "importRules")
        shopify.toast.show(`Successfully imported ${fetcher.data.count} rule(s)`);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <s-page heading="Merchandising">
      {lookupWarning && <s-banner tone="warning">{lookupWarning}</s-banner>}
      <ui-title-bar title="Search > Merchandising">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Back to Search
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
          href="/app/search"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/search");
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
          Back to Search
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
            <div
              style={{ position: "relative" }}
              className="merch-dropdown-inside"
            >
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
                    border: "1px solid rgba(30, 27, 75, 0.08)",
                    borderRadius: "10px",
                    boxShadow: "0 10px 15px -3px rgba(30, 27, 75, 0.1)",
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
                      fontWeight: statusFilter === "all" ? "600" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(91, 33, 182, 0.04)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    All rules
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
                      fontWeight: statusFilter === "active" ? "600" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(91, 33, 182, 0.04)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Active rules
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
                      fontWeight: statusFilter === "inactive" ? "600" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(91, 33, 182, 0.04)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Inactive rules
                  </div>
                </div>
              )}
            </div>

            {/* Create rule button & Export logic */}
            {selectedRules.length > 0 ? (
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <span style={{ fontSize: "14px", color: "#64748b" }}>
                  {selectedRules.length} rule{selectedRules.length > 1 ? "s" : ""} selected
                </span>
                <button
                  className="merch-btn-secondary"
                  onClick={() => setIsExportModalOpen(true)}
                  style={{ gap: "8px", border: "1px solid #5B21B6", color: "#5B21B6" }}
                >
                  Export selected
                </button>
              </div>
            ) : (
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
                      borderRadius: "12px",
                      boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
                      border: "1px solid rgba(0,0,0,0.05)",
                      zIndex: 100,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1E1B4B",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(91, 33, 182, 0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onClick={() => {
                        setRuleToEdit(null);
                        setIsCreateSearchRuleModalOpen(true);
                        setIsCreateDropdownOpen(false);
                      }}
                    >
                      <svg style={{ width: "16px", height: "16px" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                      Create a New Rule
                    </div>
                    <div
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1E1B4B",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(91, 33, 182, 0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onClick={() => {
                        setIsImportModalOpen(true);
                        setIsCreateDropdownOpen(false);
                      }}
                    >
                      <svg style={{ width: "16px", height: "16px" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Import Rules
                    </div>
                  </div>
                )}
              </div>
            )}
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
                  border: "4px solid rgba(91, 33, 182, 0.1)",
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
                borderRadius: "16px",
                boxShadow: "0 4px 20px rgba(30, 27, 75, 0.04)",
                overflow: "hidden",
                border: "1px solid rgba(30, 27, 75, 0.06)",
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
                      borderBottom: "1px solid rgba(30, 27, 75, 0.06)",
                      background: "rgba(91, 33, 182, 0.01)",
                      color: "#64748b",
                      fontWeight: "600",
                      textAlign: "left",
                    }}
                  >
                    {tableColumns
                      .filter((c) => c.visible)
                      .map((c) => (
                        <th key={c.id} style={{ padding: "18px 24px" }}>
                          {c.id === "Name" ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={filteredRules.length > 0 && selectedRules.length === filteredRules.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRules(filteredRules);
                                  } else {
                                    setSelectedRules([]);
                                  }
                                }}
                                style={{
                                  accentColor: "#5B21B6",
                                  width: "15px",
                                  height: "15px",
                                }}
                              />{" "}
                              {c.label}
                            </div>
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
                        style={{
                          borderBottom: "1px solid rgba(30, 27, 75, 0.04)",
                          transition: "background 0.2s ease",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "rgba(91, 33, 182, 0.01)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
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
                                  }}
                                >
                                  <div
                                    style={{
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
                                        color: "#cbd5e1",
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
                                      checked={selectedRules.some(r => r.id === rule.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedRules([...selectedRules, rule]);
                                        } else {
                                          setSelectedRules(selectedRules.filter(r => r.id !== rule.id));
                                        }
                                      }}
                                      style={{
                                        accentColor: "#5B21B6",
                                        width: "15px",
                                        height: "15px",
                                      }}
                                    />
                                    <span
                                      onClick={() => {
                                        setRuleToEdit(rule);
                                        setIsCreateSearchRuleModalOpen(true);
                                      }}
                                      style={{
                                        color: "#5B21B6",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        transition: "color 0.2s ease",
                                      }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.color =
                                          "#1E1B4B")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.color =
                                          "#5B21B6")
                                      }
                                    >
                                      {rule.name}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            if (c.id === "Search Queries") {
                              return (
                                <td key={c.id} style={{ padding: "16px 24px" }}>
                                  {rule.searchQueries &&
                                  rule.searchQueries.length > 0 ? (
                                    <span
                                      style={{
                                        background: "rgba(91, 33, 182, 0.08)",
                                        color: "#5B21B6",
                                        padding: "6px 14px",
                                        borderRadius: "20px",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                        border:
                                          "1px solid rgba(91, 33, 182, 0.1)",
                                      }}
                                    >
                                      {rule.searchQueries[0]}{" "}
                                      {rule.searchQueries.length > 1 &&
                                        `+${rule.searchQueries.length - 1}`}
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        color: "#94a3b8",
                                        fontStyle: "italic",
                                      }}
                                    >
                                      All searches
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
                                      width: "42px",
                                      height: "22px",
                                      background: rule.status
                                        ? "#5B21B6"
                                        : "#e2e8f0",
                                      borderRadius: "11px",
                                      position: "relative",
                                      cursor: "pointer",
                                      transition: "0.2s ease",
                                      opacity:
                                        fetcher.state !== "idle" ? 0.7 : 1,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: "18px",
                                        height: "18px",
                                        background: "#fff",
                                        borderRadius: "50%",
                                        position: "absolute",
                                        top: "2px",
                                        left: rule.status ? "22px" : "2px",
                                        transition: "0.2s ease",
                                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
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
                                    color: "#cbd5e1",
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
                                          width: "18px",
                                          height: "18px",
                                          cursor: "pointer",
                                          color:
                                            fetcher.state !== "idle"
                                              ? "#e2e8f0"
                                              : "#64748b",
                                          transition: "color 0.2s",
                                        }}
                                        onMouseEnter={(e) =>
                                          (e.currentTarget.style.color =
                                            "#5B21B6")
                                        }
                                        onMouseLeave={(e) =>
                                          (e.currentTarget.style.color =
                                            "#64748b")
                                        }
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
                                        width: "18px",
                                        height: "18px",
                                        cursor: "pointer",
                                        color:
                                          fetcher.state !== "idle"
                                            ? "#e2e8f0"
                                            : "#ef4444",
                                        transition: "color 0.2s",
                                      }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.color =
                                          "#dc2626")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.color =
                                          "#ef4444")
                                      }
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
                                  {rule.startDate || rule.endDate ? (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        color: "#5B21B6",
                                        fontWeight: "500",
                                      }}
                                    >
                                      <svg
                                        style={{
                                          width: "14px",
                                          height: "14px",
                                        }}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                        ></path>
                                      </svg>
                                      Scheduled
                                    </span>
                                  ) : (
                                    <span style={{ color: "#64748b" }}>
                                      Always active
                                    </span>
                                  )}
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
                          padding: "60px 24px",
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
                    setIsCreateSearchRuleModalOpen(true);
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
          targetField="Search Queries"
          currentFilters={ruleFilters}
          onApply={(match, filters) => {
            setRuleMatchType(match);
            setRuleFilters(filters);
            setIsFilterModalOpen(false);
          }}
        />

        {/* Delete Confirmation Modal */}
        {ruleToDelete && (
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
                  color: "#334155",
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
                    border: "1px solid #cbd5e1",
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

        <CreateSearchRuleModal
          isOpen={isCreateSearchRuleModalOpen}
          onClose={() => {
            setIsCreateSearchRuleModalOpen(false);
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
        <CustomizeColumnsModal
          isOpen={isCustomizeColumnsOpen}
          onClose={() => setIsCustomizeColumnsOpen(false)}
          currentColumns={tableColumns}
          onApply={(cols) => {
            setTableColumns(cols);
            setIsCustomizeColumnsOpen(false);
          }}
        />
        {isImportModalOpen && (
          <ImportMerchandisingRulesModal
            ruleType="search"
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            onSubmit={(parsedRules) => {
              setIsImportModalOpen(false);
              const formData = new FormData();
              formData.append("actionType", "importRules");
              formData.append("rules", JSON.stringify(parsedRules));
              fetcher.submit(formData, { method: "POST" });
            }}
          />
        )}
        {isExportModalOpen && (
          <ExportMerchandisingRulesModal
            isOpen={isExportModalOpen}
            onClose={() => {
              setIsExportModalOpen(false);
              setSelectedRules([]);
            }}
            selectedRuleIds={selectedRules.map(rule => rule.id)}
            allRules={merchandisingRules}
          />
        )}
      </div>
    </s-page>
  );
}
