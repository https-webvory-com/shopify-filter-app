import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { matchesRuleFilters } from "../utils/ruleFilters";
import prisma from "../db.server";
import FilterModal from "../components/merchandising/FilterModal";
import CustomizeColumnsModal from "../components/merchandising/CustomizeColumnsModal";
import ImportSearchPinsModal from "../components/merchandising/ImportSearchPinsModal";
import ExportSearchPinsModal from "../components/merchandising/ExportSearchPinsModal";

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

  if (actionType === "bulkDeleteRules") {
    const ids = JSON.parse(formData.get("ids") || "[]");
    await prisma.pinnedProductRule.deleteMany({ where: { id: { in: ids }, shop } });
    return { success: true, action: "bulkDeleteRules", count: ids.length };
  }

  if (actionType === "duplicateRule") {
    const id = formData.get("id");
    const originalRule = await prisma.pinnedProductRule.findFirst({ where: { id, shop } });
    if (originalRule) {
      await prisma.pinnedProductRule.create({
        data: {
          shop: originalRule.shop,
          name: `${originalRule.name || "Untitled"} (Copy)`,
          status: originalRule.status,
          ruleType: "search",
          applyToAll: originalRule.applyToAll,
          searchQueries: originalRule.searchQueries,
          applyToSearchType: originalRule.applyToSearchType,
          products: originalRule.products,
        }
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

  return { success: false, message: "Unknown action" };
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const pinningRules = await prisma.pinnedProductRule.findMany({
    where: { shop, ruleType: "search" },
    orderBy: { createdAt: "desc" },
  });

  return { pinningRules };
};

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function PinningIndex() {
  const { pinningRules } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
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
      } else if (actionData.action === "bulkDeleteRules") {
        shopify.toast.show(`${actionData.count} pins deleted successfully`);
      }
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.pin-dropdown-inside') && !e.target.closest('.create-pin-dropdown-inside')) {
        setIsStatusDropdownOpen(false);
        setIsSortDropdownOpen(false);
        setIsCreateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleStatus = (id, currentStatus) => {
    const formData = new FormData();
    formData.append("actionType", "toggleStatus");
    formData.append("id", id);
    formData.append("status", (!currentStatus).toString());
    submit(formData, { method: "post" });
  };

  const [searchQuery, setSearchQuery] = useState("");

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedRules, setSelectedRules] = useState([]);

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [ruleMatchType, setRuleMatchType] = useState("all");
  const [ruleFilters, setRuleFilters] = useState([]);

  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);
  const [tableColumns, setTableColumns] = useState([
    { id: "Search Queries", label: "Search Queries", visible: true },
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
      (rule.searchQueries || [])
        .join(" ")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
    if (statusFilter === "active" && !rule.status) return false;
    if (statusFilter === "inactive" && rule.status) return false;
    return matchesSearch && matchesRuleFilters(rule, ruleFilters, ruleMatchType);
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
  const [createSearchQueries, setCreateSearchQueries] = useState([]);
  const [createSearchQuery, setCreateSearchQuery] = useState("");

  const handleCreateNew = () => {
    setIsCreateModalOpen(true);
    setCreateApplyToAll(false);
    setCreateSearchQueries([]);
    setCreateSearchQuery("");
  };

  const proceedToCreate = () => {
    if (createApplyToAll) {
      const existingAll = pinningRules.find(r => r.applyToAll);
      if (existingAll) {
        window.shopify?.toast?.show("A pinning rule already exists for All Searches. Please edit the existing rule.", { isError: true });
        return;
      }
    } else if (createSearchQueries.length > 0) {
      for (const q of createSearchQueries) {
        const existing = pinningRules.find(r => r.searchQueries && r.searchQueries.includes(q));
        if (existing) {
          window.shopify?.toast?.show(`A pinning rule already exists for search query: ${q}. Please edit the existing rule.`, { isError: true });
          return;
        }
      }
    }

    const params = new URLSearchParams();
    if (createApplyToAll) params.append("applyToAll", "true");
    if (createSearchQueries.length > 0)
      params.append("searchQueries", JSON.stringify(createSearchQueries));
    navigate(`/app/search/pinning/new?${params.toString()}`);
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

  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);

  const confirmBulkDelete = () => {
    if (selectedRules.length > 0) {
      const formData = new FormData();
      formData.append("actionType", "bulkDeleteRules");
      formData.append("ids", JSON.stringify(selectedRules.map(r => r.id)));
      submit(formData, { method: "POST" });
      setIsBulkDeleteModalOpen(false);
      setSelectedRules([]);
    }
  };

  return (
    <s-page heading="Product Pinning" full-width="true">
      <ui-title-bar title="Product Pinning">
        <button
          variant="breadcrumb"
          onClick={() => navigate("/app/search")}
        >
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
          padding: "20px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#fff",
            padding: "12px 24px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            {/* All rules dropdown */}
            <div style={{ position: "relative" }} className="pin-dropdown-inside">
              <div
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#f1f5f9",
                  padding: "8px 16px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  color: "#5B21B6",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
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
                      color: statusFilter === "all" ? "#5B21B6" : "#334155",
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
                        color: statusFilter === "all" ? "#5B21B6" : "#cbd5e1",
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
                      color: statusFilter === "active" ? "#5B21B6" : "#334155",
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
                          statusFilter === "active" ? "#5B21B6" : "#cbd5e1",
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
                        statusFilter === "inactive" ? "#5B21B6" : "#334155",
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
                          statusFilter === "inactive" ? "#5B21B6" : "#cbd5e1",
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

            {/* Import / Export / Create rule buttons */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {pinningRules.length > 0 && selectedRules.length > 0 && (
                <>
                  <button
                    onClick={() => setIsBulkDeleteModalOpen(true)}
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

              <div style={{ position: "relative" }} className="create-pin-dropdown-inside">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "#5B21B6",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    color: "#fff",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                  onClick={() => setIsCreateDropdownOpen(!isCreateDropdownOpen)}
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
                        handleCreateNew();
                        setIsCreateDropdownOpen(false);
                      }}
                    >
                      <svg style={{ width: "16px", height: "16px" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                      Create a New Pin
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
                      Import Pins
                    </div>
                  </div>
                )}
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

            {/* Sort Dropdown */}
            <div style={{ position: "relative" }} className="pin-dropdown-inside">
              <button
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Sort rules"
              >
                <svg style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
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
                    onClick={() => { setSortOption("recent"); setIsSortDropdownOpen(false); }}
                    style={{ padding: "12px 16px", cursor: "pointer", fontSize: "14px", color: sortOption === "recent" ? "#5B21B6" : "#334155", fontWeight: sortOption === "recent" ? "500" : "400" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Newest first
                  </div>
                  <div
                    onClick={() => { setSortOption("oldest"); setIsSortDropdownOpen(false); }}
                    style={{ padding: "12px 16px", cursor: "pointer", fontSize: "14px", color: sortOption === "oldest" ? "#5B21B6" : "#334155", fontWeight: sortOption === "oldest" ? "500" : "400" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Oldest first
                  </div>
                </div>
              )}
            </div>

            <button
              aria-label="Filter rules"
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
              aria-label="Customize columns"
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
                      border: "1px solid #cbd5e1",
                      color: "#334155",
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
                style={{
                  background: "#fff",
                  borderRadius: "12px",
                  width: "450px",
                  maxWidth: "90%",
                  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: "#f5f3ff",
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid #ede9fe",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "16px",
                      fontWeight: "600",
                      color: "#5B21B6",
                    }}
                  >
                    Target Search Queries
                  </h2>
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#64748b",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  </button>
                </div>
                
                <div style={{ padding: "20px" }}>
                  <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#475569" }}>
                    Enter the search queries where you want to pin products.
                  </p>
                  
                  <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
                    <input 
                      type="text" 
                      value={createSearchQuery}
                      onChange={(e) => setCreateSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && createSearchQuery.trim()) {
                           if (!createSearchQueries.includes(createSearchQuery.trim())) {
                              setCreateSearchQueries([...createSearchQueries, createSearchQuery.trim()]);
                           }
                           setCreateSearchQuery("");
                        }
                      }}
                      placeholder="e.g. shoes, black dress"
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        fontSize: "14px",
                        outline: "none"
                      }}
                    />
                    <button 
                      onClick={() => {
                        if (createSearchQuery.trim() && !createSearchQueries.includes(createSearchQuery.trim())) {
                           setCreateSearchQueries([...createSearchQueries, createSearchQuery.trim()]);
                           setCreateSearchQuery("");
                        }
                      }}
                      style={{
                        background: "#5B21B6",
                        color: "#fff",
                        border: "none",
                        padding: "0 16px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "500"
                      }}
                    >
                      Add
                    </button>
                  </div>
                  
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", minHeight: "40px" }}>
                    {createSearchQueries.map(q => (
                      <div key={q} style={{ 
                        background: "#f1f5f9", 
                        border: "1px solid #e2e8f0",
                        padding: "4px 10px", 
                        borderRadius: "16px",
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}>
                        {q}
                        <button 
                          onClick={() => setCreateSearchQueries(createSearchQueries.filter(item => item !== q))}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            color: "#64748b",
                            display: "flex"
                          }}
                        >
                          <svg style={{ width: "14px", height: "14px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                          </svg>
                        </button>
                      </div>
                    ))}
                    {createSearchQueries.length === 0 && (
                      <span style={{ color: "#94a3b8", fontSize: "14px", fontStyle: "italic" }}>No queries added</span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    background: "#f8fafc",
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderTop: "1px solid #e2e8f0",
                  }}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#64748b",
                      fontWeight: "500",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={proceedToCreate}
                    disabled={createSearchQueries.length === 0}
                    style={{
                      background: createSearchQueries.length === 0 ? "#cbd5e1" : "#5B21B6",
                      color: "#fff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontWeight: "500",
                      fontSize: "14px",
                      cursor: createSearchQueries.length === 0 ? "not-allowed" : "pointer",
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
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#333",
                  marginBottom: "8px",
                }}
              >
                No pinned products yet
              </h2>
              <p style={{ color: "#666", marginBottom: "20px" }}>
                Select specific products to always appear at the top of a
                collection.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                <button
                  onClick={handleCreateNew}
                  style={{
                    background: "#5B21B6",
                    color: "#fff",
                    border: "none",
                    padding: "10px 20px",
                    borderRadius: "20px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Add your pins
                </button>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  style={{
                    background: "#f1f5f9",
                    color: "#005bd3",
                    border: "none",
                    padding: "10px 20px",
                    borderRadius: "20px",
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
                  color: "#334155",
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
                  color: "#334155",
                  border: "1px solid #cbd5e1",
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
                        {c.id === "Search Queries" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
                      {tableColumns
                        .filter((c) => c.visible)
                        .map((c) => {
                          if (c.id === "Search Queries") {
                            const collText =
                              rule.applyToAll ? "All searches" : rule.searchQueries && rule.searchQueries.length > 0
                                ? rule.searchQueries.join(", ")
                                : "None";
                            return (
                              <td
                                key="col"
                                style={{
                                  padding: "16px",
                                  fontSize: "14px",
                                  fontWeight: "500",
                                  color: "#334155",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                                  <div>
                                    <span
                                      onClick={() =>
                                        navigate(
                                          `/app/search/pinning/${rule.id}`,
                                        )
                                      }
                                      style={{
                                        color: "#5B21B6",
                                        cursor: "pointer",
                                      }}
                                    >
                                      {rule.name || "Pinning Rule"}
                                    </span>
                                    {rule.name !== collText && (
                                      <div
                                        style={{
                                          fontSize: "12px",
                                          color: "#64748b",
                                          marginTop: "4px",
                                        }}
                                      >
                                        {collText}
                                      </div>
                                    )}
                                  </div>
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
                                        : "#cbd5e1",
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
                                  color: "#cbd5e1",
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
                                        `/app/search/pinning/${encodeURIComponent(rule.id)}`,
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
                                      color: "#7C3AED",
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
          targetField="Search Queries"
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

        <ImportSearchPinsModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImportComplete={() => {
            revalidator.revalidate();
          }}
        />

        {isBulkDeleteModalOpen && (
          <div
            onClick={() => setIsBulkDeleteModalOpen(false)}
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
                Bulk Delete Pinning Rules
              </h2>
              <p
                style={{
                  margin: "0 0 24px 0",
                  color: "#475569",
                  fontSize: "14px",
                  lineHeight: "1.5",
                }}
              >
                Are you sure you want to delete {selectedRules.length} rules? This action cannot be undone.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "12px",
                }}
              >
                <button
                  onClick={() => setIsBulkDeleteModalOpen(false)}
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
                  onClick={confirmBulkDelete}
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

        {isExportModalOpen && (
          <ExportSearchPinsModal
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
