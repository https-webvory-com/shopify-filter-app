import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import FilterModal from "../components/merchandising/FilterModal";
import CustomizeColumnsModal from "../components/merchandising/CustomizeColumnsModal";
import ImportCollectionPinsModal from "../components/merchandising/ImportCollectionPinsModal";
import ExportCollectionPinsModal from "../components/merchandising/ExportCollectionPinsModal";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "deleteRule") {
    const id = formData.get("id");
    await prisma.pinnedProductRule.deleteMany({ where: { id, shop } });
    return { success: true, action: "deleteRule" };
  }

  if (actionType === "duplicateRule") {
    const id = formData.get("id");
    const originalRule = await prisma.pinnedProductRule.findFirst({
      where: { id, shop },
    });
    if (originalRule) {
      await prisma.pinnedProductRule.create({
        data: {
          shop: originalRule.shop,
          name: `${originalRule.name || "Untitled"} (Copy)`,
          status: originalRule.status,
          applyToAll: originalRule.applyToAll,
          collections: originalRule.collections,
          products: originalRule.products,
        },
      });
      return { success: true, action: "duplicateRule" };
    }
    return { success: false, message: "Rule not found" };
  }

  if (actionType === "toggleStatus") {
    const id = formData.get("id");
    const status = formData.get("status") === "true";
    await prisma.pinnedProductRule.update({
      where: { id },
      data: { status },
    });
    return { success: true, action: "toggleStatus", status };
  }

  if (actionType === "importRules") {
    const rules = JSON.parse(formData.get("rules") || "[]");
    let importedCount = 0;
    
    // 1. Gather all product IDs
    const allProductIds = new Set();
    for (const rule of rules) {
      if (Array.isArray(rule.products)) {
        for (const p of rule.products) {
          if (p && p.id) allProductIds.add(p.id);
        }
      }
    }

    // 2. Fetch valid product IDs from DB
    let validProductsSet = new Set();
    if (allProductIds.size > 0) {
      const validProducts = await prisma.product.findMany({
        where: { shop, id: { in: Array.from(allProductIds) } },
        select: { id: true }
      });
      validProductsSet = new Set(validProducts.map(p => p.id));
    }

    // 3. Gather all collection titles
    const allCollectionTitles = new Set();
    for (const rule of rules) {
      if (Array.isArray(rule.collections)) {
        for (const c of rule.collections) {
          if (c) allCollectionTitles.add(c);
        }
      }
    }

    // 4. Fetch valid collection titles from DB
    let validCollectionsSet = new Set();
    if (allCollectionTitles.size > 0) {
      const validCollections = await prisma.collection.findMany({
        where: { shop, title: { in: Array.from(allCollectionTitles) } },
        select: { title: true }
      });
      validCollectionsSet = new Set(validCollections.map(c => c.title));
    }

    for (const r of rules) {
      const validRuleProducts = (r.products || []).filter(p => p && p.id && validProductsSet.has(p.id));
      const validRuleCollections = (r.collections || []).filter(c => validCollectionsSet.has(c));

      // Skip rule if it has no valid products
      if (validRuleProducts.length === 0) continue;

      const ruleName = r.name || "Imported Pin";
      
      const existingRule = await prisma.pinnedProductRule.findFirst({
        where: { shop, name: ruleName, ruleType: "collection" }
      });
      
      if (existingRule) {
        await prisma.pinnedProductRule.delete({ where: { id: existingRule.id } });
      }
      
      await prisma.pinnedProductRule.create({
        data: {
          shop,
          name: ruleName,
          status: r.status,
          applyToAll: r.applyToAll,
          collections: validRuleCollections,
          products: validRuleProducts,
          applyToSearchType: r.applyToSearchType || "both",
          ruleType: "collection"
        }
      });
      importedCount++;
    }
    
    return { success: true, action: "importRules", count: importedCount, total: rules.length };
  }

  return { success: false, message: "Unknown action" };
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const pinningRules = await prisma.pinnedProductRule.findMany({
    where: { shop, ruleType: "collection" },
    orderBy: { createdAt: "desc" },
  });

  const graphqlQuery = await admin.graphql(`
    #graphql
    query {
      collections(first: 250) {
        nodes {
          id
          title
        }
      }
    }
  `);
  const graphqlData = await graphqlQuery.json();
  const collections =
    graphqlData?.data?.collections?.nodes
      ?.map((c) => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title)) || [];

  return { pinningRules, collections };
};

export default function PinningIndex() {
  const { pinningRules, collections } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const actionData = useActionData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.success) {
      if (actionData.action === "deleteRule") {
        shopify.toast.show("Pin deleted successfully");
      } else if (actionData.action === "duplicateRule") {
        shopify.toast.show("Pin duplicated successfully");
      } else if (actionData.action === "toggleStatus") {
        shopify.toast.show(actionData.status ? "Pin enabled" : "Pin disabled");
      } else if (actionData.action === "importRules") {
        if (actionData.count === actionData.total) {
          shopify.toast.show(`Successfully imported ${actionData.count} pins`);
        } else {
          shopify.toast.show(`Imported ${actionData.count} pins. Skipped ${actionData.total - actionData.count} rules due to invalid or missing products.`);
        }
      }
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".pin-dropdown-inside") && !e.target.closest(".create-dropdown-inside")) {
        setIsStatusDropdownOpen(false);
        setIsSortDropdownOpen(false);
        setIsCreateDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggleStatus = (id, currentStatus) => {
    const formData = new FormData();
    formData.append("actionType", "toggleStatus");
    formData.append("id", id);
    formData.append("status", (!currentStatus).toString());
    submit(formData, { method: "post" });
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedRules, setSelectedRules] = useState([]);
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [ruleMatchType, setRuleMatchType] = useState("all");
  const [ruleFilters, setRuleFilters] = useState([]);

  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState([
    { id: "Collection", label: "Collection", visible: true },
    { id: "Status", label: "Status", visible: true },
    { id: "Pinned Items", label: "Pinned Items", visible: true },
    { id: "Created Date", label: "Created Date", visible: true },
    { id: "Actions", label: "Actions", visible: true },
  ]);

  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [sortOption, setSortOption] = useState("recent");

  const filteredRules = pinningRules.filter((rule) => {
    let matchesSearch =
      (rule.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.collections || [])
        .join(" ")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
    if (statusFilter === "active" && !rule.status) return false;
    if (statusFilter === "inactive" && rule.status) return false;
    return matchesSearch;
  });

  const sortedRules = [...filteredRules].sort((a, b) => {
    if (sortOption === "recent") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    if (sortOption === "oldest") {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    return 0;
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createApplyToAll, setCreateApplyToAll] = useState(false);
  const [createCollections, setCreateCollections] = useState([]);
  const [createSearchQuery, setCreateSearchQuery] = useState("");

  const handleCreateNew = () => {
    setIsCreateModalOpen(true);
    setCreateApplyToAll(false);
    setCreateCollections([]);
    setCreateSearchQuery("");
  };

  const proceedToCreate = () => {
    const params = new URLSearchParams();
    if (createApplyToAll) params.append("applyToAll", "true");
    if (createCollections.length > 0)
      params.append("collections", JSON.stringify(createCollections));
    navigate(`/app/collections/pinning/new?${params.toString()}`);
  };

  const [deleteRuleId, setDeleteRuleId] = useState(null);

  const handleDelete = (id) => {
    setDeleteRuleId(id);
  };

  const handleDuplicate = (id) => {
    const formData = new FormData();
    formData.append("actionType", "duplicateRule");
    formData.append("id", id);
    submit(formData, { method: "POST" });
  };

  const confirmDelete = () => {
    if (deleteRuleId) {
      const formData = new FormData();
      formData.append("actionType", "deleteRule");
      formData.append("id", deleteRuleId);
      submit(formData, { method: "POST" });
      setDeleteRuleId(null);
    }
  };

  return (
    <s-page heading="Product Pinning" full-width="true">
      <ui-title-bar title="Product Pinning">
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
          box-shadow: 0 0px 3px rgba(30, 27, 75, 0.05) !important;
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

        /* Modal custom light scrollbar */
        .pin-modal-card::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
        }
        .pin-modal-card::-webkit-scrollbar-track {
          background: rgba(30, 27, 75, 0.02) !important;
        }
        .pin-modal-card::-webkit-scrollbar-thumb {
          background: rgba(30, 27, 75, 0.15) !important;
          border-radius: 6px !important;
        }
        .pin-modal-card::-webkit-scrollbar-thumb:hover {
          background: rgba(30, 27, 75, 0.3) !important;
        }
        .pin-modal-card input:focus {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 2px rgba(91, 33, 182, 0.1) !important;
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
        {/* Header */}
        <div className="merch-toolbar">
          <div style={{ display: "flex", gap: "12px" }}>
            {/* All rules dropdown */}
            <div
              style={{ position: "relative" }}
              className="pin-dropdown-inside"
            >
              <div
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className="merch-btn-secondary"
              >
                {statusFilter === "all"
                  ? "All pins"
                  : statusFilter === "active"
                    ? "Active pins"
                    : "Inactive pins"}{" "}
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
                    All pins
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
                    Active pins
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
                    Inactive pins
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

            {/* Create rule button dropdown wrapper */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {pinningRules.length > 0 && selectedRules.length > 0 && (
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
              )}

              <div style={{ position: "relative" }} className="create-dropdown-inside">
              <div
                onClick={() => setIsCreateDropdownOpen(!isCreateDropdownOpen)}
                className="merch-btn-primary"
                style={{ paddingRight: "8px", userSelect: "none" }}
              >
                Create pin
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
                    style={{ width: "12px", height: "12px", transform: isCreateDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
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
                    top: "100%",
                    left: 0,
                    marginTop: "8px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                    zIndex: 50,
                    width: "200px",
                    overflow: "hidden"
                  }}
                >
                  <div
                    onClick={() => {
                      handleCreateNew();
                      setIsCreateDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: "#1E1B4B",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    Create a New Pin
                  </div>
                  <div
                    onClick={() => {
                      setIsImportModalOpen(true);
                      setIsCreateDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: "#1E1B4B",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                    Import Pins
                  </div>
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

            {/* Sort Dropdown */}
            <div
              style={{ position: "relative" }}
              className="pin-dropdown-inside"
            >
              <button
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                className="merch-icon-btn"
                title="Sort rules"
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
                    d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                  />
                </svg>
              </button>
              {isSortDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "8px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                    zIndex: 50,
                    width: "160px",
                  }}
                >
                  <div
                    onClick={() => {
                      setSortOption("recent");
                      setIsSortDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: sortOption === "recent" ? "#5B21B6" : "#1E1B4B",
                      fontWeight: sortOption === "recent" ? "500" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Newest first
                  </div>
                  <div
                    onClick={() => {
                      setSortOption("oldest");
                      setIsSortDropdownOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: sortOption === "oldest" ? "#5B21B6" : "#1E1B4B",
                      fontWeight: sortOption === "oldest" ? "500" : "400",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    Oldest first
                  </div>
                </div>
              )}
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

          {deleteRuleId && (
            <div
              onClick={() => setDeleteRuleId(null)}
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
                  Delete Pinning Rule
                </h2>
                <p
                  style={{
                    margin: "0 0 24px 0",
                    fontSize: "14px",
                    color: "#475569",
                  }}
                >
                  Are you sure you want to delete this pinning rule? This action
                  cannot be undone.
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "12px",
                  }}
                >
                  <button
                    onClick={() => setDeleteRuleId(null)}
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
                    onClick={confirmDelete}
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
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create Pin Modal */}
          {isCreateModalOpen && (
            <div
              onClick={() => setIsCreateModalOpen(false)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                background: "rgba(0,0,0,0.4)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="pin-modal-card"
                style={{
                  background: "#fff",
                  borderRadius: "16px",
                  width: "450px",
                  maxWidth: "90%",
                  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    background: "rgba(91, 33, 182, 0.04)",
                    padding: "18px 24px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(91, 33, 182, 0.08)",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "16px",
                      fontWeight: "700",
                      color: "#1E1B4B",
                    }}
                  >
                    Select collections to apply
                  </h2>
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    style={{
                      background: "rgba(30, 27, 75, 0.05)",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      color: "#64748b",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(239, 68, 68, 0.1)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(30, 27, 75, 0.05)")
                    }
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
                        d="M6 18L18 6M6 6l12 12"
                      ></path>
                    </svg>
                  </button>
                </div>

                {/* Search / Filter */}
                <div style={{ padding: "16px 20px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "#ffffff",
                      padding: "8px 16px",
                      borderRadius: "10px",
                      border: "1px solid rgba(30, 27, 75, 0.12)",
                      transition: "all 0.2s",
                    }}
                    onFocusWithin={(e) => {
                      e.currentTarget.style.borderColor = "#5B21B6";
                      e.currentTarget.style.boxShadow =
                        "0 0 0 2px rgba(91, 33, 182, 0.1)";
                    }}
                    onBlurWithin={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(30, 27, 75, 0.12)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <svg
                      style={{
                        width: "18px",
                        height: "18px",
                        color: "#64748b",
                        marginRight: "12px",
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
                      placeholder="Filter"
                      value={createSearchQuery}
                      onChange={(e) => setCreateSearchQuery(e.target.value)}
                      style={{
                        border: "none",
                        background: "transparent",
                        outline: "none",
                        fontSize: "14px",
                        color: "#1E1B4B",
                        width: "100%",
                      }}
                    />
                  </div>
                </div>

                {/* Collection List */}
                <div
                  style={{
                    padding: "0 20px",
                    maxHeight: "250px",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    marginBottom: "16px",
                  }}
                >
                  {/* All Collections Option */}
                  {createSearchQuery.trim() === "" && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                        padding: "4px 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={createApplyToAll}
                        onChange={(e) => {
                          setCreateApplyToAll(e.target.checked);
                          setCreateCollections([]);
                        }}
                        style={{
                          width: "16px",
                          height: "16px",
                          cursor: "pointer",
                          accentColor: "#5B21B6",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "14px",
                          color: "#1E1B4B",
                          fontWeight: "600",
                        }}
                      >
                        All collections
                      </span>
                    </label>
                  )}

                  {collections
                    .filter((c) =>
                      c.title
                        .toLowerCase()
                        .includes(createSearchQuery.toLowerCase()),
                    )
                    .map((c) => (
                      <label
                        key={c.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          cursor: "pointer",
                          padding: "4px 0",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            createApplyToAll ||
                            createCollections.includes(c.title)
                          }
                          onChange={(e) => {
                            if (createApplyToAll) {
                              setCreateApplyToAll(false);
                              setCreateCollections(
                                collections
                                  .map((col) => col.title)
                                  .filter((title) => title !== c.title),
                              );
                            } else {
                              if (e.target.checked) {
                                const newSelections = [
                                  ...createCollections,
                                  c.title,
                                ];
                                if (
                                  newSelections.length === collections.length
                                ) {
                                  setCreateApplyToAll(true);
                                  setCreateCollections([]);
                                } else {
                                  setCreateCollections(newSelections);
                                }
                              } else {
                                setCreateCollections(
                                  createCollections.filter(
                                    (title) => title !== c.title,
                                  ),
                                );
                              }
                            }
                          }}
                          style={{
                            width: "16px",
                            height: "16px",
                            cursor: "pointer",
                            accentColor: "#5B21B6",
                          }}
                        />
                        <span
                          style={{
                            fontSize: "14px",
                            color: "#1E1B4B",
                            fontWeight: "400",
                          }}
                        >
                          {c.title}
                        </span>
                      </label>
                    ))}
                  {collections.filter((c) =>
                    c.title
                      .toLowerCase()
                      .includes(createSearchQuery.toLowerCase()),
                  ).length === 0 && (
                    <div
                      style={{
                        textAlign: "center",
                        color: "#64748b",
                        padding: "20px 0",
                        fontSize: "14px",
                      }}
                    >
                      No collections found
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: "16px 20px",
                    background: "#f8fafc",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "12px",
                  }}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    style={{
                      background: "#fff",
                      border: "1px solid rgba(30, 27, 75, 0.12)",
                      color: "#1E1B4B",
                      padding: "8px 20px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(91, 33, 182, 0.04)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "#fff")
                    }
                  >
                    Cancel
                  </button>
                  <button
                    onClick={proceedToCreate}
                    disabled={
                      !createApplyToAll && createCollections.length === 0
                    }
                    style={{
                      background:
                        !createApplyToAll && createCollections.length === 0
                          ? "#94a3b8"
                          : "#5B21B6",
                      border: "none",
                      color: "#fff",
                      padding: "8px 20px",
                      borderRadius: "10px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor:
                        !createApplyToAll && createCollections.length === 0
                          ? "not-allowed"
                          : "pointer",
                      boxShadow:
                        !createApplyToAll && createCollections.length === 0
                          ? "none"
                          : "0 2px 4px rgba(91, 33, 182, 0.15)",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      if (
                        !(!createApplyToAll && createCollections.length === 0)
                      ) {
                        e.currentTarget.style.background = "#1e1b4b";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (
                        !(!createApplyToAll && createCollections.length === 0)
                      ) {
                        e.currentTarget.style.background = "#5B21B6";
                      }
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div
          style={{
            background: "#fff",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            overflow: "hidden",
          }}
        >
          {pinningRules.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center" }}>
              <h2
                className="merch-empty-heading"
                style={{ fontSize: "20px !important" }}
              >
                No pinned products yet
              </h2>
              <p
                className="merch-empty-desc"
                style={{ margin: "0 auto 24px auto" }}
              >
                Select specific products to always appear at the top of a
                collection.
              </p>
              <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                <button
                  onClick={handleCreateNew}
                  className="merch-btn-primary"
                  style={{ padding: "10px 24px !important" }}
                >
                  Add your pins
                </button>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  style={{
                    background: "#fff",
                    color: "#5B21B6",
                    border: "1px solid #5B21B6",
                    padding: "10px 24px",
                    borderRadius: "24px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Import pins
                </button>
              </div>
            </div>
          ) : sortedRules.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center" }}>
              <svg
                style={{
                  width: "48px",
                  height: "48px",
                  color: "#94a3b8",
                  margin: "0 auto 16px",
                }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                ></path>
              </svg>
              <h2
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#1E1B4B",
                  marginBottom: "8px",
                }}
              >
                No pins found
              </h2>
              <p
                style={{
                  color: "#64748b",
                  marginBottom: "20px",
                  fontSize: "14px",
                }}
              >
                Try changing your search or filter criteria to find what you're
                looking for.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
                style={{
                  background: "#f1f5f9",
                  color: "#1E1B4B",
                  border: "1px solid rgba(91, 33, 182, 0.2)",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <th style={{ padding: "12px 16px", width: "40px" }}>
                    <input
                      type="checkbox"
                      checked={pinningRules.length > 0 && selectedRules.length === pinningRules.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRules(pinningRules);
                        } else {
                          setSelectedRules([]);
                        }
                      }}
                      style={{ cursor: "pointer", accentColor: "#5B21B6" }}
                    />
                  </th>
                  {tableColumns
                    .filter((c) => c.visible)
                    .map((c) => (
                      <th
                        key={c.id}
                        style={{
                          padding: "12px 16px",
                          textAlign: c.id === "Actions" ? "right" : "left",
                          fontSize: "12px",
                          textTransform: "uppercase",
                          color: "#64748b",
                          fontWeight: "600",
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {sortedRules.map((rule) => {
                  const productList =
                    typeof rule.products === "string"
                      ? JSON.parse(rule.products)
                      : rule.products;
                  const count = Array.isArray(productList)
                    ? productList.length
                    : 0;

                  return (
                    <tr
                      key={rule.id}
                      style={{ borderBottom: "1px solid #f1f5f9" }}
                    >
                      <td style={{ padding: "16px", width: "40px" }}>
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
                          style={{ cursor: "pointer", accentColor: "#5B21B6" }}
                        />
                      </td>
                      {tableColumns
                        .filter((c) => c.visible)
                        .map((c) => {
                          if (c.id === "Collection") {
                            const collText = rule.applyToAll
                              ? "All collections"
                              : rule.collections && rule.collections.length > 0
                                ? rule.collections.join(", ")
                                : "None";
                            return (
                              <td
                                key="col"
                                style={{
                                  padding: "16px",
                                  fontSize: "14px",
                                  fontWeight: "500",
                                  color: "#1E1B4B",
                                }}
                              >
                                <span
                                  onClick={() =>
                                    navigate(
                                      `/app/collections/pinning/${rule.id}`,
                                    )
                                  }
                                  style={{
                                    color: "#5B21B6",
                                    cursor: "pointer",
                                  }}
                                >
                                  {rule.name || "Pinning Rule"}
                                </span>
                                <div
                                  style={{
                                    fontSize: "12px",
                                    color: "#64748b",
                                    marginTop: "4px",
                                  }}
                                >
                                  {collText}
                                </div>
                              </td>
                            );
                          }
                          if (c.id === "Status") {
                            return (
                              <td
                                key="status"
                                style={{
                                  padding: "16px",
                                  fontSize: "14px",
                                  color: "#64748b",
                                }}
                              >
                                <div
                                  onClick={() =>
                                    handleToggleStatus(rule.id, rule.status)
                                  }
                                  style={{
                                    width: "40px",
                                    height: "24px",
                                    background:
                                      rule.status !== false
                                        ? "#5B21B6"
                                        : "rgba(91, 33, 182, 0.2)",
                                    borderRadius: "12px",
                                    position: "relative",
                                    cursor: "pointer",
                                    transition: "background 0.3s",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "18px",
                                      height: "18px",
                                      background: "#fff",
                                      borderRadius: "50%",
                                      position: "absolute",
                                      top: "3px",
                                      left:
                                        rule.status !== false ? "19px" : "3px",
                                      transition: "left 0.3s",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                                    }}
                                  ></div>
                                </div>
                              </td>
                            );
                          }
                          if (c.id === "Pinned Items") {
                            return (
                              <td
                                key="pins"
                                style={{
                                  padding: "16px",
                                  fontSize: "14px",
                                  color: "#64748b",
                                }}
                              >
                                {count} Products
                              </td>
                            );
                          }
                          if (c.id === "Created Date") {
                            return (
                              <td
                                key="date"
                                style={{
                                  padding: "16px",
                                  fontSize: "14px",
                                  color: "#64748b",
                                }}
                              >
                                {new Date(rule.createdAt).toLocaleDateString()}
                              </td>
                            );
                          }
                          if (c.id === "Actions") {
                            return (
                              <td
                                key="actions"
                                style={{
                                  padding: "16px",
                                  textAlign: "right",
                                  color: "rgba(91, 33, 182, 0.2)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "16px",
                                    justifyContent: "flex-end",
                                    alignItems: "center",
                                  }}
                                >
                                  <svg
                                    onClick={() =>
                                      navigate(
                                        `/app/collections/pinning/${encodeURIComponent(rule.id)}`,
                                      )
                                    }
                                    title="Edit"
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      cursor: "pointer",
                                      color: "#64748b",
                                    }}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    ></path>
                                  </svg>
                                  <svg
                                    onClick={() => handleDuplicate(rule.id)}
                                    title="Duplicate"
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      cursor: "pointer",
                                      color: "#3b82f6",
                                    }}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    ></path>
                                  </svg>
                                  <svg
                                    onClick={() => handleDelete(rule.id)}
                                    title="Delete"
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      cursor: "pointer",
                                      color: "#ef4444",
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
                          return null;
                        })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

        <CustomizeColumnsModal
          isOpen={isCustomizeColumnsOpen}
          onClose={() => setIsCustomizeColumnsOpen(false)}
          currentColumns={tableColumns}
          onApply={(cols) => {
            setTableColumns(cols);
            setIsCustomizeColumnsOpen(false);
          }}
        />

        <ImportCollectionPinsModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          isSubmitting={navigation.state !== "idle"}
          onSubmit={(rules) => {
            const formData = new FormData();
            formData.append("actionType", "importRules");
            formData.append("rules", JSON.stringify(rules));
            submit(formData, { method: "POST" });
            setIsImportModalOpen(false);
          }}
        />
        {isExportModalOpen && (
          <ExportCollectionPinsModal
            isOpen={isExportModalOpen}
            onClose={() => {
              setIsExportModalOpen(false);
              setSelectedRules([]);
            }}
            selectedRuleIds={selectedRules.map(r => r.id)}
            allRules={pinningRules}
          />
        )}
      </div>
    </s-page>
  );
}
