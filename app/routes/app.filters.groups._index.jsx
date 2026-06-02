import { useState, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigate,
  useNavigation,
  useActionData,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";

// ── Built-in filters seeded into every new default group ─────────────
const DEFAULT_FILTERS = [
  {
    filterType: "price",
    filterKey: null,
    label: "Price",
    displayMode: "range",
    order: 0,
  },
  {
    filterType: "vendor",
    filterKey: null,
    label: "Brand",
    displayMode: "list",
    order: 1,
  },
  {
    filterType: "product_type",
    filterKey: null,
    label: "Product Type",
    displayMode: "list",
    order: 2,
  },
  {
    filterType: "collection",
    filterKey: null,
    label: "Collection",
    displayMode: "list",
    order: 3,
  },
  {
    filterType: "option",
    filterKey: "Color",
    label: "Color",
    displayMode: "list",
    order: 4,
  },
  {
    filterType: "option",
    filterKey: "Denominations",
    label: "Denominations",
    displayMode: "list",
    order: 5,
  },
  {
    filterType: "option",
    filterKey: "Size",
    label: "Size",
    displayMode: "list",
    order: 6,
  },
  {
    filterType: "option",
    filterKey: "slot",
    label: "slot",
    displayMode: "list",
    order: 7,
  },
  {
    filterType: "option",
    filterKey: "Title",
    label: "Title",
    displayMode: "list",
    order: 8,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────
async function ensureDefaultGroup(shop) {
  const existing = await prisma.filterGroup.findFirst({
    where: { shop, isDefault: true },
    include: { collections: true, filters: true },
  });

  if (!existing) {
    await prisma.filterGroup.create({
      data: {
        shop,
        name: "Default filter group",
        isDefault: true,
        status: true,
        order: 0,
        collections: {
          create: [
            {
              collectionId: "__all__",
              collectionTitle: "All Collections",
              pageType: "collection",
            },
          ],
        },
        filters: { create: DEFAULT_FILTERS },
      },
    });
    return;
  }

  const hasAllCollections = existing.collections.some(
    (c) => c.collectionId === "__all__",
  );
  if (!hasAllCollections) {
    await prisma.filterGroupCollection.create({
      data: {
        filterGroupId: existing.id,
        collectionId: "__all__",
        collectionTitle: "All Collections",
        pageType: "collection",
      },
    });
  }

  const filtersToDelete = existing.filters
    .filter(
      (filter) =>
        filter.filterType === "availability" || filter.filterType === "tag",
    )
    .map((filter) => filter.id);

  if (filtersToDelete.length > 0) {
    await prisma.filterGroupItem.deleteMany({
      where: { id: { in: filtersToDelete } },
    });
  }

  const existingFilterKeys = new Set(
    existing.filters
      .filter(
        (filter) =>
          filter.filterType !== "availability" && filter.filterType !== "tag",
      )
      .map((filter) => `${filter.filterType}:${filter.filterKey ?? ""}`),
  );

  const missingFilters = DEFAULT_FILTERS.filter(
    (filter) =>
      !existingFilterKeys.has(`${filter.filterType}:${filter.filterKey ?? ""}`),
  );

  if (missingFilters.length > 0) {
    await prisma.filterGroupItem.createMany({
      data: missingFilters.map((filter) => ({
        filterGroupId: existing.id,
        filterType: filter.filterType,
        filterKey: filter.filterKey,
        label: filter.label,
        displayMode: filter.displayMode,
        isEnabled: true,
        order: filter.order,
      })),
    });
  }
}

// ── Loader ───────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureDefaultGroup(shop);

  const groups = await prisma.filterGroup.findMany({
    where: { shop },
    orderBy: { order: "asc" },
    include: {
      collections: true,
      _count: { select: { filters: true } },
    },
  });

  // Also load collections available in DB for the picker
  const collections = await prisma.collection.findMany({
    where: { shop },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  return { groups, collections };
};

// ── Action ───────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = formData.get("name");
    const groupType = formData.get("groupType"); // "collections" | "search"
    const selectedCollections = JSON.parse(
      formData.get("selectedCollections") || "[]",
    );

    const existingGroup = await prisma.filterGroup.findFirst({
      where: { shop, name: { equals: name, mode: "insensitive" } },
    });
    if (existingGroup) {
      return {
        success: false,
        error: "A filter group with this name already exists.",
        intent,
      };
    }

    const lastGroup = await prisma.filterGroup.findFirst({
      where: { shop },
      orderBy: { order: "desc" },
    });
    const nextOrder = (lastGroup?.order ?? -1) + 1;

    const group = await prisma.filterGroup.create({
      data: {
        shop,
        name,
        isDefault: false,
        status: true,
        order: nextOrder,
        collections: {
          create:
            groupType === "search"
              ? [
                  {
                    collectionId: "search",
                    collectionTitle: "Search Page",
                    pageType: "search",
                  },
                ]
              : selectedCollections.length > 0
                ? selectedCollections.map((c) => ({
                    collectionId: c.id,
                    collectionTitle: c.title,
                    pageType: "collection",
                  }))
                : [
                    {
                      collectionId: "__all__",
                      collectionTitle: "All Collections",
                      pageType: "collection",
                    },
                  ],
        },
      },
    });

    return { success: true, groupId: group.id, intent };
  }

  if (intent === "delete") {
    const id = formData.get("id");
    await prisma.filterGroup.delete({ where: { id } });
    return { success: true, intent };
  }

  if (intent === "toggle") {
    const id = formData.get("id");
    const current = await prisma.filterGroup.findUnique({
      where: { id },
      select: { status: true },
    });
    await prisma.filterGroup.update({
      where: { id },
      data: { status: !current.status },
    });
    return { success: true, intent };
  }

  if (intent === "duplicate") {
    const id = formData.get("id");
    const source = await prisma.filterGroup.findUnique({
      where: { id },
      include: { collections: true, filters: true },
    });
    if (!source) return { success: false };

    const lastGroup = await prisma.filterGroup.findFirst({
      where: { shop },
      orderBy: { order: "desc" },
    });
    const nextOrder = (lastGroup?.order ?? -1) + 1;

    const nameMatch = source.name.match(/^(.*?)\s*\((\d+)\)$/);
    let baseName = source.name;
    let counter = 1;
    if (nameMatch) {
      baseName = nameMatch[1];
      counter = parseInt(nameMatch[2], 10);
    }

    let newName = `${baseName} (Copy)`;
    let existing;
    do {
      existing = await prisma.filterGroup.findFirst({
        where: { shop, name: { equals: newName, mode: "insensitive" } },
      });
      if (existing) {
        counter++;
        newName = `${baseName} (${counter})`;
      }
    } while (existing);

    await prisma.filterGroup.create({
      data: {
        shop,
        name: newName,
        isDefault: false,
        status: source.status,
        order: nextOrder,
        collections: {
          create: source.collections.map((c) => ({
            collectionId: c.collectionId,
            collectionTitle: c.collectionTitle,
            pageType: c.pageType,
          })),
        },
        filters: {
          create: source.filters.map((f) => ({
            filterType: f.filterType,
            filterKey: f.filterKey,
            label: f.label,
            displayMode: f.displayMode,
            isEnabled: f.isEnabled,
            order: f.order,
            config: f.config,
          })),
        },
      },
    });

    return { success: true, intent };
  }

  return { success: false };
};

// ── Component ────────────────────────────────────────────────────────
const INITIAL_COLUMNS = [
  { id: "name", label: "Filter group name", isVisible: true, isRequired: true },
  {
    id: "collections",
    label: "Collections",
    isVisible: true,
    isRequired: false,
  },
  { id: "pages", label: "Pages", isVisible: true, isRequired: false },
  { id: "status", label: "Status", isVisible: true, isRequired: false },
  { id: "action", label: "Action", isVisible: true, isRequired: false },
];

export default function FilterGroups() {
  const { groups, collections } = useLoaderData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const isLoading = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.success) {
      if (actionData.intent === "create")
        shopify.toast.show("Filter group created");
      else if (actionData.intent === "delete")
        shopify.toast.show("Filter group deleted");
      else if (actionData.intent === "toggle")
        shopify.toast.show("Status updated");
      else if (actionData.intent === "duplicate")
        shopify.toast.show("Filter group duplicated");
    } else if (actionData && !actionData.success) {
      shopify.toast.show(actionData.error || "An error occurred", {
        isError: true,
      });
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-inside')) {
        setShowViewsDropdown(false);
        setShowCollDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [groupType, setGroupType] = useState("collections");
  const [selectedColls, setSelectedColls] = useState([]);
  const [showCollDropdown, setShowCollDropdown] = useState(false);
  const [searchColl, setSearchColl] = useState("");
  const [groupToDelete, setGroupToDelete] = useState(null);

  // Search and View state for the groups list
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState("all");

  // Columns customization state
  const [columns, setColumns] = useState(INITIAL_COLUMNS);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  const [tempColumns, setTempColumns] = useState([]);
  const [colSearch, setColSearch] = useState("");
  const [draggedColId, setDraggedColId] = useState(null);

  // Filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterMatch, setFilterMatch] = useState("all");
  const [filterConditions, setFilterConditions] = useState([]);
  const [showViewsDropdown, setShowViewsDropdown] = useState(false);

  const openColumnsModal = () => {
    setTempColumns([...columns]);
    setColSearch("");
    setShowColumnsModal(true);
  };

  const saveColumns = () => {
    setColumns(tempColumns);
    setShowColumnsModal(false);
  };

  const toggleCol = (id) => {
    setTempColumns((prev) =>
      prev.map((c) =>
        c.id === id && !c.isRequired ? { ...c, isVisible: !c.isVisible } : c,
      ),
    );
  };

  const selectAllCols = () => {
    setTempColumns((prev) => prev.map((c) => ({ ...c, isVisible: true })));
  };

  const clearAllCols = () => {
    setTempColumns((prev) =>
      prev.map((c) => (c.isRequired ? c : { ...c, isVisible: false })),
    );
  };

  const handleDragStart = (e, id) => {
    setDraggedColId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    if (!draggedColId || draggedColId === targetId) return;
    setTempColumns((prev) => {
      const oldIndex = prev.findIndex((c) => c.id === draggedColId);
      const newIndex = prev.findIndex((c) => c.id === targetId);
      const newCols = [...prev];
      const [moved] = newCols.splice(oldIndex, 1);
      newCols.splice(newIndex, 0, moved);
      return newCols;
    });
  };

  const filteredCollections = collections.filter((c) =>
    c.title.toLowerCase().includes(searchColl.toLowerCase()),
  );

  const filteredGroups = groups.filter((g) => {
    const matchesSearch = g.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    let matchesView = true;
    if (activeView === "active") matchesView = g.status === true;
    if (activeView === "inactive") matchesView = g.status === false;
    if (activeView === "favorites") matchesView = false; // not implemented yet
    return matchesSearch && matchesView;
  });

  const getActiveViewLabel = () => {
    if (activeView === "active") return "Active filters groups";
    if (activeView === "inactive") return "Inactive filters groups";
    if (activeView === "favorites") return "My favorite groups";
    return "All groups";
  };

  const handleToggleCollection = (coll) => {
    setSelectedColls((prev) =>
      prev.find((c) => c.id === coll.id)
        ? prev.filter((c) => c.id !== coll.id)
        : [...prev, coll],
    );
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    submit(
      {
        intent: "create",
        name: newName,
        groupType,
        selectedCollections: JSON.stringify(selectedColls),
      },
      { method: "POST" },
    );
    setShowCreate(false);
    setNewName("");
    setSelectedColls([]);
    setGroupType("collections");
  };

  const handleDelete = (id) => {
    setGroupToDelete(id);
  };

  const confirmDelete = () => {
    if (groupToDelete) {
      submit({ intent: "delete", id: groupToDelete }, { method: "POST" });
      setGroupToDelete(null);
    }
  };

  const handleToggle = (id) => {
    submit({ intent: "toggle", id }, { method: "POST" });
  };

  const handleDuplicate = (id) => {
    submit({ intent: "duplicate", id }, { method: "POST" });
  };

  return (
    <s-page heading="Filter Groups">
      <ui-title-bar title="Filter Groups">
        <button variant="breadcrumb" onClick={() => navigate("/app/filters")}>
          Filters
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
          href="/app/filters"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/filters");
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
          Back to Filters
        </a>
      </div>

      <s-stack direction="block" gap="base">
        {/* Info Banner */}
        <s-box
          padding="base"
          style={{
            background: "#f1f2f4",
            border: "1px solid #c9cccf",
            borderRadius: "8px",
          }}
        >
          <s-stack direction="inline" gap="base" blockAlign="center">
            <svg
              viewBox="0 0 20 20"
              style={{
                width: "20px",
                height: "20px",
                fill: "#5c5f62",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-9v5h2V9H9zm0-3v2h2V6H9z" />
            </svg>
            <div>
              <s-text variant="headingSm" fontWeight="bold">
                About Filter Groups
              </s-text>
              <s-paragraph
                style={{
                  margin: "4px 0 0",
                  fontSize: "13px",
                  color: "#202223",
                }}
              >
                A filter group consists of filters shown on your collection and
                search pages. When no matching filter group is found for a
                collection, the Default filter group is used automatically.
              </s-paragraph>
            </div>
          </s-stack>
        </s-box>

        {/* Toolbar & Groups Table */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
          }}
        >
          {/* Toolbar */}
          <div
            style={{
              padding: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #e1e3e5",
            }}
          >
            {/* Left Actions */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {/* Views Dropdown */}
              <div style={{ position: "relative" }} className="filter-dropdown-inside">
                <button
                  onClick={() => setShowViewsDropdown(!showViewsDropdown)}
                  style={{
                    background: "#f1f8ff",
                    color: "#007bff",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: "600",
                    outline: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {getActiveViewLabel()} ({filteredGroups.length})
                  <svg
                    viewBox="0 0 20 20"
                    style={{
                      width: "14px",
                      height: "14px",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: "1.5",
                    }}
                  >
                    <path d="M5 7l5 5 5-5" />
                  </svg>
                </button>

                {showViewsDropdown && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: "8px",
                      background: "#fff",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      border: "1px solid #e4e5e7",
                      width: "240px",
                      zIndex: 100,
                    }}
                  >
                    {[
                      {
                        id: "all",
                        label: "All groups",
                        isFavorite: activeView === "all",
                      },
                      {
                        id: "active",
                        label: "Active filters groups",
                        isFavorite: activeView === "active",
                      },
                      {
                        id: "inactive",
                        label: "Inactive filters groups",
                        isFavorite: activeView === "inactive",
                      },
                      {
                        id: "favorites",
                        label: "My favorite groups",
                        isFavorite: activeView === "favorites",
                      },
                    ].map((view) => (
                      <div
                        key={view.id}
                        onClick={() => {
                          setActiveView(view.id);
                          setShowViewsDropdown(false);
                        }}
                        style={{
                          padding: "12px 16px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                          color: activeView === view.id ? "#007bff" : "#202223",
                          fontWeight: activeView === view.id ? "600" : "400",
                          borderBottom:
                            view.id === "all" ? "1px solid #e4e5e7" : "none",
                        }}
                      >
                        {view.label}
                        {view.isFavorite ? (
                          <svg
                            viewBox="0 0 20 20"
                            style={{
                              width: "16px",
                              height: "16px",
                              fill: "#007bff",
                              stroke: "#007bff",
                              strokeWidth: "1.5",
                              strokeLinejoin: "round",
                              strokeLinecap: "round",
                            }}
                          >
                            <path d="M10 2l2.4 5.4 5.6.8-4.2 4.2 1 5.6-5.2-3.2-5.2 3.2 1-5.6-4.2-4.2 5.6-.8z" />
                          </svg>
                        ) : (
                          <svg
                            viewBox="0 0 20 20"
                            style={{
                              width: "16px",
                              height: "16px",
                              fill: "none",
                              stroke: "#66b2ff",
                              strokeWidth: "1.5",
                              strokeLinejoin: "round",
                              strokeLinecap: "round",
                            }}
                          >
                            <path d="M10 2l2.4 5.4 5.6.8-4.2 4.2 1 5.6-5.2-3.2-5.2 3.2 1-5.6-4.2-4.2 5.6-.8z" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Create filter group button */}
              <button
                onClick={() => setShowCreate(true)}
                style={{
                  background: "#007bff",
                  color: "#fff",
                  border: "none",
                  borderRadius: "20px",
                  padding: "8px 20px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                Create filter group
                <span
                  style={{
                    borderLeft: "1px solid rgba(255,255,255,0.3)",
                    paddingLeft: "8px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <svg
                    viewBox="0 0 20 20"
                    style={{
                      width: "14px",
                      height: "14px",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: "1.5",
                    }}
                  >
                    <path d="M5 7l5 5 5-5" />
                  </svg>
                </span>
              </button>
            </div>

            {/* Right Actions (Search & Icons) */}
            <div
              style={{
                display: "flex",
                gap: "16px",
                alignItems: "center",
                flex: 1,
                justifyContent: "flex-end",
                maxWidth: "450px",
              }}
            >
              <div style={{ flex: 1, position: "relative" }}>
                <svg
                  viewBox="0 0 20 20"
                  style={{
                    width: "18px",
                    height: "18px",
                    fill: "none",
                    stroke: "#0066cc",
                    strokeWidth: "1.5",
                    position: "absolute",
                    left: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                >
                  <circle cx="8.5" cy="8.5" r="5" />
                  <path d="M12.5 12.5L16 16" />
                </svg>
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 40px",
                    borderRadius: "20px",
                    border: "none",
                    backgroundColor: "#f0f4f9",
                    fontSize: "14px",
                    color: "#0066cc",
                    outline: "none",
                    fontWeight: "500",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <button
                onClick={openColumnsModal}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: 0,
                }}
                title="Customize Columns"
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "22px",
                    height: "22px",
                    fill: "none",
                    stroke: "#0066cc",
                    strokeWidth: "1.5",
                  }}
                >
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button
                onClick={() => setShowFilterModal(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: 0,
                }}
                title="Filter"
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "22px",
                    height: "22px",
                    fill: "none",
                    stroke: "#0066cc",
                    strokeWidth: "1.5",
                    strokeLinecap: "round",
                  }}
                >
                  <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
                  <circle cx="4" cy="12" r="2" fill="#fff" />
                  <circle cx="12" cy="10" r="2" fill="#fff" />
                  <circle cx="20" cy="14" r="2" fill="#fff" />
                </svg>
              </button>
            </div>
          </div>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid #e1e3e5",
                  background: "#fafafa",
                }}
              >
                {columns
                  .filter((c) => c.isVisible)
                  .map((col) => (
                    <th
                      key={col.id}
                      style={{
                        padding: "12px 16px",
                        fontWeight: "600",
                        fontSize: "13px",
                        color: "#6d7175",
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.filter((c) => c.isVisible).length}
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "#6d7175",
                      fontSize: "14px",
                    }}
                  >
                    No filter groups found.
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => (
                  <tr
                    key={group.id}
                    style={{ borderBottom: "1px solid #f1f2f4" }}
                  >
                    {columns
                      .filter((c) => c.isVisible)
                      .map((col) => {
                        if (col.id === "name") {
                          return (
                            <td key="name" style={{ padding: "14px 16px" }}>
                              <button
                                onClick={() =>
                                  navigate(`/app/filters/groups/${group.id}`)
                                }
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#202223",
                                  fontSize: "14px",
                                  fontWeight: "600",
                                  cursor: "pointer",
                                  padding: 0,
                                  textAlign: "left",
                                }}
                              >
                                {group.name}
                              </button>
                              {group.isDefault && (
                                <span
                                  style={{
                                    marginLeft: "8px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "#e4e5e7",
                                    color: "#6d7175",
                                    fontSize: "11px",
                                    fontWeight: "600",
                                  }}
                                >
                                  DEFAULT
                                </span>
                              )}
                            </td>
                          );
                        }
                        if (col.id === "collections") {
                          return (
                            <td
                              key="collections"
                              style={{ padding: "14px 16px" }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "4px",
                                }}
                              >
                                {group.collections
                                  .filter((c) => c.pageType === "collection")
                                  .map((c) => (
                                    <span
                                      key={c.id}
                                      style={{
                                        padding: "2px 8px",
                                        borderRadius: "4px",
                                        backgroundColor: "#e4e5e7",
                                        color: "#202223",
                                        border: "1px solid #c9cccf",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {c.collectionTitle}
                                    </span>
                                  ))}
                              </div>
                            </td>
                          );
                        }
                        if (col.id === "pages") {
                          return (
                            <td key="pages" style={{ padding: "14px 16px" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "4px",
                                }}
                              >
                                {group.collections
                                  .filter((c) => c.pageType === "search")
                                  .map((c) => (
                                    <span
                                      key={c.id}
                                      style={{
                                        padding: "2px 8px",
                                        borderRadius: "4px",
                                        backgroundColor: "#e4e5e7",
                                        color: "#202223",
                                        border: "1px solid #c9cccf",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {c.collectionTitle}
                                    </span>
                                  ))}
                              </div>
                            </td>
                          );
                        }
                        if (col.id === "status") {
                          return (
                            <td key="status" style={{ padding: "14px 16px" }}>
                              {group.isDefault ? (
                                <span
                                  style={{ color: "#6d7175", fontSize: "13px" }}
                                >
                                  Always Active
                                </span>
                              ) : (
                                <label
                                  style={{
                                    position: "relative",
                                    display: "inline-block",
                                    width: "40px",
                                    height: "22px",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={group.status}
                                    onChange={() => handleToggle(group.id)}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                  />
                                  <span
                                    style={{
                                      position: "absolute",
                                      inset: 0,
                                      backgroundColor: group.status
                                        ? "#008060"
                                        : "#8c9196",
                                      borderRadius: "34px",
                                      transition: "0.2s",
                                    }}
                                  >
                                    <span
                                      style={{
                                        position: "absolute",
                                        height: "16px",
                                        width: "16px",
                                        left: group.status ? "20px" : "4px",
                                        bottom: "3px",
                                        backgroundColor: "white",
                                        transition: "0.2s",
                                        borderRadius: "50%",
                                      }}
                                    />
                                  </span>
                                </label>
                              )}
                            </td>
                          );
                        }
                        if (col.id === "action") {
                          return (
                            <td
                              key="action"
                              style={{
                                padding: "14px 16px",
                                textAlign: "right",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: "12px",
                                  justifyContent: "flex-end",
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  onClick={() =>
                                    navigate(`/app/filters/groups/${group.id}`)
                                  }
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title="Edit"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      fill: "#5c5f62",
                                    }}
                                  >
                                    <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828zM5 12v1h1l7.586-7.586-1-1L5 12zM3 16h14v2H3v-2z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDuplicate(group.id)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title="Duplicate"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      fill: "#5c5f62",
                                    }}
                                  >
                                    <path d="M14 6h-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-8 6V4h6v2h-2a2 2 0 0 0-2 2v4H6zm8 4H8V8h6v8z" />
                                  </svg>
                                </button>
                                {!group.isDefault && (
                                  <button
                                    onClick={() => handleDelete(group.id)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: 0,
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                    title="Delete"
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      style={{
                                        width: "16px",
                                        height: "16px",
                                        fill: "#d82c0d",
                                      }}
                                    >
                                      <path d="M16 4h-3V3a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1H4a1 1 0 0 0 0 2h1v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6h1a1 1 0 1 0 0-2zM9 3h2v1H9V3zm5 14H6V6h8v11z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        }
                        return null;
                      })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </s-stack>

      {/* ── Create Group Modal ──────────────────────────────────── */}
      {showCreate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "32px",
              width: "500px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              position: "relative",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setShowCreate(false)}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg
                viewBox="0 0 20 20"
                style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
              >
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2
              style={{
                margin: "0 0 24px",
                fontSize: "18px",
                fontWeight: 700,
                color: "#202223",
              }}
            >
              Create a new filter group
            </h2>

            {/* Name */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontSize: "14px",
                  color: "#202223",
                }}
              >
                Group Name
              </label>
              <input
                type="text"
                placeholder="e.g. Summer Collection Filters"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Type picker */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "10px",
                  fontSize: "14px",
                  color: "#202223",
                }}
              >
                Use this group for
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="groupType"
                    checked={groupType === "collections"}
                    onChange={() => setGroupType("collections")}
                  />
                  <span style={{ fontSize: "14px", color: "#202223" }}>
                    Collection pages
                  </span>
                </label>

                {groupType === "collections" && (
                  <div style={{ marginLeft: "24px", position: "relative" }} className="filter-dropdown-inside">
                    <div
                      onClick={() => setShowCollDropdown(!showCollDropdown)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid #c9cccf",
                        fontSize: "13px",
                        color: selectedColls.length > 0 ? "#202223" : "#8c9196",
                        cursor: "pointer",
                        background: "#f6f6f7",
                        userSelect: "none",
                      }}
                    >
                      {selectedColls.length > 0
                        ? selectedColls.map((c) => c.title).join(", ")
                        : "All collections (no specific selection)"}
                    </div>
                    {showCollDropdown && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #e1e3e5",
                          borderRadius: "8px",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                          maxHeight: "200px",
                          overflowY: "auto",
                          zIndex: 10,
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ padding: "8px" }}>
                          <input
                            type="text"
                            placeholder="Search collections..."
                            value={searchColl}
                            onChange={(e) => setSearchColl(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: "6px",
                              border: "1px solid #e1e3e5",
                              fontSize: "13px",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                        {filteredCollections.length === 0 ? (
                          <div
                            style={{
                              padding: "12px 16px",
                              color: "#6d7175",
                              fontSize: "13px",
                            }}
                          >
                            {collections.length === 0
                              ? "No collections synced. Sync products first."
                              : "No collections found."}
                          </div>
                        ) : (
                          filteredCollections.map((coll) => (
                            <div
                              key={coll.id}
                              onClick={() => handleToggleCollection(coll)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                padding: "10px 14px",
                                cursor: "pointer",
                                backgroundColor: selectedColls.find(
                                  (c) => c.id === coll.id,
                                )
                                  ? "#f0f4f9"
                                  : "transparent",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  !!selectedColls.find((c) => c.id === coll.id)
                                }
                                onChange={() => {}}
                                style={{ width: "16px", height: "16px" }}
                              />
                              <span
                                style={{ fontSize: "13px", color: "#202223" }}
                              >
                                {coll.title}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="groupType"
                    checked={groupType === "search"}
                    onChange={() => setGroupType("search")}
                  />
                  <span style={{ fontSize: "14px", color: "#202223" }}>
                    Search page
                  </span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
                marginTop: "8px",
              }}
            >
              <s-button onClick={() => setShowCreate(false)}>Cancel</s-button>
              <s-button
                variant="primary"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                Create Group
              </s-button>
            </div>
          </div>
        </div>
      )}
      {/* ── Filter Modal ────────────────────────────────────────── */}
      {showFilterModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFilterModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "24px 32px 32px",
              width: "700px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowFilterModal(false)}
              style={{
                position: "absolute",
                top: "24px",
                right: "24px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg
                viewBox="0 0 20 20"
                style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
              >
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2
              style={{
                margin: "0 0 32px",
                fontSize: "18px",
                fontWeight: 600,
                color: "#202223",
              }}
            >
              Filter
            </h2>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14px",
                  color: "#202223",
                }}
              >
                <span>Show results matching</span>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <select
                    value={filterMatch}
                    onChange={(e) => setFilterMatch(e.target.value)}
                    style={{
                      appearance: "none",
                      background: "#f0f4f9",
                      color: "#007bff",
                      padding: "6px 28px 6px 12px",
                      borderRadius: "16px",
                      border: "none",
                      fontSize: "14px",
                      fontWeight: "500",
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    <option value="all">all</option>
                    <option value="any">any</option>
                  </select>
                  <svg
                    viewBox="0 0 20 20"
                    style={{
                      width: "12px",
                      height: "12px",
                      fill: "none",
                      stroke: "#007bff",
                      strokeWidth: "1.5",
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none",
                    }}
                  >
                    <path d="M5 7l5 5 5-5" />
                  </svg>
                </div>
                <span>of the following conditions</span>
              </div>

              {filterConditions.length > 0 && (
                <button
                  onClick={() => setFilterConditions([])}
                  style={{
                    background: "#fff",
                    border: "1px solid #007bff",
                    color: "#007bff",
                    borderRadius: "16px",
                    padding: "6px 16px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  CLEAR ALL
                </button>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                marginBottom: "24px",
              }}
            >
              {filterConditions.map((cond, index) => (
                <div
                  key={cond.id}
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  {/* Field Dropdown */}
                  <div style={{ position: "relative", width: "180px" }}>
                    <select
                      value={cond.field}
                      onChange={(e) => {
                        const newConds = [...filterConditions];
                        const newField = e.target.value;
                        newConds[index].field = newField;
                        if (newField === "status") {
                          newConds[index].operator = "equals";
                          newConds[index].value = "true";
                        } else {
                          newConds[index].operator = "contains";
                          newConds[index].value = "";
                        }
                        setFilterConditions(newConds);
                      }}
                      style={{
                        appearance: "none",
                        background: "#f0f4f9",
                        color: "#007bff",
                        padding: "8px 32px 8px 16px",
                        borderRadius: "20px",
                        border: "none",
                        fontSize: "14px",
                        fontWeight: "500",
                        outline: "none",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      <option value="name">Item name</option>
                      <option value="status">Active</option>
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "14px",
                        height: "14px",
                        fill: "none",
                        stroke: "#007bff",
                        strokeWidth: "1.5",
                        position: "absolute",
                        right: "12px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <path d="M5 7l5 5 5-5" />
                    </svg>
                  </div>

                  {/* Operator Dropdown */}
                  <div style={{ position: "relative", width: "180px" }}>
                    <select
                      value={cond.operator}
                      onChange={(e) => {
                        const newConds = [...filterConditions];
                        newConds[index].operator = e.target.value;
                        setFilterConditions(newConds);
                      }}
                      style={{
                        appearance: "none",
                        background: "#f0f4f9",
                        color: "#007bff",
                        padding: "8px 32px 8px 16px",
                        borderRadius: "20px",
                        border: "none",
                        fontSize: "14px",
                        fontWeight: "500",
                        outline: "none",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      {cond.field === "name" ? (
                        <>
                          <option value="contains">contains</option>
                          <option value="not_contains">
                            does not contains
                          </option>
                          <option value="equals">equals</option>
                          <option value="not_equals">does not equal</option>
                          <option value="starts_with">starts with</option>
                          <option value="ends_with">ends with</option>
                        </>
                      ) : (
                        <>
                          <option value="equals">equals</option>
                          <option value="not_equals">does not equal</option>
                        </>
                      )}
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "14px",
                        height: "14px",
                        fill: "none",
                        stroke: "#007bff",
                        strokeWidth: "1.5",
                        position: "absolute",
                        right: "12px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <path d="M5 7l5 5 5-5" />
                    </svg>
                  </div>

                  {/* Value Input */}
                  <div
                    style={{
                      flex: 1,
                      paddingLeft: cond.field === "status" ? "16px" : "0",
                    }}
                  >
                    {cond.field === "name" ? (
                      <input
                        type="text"
                        placeholder="Enter value"
                        value={cond.value}
                        onChange={(e) => {
                          const newConds = [...filterConditions];
                          newConds[index].value = e.target.value;
                          setFilterConditions(newConds);
                        }}
                        style={{
                          width: "100%",
                          padding: "8px 16px",
                          borderRadius: "20px",
                          border: "none",
                          backgroundColor: "#f0f4f9",
                          fontSize: "14px",
                          color: "#6d7175",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    ) : (
                      <label
                        style={{
                          position: "relative",
                          display: "inline-block",
                          width: "40px",
                          height: "22px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={cond.value === "true"}
                          onChange={(e) => {
                            const newConds = [...filterConditions];
                            newConds[index].value = e.target.checked
                              ? "true"
                              : "false";
                            setFilterConditions(newConds);
                          }}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            backgroundColor:
                              cond.value === "true" ? "#008060" : "#8c9196",
                            borderRadius: "34px",
                            transition: "0.2s",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              height: "16px",
                              width: "16px",
                              left: cond.value === "true" ? "20px" : "4px",
                              bottom: "3px",
                              backgroundColor: "white",
                              transition: "0.2s",
                              borderRadius: "50%",
                            }}
                          />
                        </span>
                      </label>
                    )}
                  </div>

                  {/* Delete Icon */}
                  <button
                    onClick={() => {
                      const newConds = filterConditions.filter(
                        (_, i) => i !== index,
                      );
                      setFilterConditions(newConds);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "8px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "18px",
                        height: "18px",
                        fill: "none",
                        stroke: "#007bff",
                        strokeWidth: "1.5",
                      }}
                    >
                      <path d="M3 5h14M8 5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M4 5v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5" />
                      <path d="M8 9v6M12 9v6" />
                    </svg>
                  </button>
                </div>
              ))}

              <div
                style={{ marginTop: filterConditions.length > 0 ? "8px" : "0" }}
              >
                <button
                  onClick={() =>
                    setFilterConditions([
                      ...filterConditions,
                      {
                        id: Date.now(),
                        field: "name",
                        operator: "contains",
                        value: "",
                      },
                    ])
                  }
                  style={{
                    background: "#007bff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "20px",
                    padding: "8px 24px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    width: filterConditions.length > 0 ? "auto" : "100%",
                  }}
                >
                  <span style={{ fontSize: "16px", fontWeight: "300" }}>+</span>{" "}
                  Add filter
                </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
                marginTop: "40px",
              }}
            >
              <button
                onClick={() => setShowFilterModal(false)}
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: "20px",
                  padding: "8px 24px",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#6d7175",
                  cursor: "pointer",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => setShowFilterModal(false)}
                style={{
                  background: "#66b2ff",
                  border: "none",
                  borderRadius: "20px",
                  padding: "8px 32px",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Customize Columns Modal ─────────────────────────────── */}
      {showColumnsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowColumnsModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "24px",
              width: "650px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowColumnsModal(false)}
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg
                viewBox="0 0 20 20"
                style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
              >
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2
              style={{
                margin: "0 0 24px",
                fontSize: "16px",
                fontWeight: 600,
                color: "#202223",
              }}
            >
              Customize Columns
            </h2>

            <div style={{ display: "flex", minHeight: "300px" }}>
              {/* Left Side */}
              <div
                style={{
                  flex: 1,
                  borderRight: "1px solid #e1e3e5",
                  paddingRight: "24px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ position: "relative", width: "180px" }}>
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "14px",
                        height: "14px",
                        fill: "none",
                        stroke: "#0066cc",
                        strokeWidth: "1.5",
                        position: "absolute",
                        left: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    >
                      <circle cx="8.5" cy="8.5" r="5" />
                      <path d="M12.5 12.5L16 16" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search"
                      value={colSearch}
                      onChange={(e) => setColSearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 10px 6px 30px",
                        borderRadius: "16px",
                        border: "none",
                        backgroundColor: "#f0f4f9",
                        fontSize: "13px",
                        color: "#0066cc",
                        outline: "none",
                        boxSizing: "border-box",
                        fontWeight: "500",
                      }}
                    />
                  </div>
                  <button
                    onClick={selectAllCols}
                    style={{
                      color: "#0066cc",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    select all
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    overflowY: "auto",
                  }}
                >
                  {tempColumns
                    .filter((c) =>
                      c.label.toLowerCase().includes(colSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <label
                        key={c.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          cursor: c.isRequired ? "default" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={c.isVisible}
                          onChange={() => toggleCol(c.id)}
                          disabled={c.isRequired}
                          style={{
                            accentColor: "#0066cc",
                            width: "16px",
                            height: "16px",
                          }}
                        />
                        <span
                          style={{
                            color: "#0066cc",
                            fontWeight: "500",
                            fontSize: "14px",
                          }}
                        >
                          {c.label}
                        </span>
                      </label>
                    ))}
                </div>
              </div>

              {/* Right Side */}
              <div
                style={{
                  flex: 1,
                  paddingLeft: "24px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                    height: "28px",
                  }}
                >
                  <span style={{ color: "#202223", fontSize: "13px" }}>
                    {tempColumns.filter((c) => c.isVisible).length} columns
                    selected
                  </span>
                  <button
                    onClick={clearAllCols}
                    style={{
                      color: "#0066cc",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    clear all
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    overflowY: "auto",
                  }}
                >
                  {tempColumns
                    .filter((c) => c.isVisible)
                    .map((c) => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, c.id)}
                        onDragOver={(e) => handleDragOver(e, c.id)}
                        onDragEnd={() => setDraggedColId(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "grab",
                          padding: "4px 0",
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
                            viewBox="0 0 20 20"
                            style={{
                              width: "14px",
                              height: "14px",
                              fill: "#8c9196",
                            }}
                          >
                            <path d="M4 6h12v2H4zm0 6h12v2H4z" />
                          </svg>
                          <span style={{ color: "#202223", fontSize: "14px" }}>
                            {c.label}
                          </span>
                        </div>
                        {c.isRequired ? (
                          <svg
                            viewBox="0 0 20 20"
                            style={{
                              width: "16px",
                              height: "16px",
                              fill: "#5c5f62",
                            }}
                          >
                            <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-9.293l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 1 1 1.414-1.414L8 11.586l4.293-4.293a1 1 0 1 1 1.414 1.414z" />
                          </svg>
                        ) : (
                          <button
                            onClick={() => toggleCol(c.id)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{
                                width: "14px",
                                height: "14px",
                                stroke: "#6d7175",
                                strokeWidth: "1.5",
                              }}
                            >
                              <path d="M5 5L15 15M15 5L5 15" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
                marginTop: "32px",
              }}
            >
              <button
                onClick={() => setShowColumnsModal(false)}
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: "20px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#6d7175",
                  cursor: "pointer",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={saveColumns}
                style={{
                  background: "#0066cc",
                  border: "none",
                  borderRadius: "20px",
                  padding: "8px 24px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ──────────────────────────────────── */}
      {groupToDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setGroupToDelete(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "24px",
              width: "400px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "#202223",
                  margin: 0,
                }}
              >
                Delete filter group?
              </h2>
              <button
                onClick={() => setGroupToDelete(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6d7175",
                  padding: "4px",
                }}
              >
                ✕
              </button>
            </div>

            <p
              style={{
                margin: "0 0 24px",
                fontSize: "14px",
                color: "#6d7175",
                lineHeight: "1.4",
              }}
            >
              Are you sure you want to delete this filter group? This action
              cannot be undone and these filters will no longer be visible on
              your store.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              <button
                onClick={() => setGroupToDelete(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  border: "1px solid #c9cccf",
                  background: "#fff",
                  color: "#202223",
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
                  padding: "8px 16px",
                  borderRadius: "4px",
                  border: "none",
                  background: "#d82c0d",
                  color: "#fff",
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
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
