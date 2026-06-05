import { useState, useEffect } from "react";
import {
  useFetcher,
  useNavigation,
  useLoaderData,
  useNavigate,
} from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import FilterModal from "../components/merchandising/FilterModal";
import CreateSearchRuleModal from "../components/merchandising/CreateSearchRuleModal";
import CustomizeColumnsModal from "../components/merchandising/CustomizeColumnsModal";

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
            operator: c.operator,
            operand: c.operand,
            dateValue: c.dateValue,
          })),
        },
      },
    });
    return Response.json({ success: true, intent: "duplicate" });
  }

  return Response.json({ error: "Invalid action" });
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

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
      products(first: 250) {
        nodes {
          title
          featuredImage { url }
          variants(first: 25) {
            nodes {
              title
              sku
              barcode
              image { url }
            }
          }
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

  const tagsData = await prisma.product.findMany({
    where: { shop, tags: { isEmpty: false } },
    select: { tags: true },
  });
  const tagsSet = new Set();
  tagsData.forEach((p) => {
    if (p.tags && Array.isArray(p.tags)) {
      p.tags.forEach((t) => tagsSet.add(t.trim()));
    }
  });
  const shopifyTags = Array.from(tagsSet).sort();

  const productsData = await prisma.product.findMany({
    where: { shop },
    select: { title: true, images: true },
  });
  const shopifyProducts = productsData.map((p) => {
    let image = null;
    if (p.images) {
      try {
        const imgs =
          typeof p.images === "string" ? JSON.parse(p.images) : p.images;
        if (imgs && imgs.length > 0)
          image = imgs[0]?.url || imgs[0]?.originalSrc || imgs[0]?.src || null;
      } catch (e) {}
    }
    return { title: p.title, image };
  });

  const shopifySkus = [];
  const shopifyBarcodesSet = new Set();

  graphqlData?.data?.products?.nodes?.forEach((p) => {
    p.variants?.nodes?.forEach((v) => {
      if (v.sku) {
        const image = v.image?.url || p.featuredImage?.url || null;
        shopifySkus.push({
          title:
            `${v.sku}|${p.title} ${v.title !== "Default Title" ? v.title : ""}`.trim(),
          image,
        });
      }
      if (v.barcode) {
        shopifyBarcodesSet.add(v.barcode);
      }
    });
  });
  const shopifyBarcodes = Array.from(shopifyBarcodesSet).sort();

  const productsWithOptions = await prisma.product.findMany({
    where: { shop, options: { not: "[]" } },
    select: { options: true },
  });

  const optionsMap = {};
  for (const p of productsWithOptions) {
    let opts = [];
    if (typeof p.options === "string") {
      try {
        opts = JSON.parse(p.options);
      } catch (e) {}
    } else if (Array.isArray(p.options)) {
      opts = p.options;
    }
    for (const opt of opts) {
      if (opt && opt.name && opt.values) {
        if (!optionsMap[opt.name]) optionsMap[opt.name] = new Set();
        opt.values.forEach((v) => optionsMap[opt.name].add(v));
      }
    }
  }

  const shopifyOptions = {};
  for (const [name, valSet] of Object.entries(optionsMap)) {
    shopifyOptions[name] = Array.from(valSet).sort();
  }

  const merchandisingRules = await prisma.merchandisingRule.findMany({
    where: { shop, ruleType: "search" },
    orderBy: { createdAt: "desc" },
    include: { conditions: true },
  });

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
  const [isCreateSearchRuleModalOpen, setIsCreateSearchRuleModalOpen] =
    useState(false);
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
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <s-page heading="Merchandising">
      <ui-title-bar title="Search > Merchandising">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Back to Search
        </button>
      </ui-title-bar>

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
        }}
      >
        <a
          href="/app/search"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/search");
          }}
          style={{
            color: "#006e52",
            textDecoration: "none",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
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
              strokeWidth="2"
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
          minHeight: "100vh",
          padding: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#fff",
            padding: "12px 24px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            {/* All rules dropdown */}
            <div
              style={{ position: "relative" }}
              className="merch-dropdown-inside"
            >
              <div
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#f1f5f9",
                  padding: "8px 16px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  color: "#007bff",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
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
                      color: statusFilter === "all" ? "#007bff" : "#334155",
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
                        color: statusFilter === "all" ? "#007bff" : "#cbd5e1",
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
                      color: statusFilter === "active" ? "#007bff" : "#334155",
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
                          statusFilter === "active" ? "#007bff" : "#cbd5e1",
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
                        statusFilter === "inactive" ? "#007bff" : "#334155",
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
                          statusFilter === "inactive" ? "#007bff" : "#cbd5e1",
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

            {/* Create rule button */}
            <div
              onClick={() => {
                setRuleToEdit(null);
                setIsCreateSearchRuleModalOpen(true);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                background: "#007bff",
                padding: "8px 16px",
                borderRadius: "20px",
                cursor: "pointer",
                color: "#fff",
                fontSize: "14px",
                fontWeight: "600",
              }}
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
                  style={{ width: "12px", height: "12px" }}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Right side search */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "#f1f5f9",
                padding: "8px 16px",
                borderRadius: "20px",
                width: "250px",
              }}
            >
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
                  strokeWidth="2"
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
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#64748b",
              }}
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
                  strokeWidth="2"
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                ></path>
              </svg>
            </button>
            <button
              onClick={() => setIsCustomizeColumnsOpen(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#64748b",
              }}
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
                  strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                ></path>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div
          style={{ maxWidth: "1200px", margin: "40px auto", textAlign: "left" }}
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
                  border: "4px solid #cbd5e1",
                  borderTop: "4px solid #007bff",
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
                  color: "#334155",
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
                                style={{ marginRight: "12px" }}
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
                                  <input type="checkbox" />
                                  <span
                                    onClick={() => {
                                      setRuleToEdit(rule);
                                      setIsCreateSearchRuleModalOpen(true);
                                    }}
                                    style={{
                                      color: "#007bff",
                                      fontWeight: "500",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {rule.name}
                                  </span>
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
                                        background: "#eff6ff",
                                        color: "#007bff",
                                        padding: "4px 12px",
                                        borderRadius: "12px",
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      {rule.searchQueries[0]}{" "}
                                      {rule.searchQueries.length > 1 &&
                                        `+${rule.searchQueries.length - 1}`}
                                    </span>
                                  ) : (
                                    <span style={{ color: "#94a3b8" }}>
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
                                      width: "40px",
                                      height: "24px",
                                      background: rule.status
                                        ? "#007bff"
                                        : "#cbd5e1",
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
                margin: "100px auto",
                textAlign: "left",
              }}
            >
              <h1
                style={{
                  fontSize: "42px",
                  fontWeight: "800",
                  color: "#007bff",
                  marginBottom: "16px",
                  letterSpacing: "-0.5px",
                }}
              >
                Add your merchandising rules
              </h1>
              <p
                style={{
                  fontSize: "16px",
                  color: "#475569",
                  lineHeight: "1.6",
                  marginBottom: "32px",
                  maxWidth: "700px",
                }}
              >
                Help manipulate groups of products - push them to the top, bury
                to the bottom of the results by adding new merchandising rules
                to your store, or import your existing rules.
              </p>

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={() => {
                    setRuleToEdit(null);
                    setIsCreateSearchRuleModalOpen(true);
                  }}
                  style={{
                    background: "#007bff",
                    color: "#fff",
                    border: "none",
                    padding: "10px 24px",
                    borderRadius: "24px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    boxShadow: "0 2px 4px rgba(0,123,255,0.2)",
                  }}
                >
                  Add rule
                </button>
                <button
                  style={{
                    background: "#eff6ff",
                    color: "#007bff",
                    border: "none",
                    padding: "10px 24px",
                    borderRadius: "24px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
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
      </div>
    </s-page>
  );
}
