import { useEffect, useState, useRef } from "react";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  Link,
  data,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { CreateFilterModal } from "../components/ui/CreateFilterModal";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { SearchInput } from "../components/ui/SearchInput";
import { AdvancedFilterBuilder } from "../components/ui/AdvancedFilterBuilder";

// ── Available filter types for "Add Filter" modal ─────────────────────
const FILTER_TYPE_OPTIONS = [
  { value: "price", label: "Price", icon: "$" },
  { value: "vendor", label: "Brand / Vendor", icon: "B" },
  { value: "product_type", label: "Product Type", icon: "T" },
  { value: "collection", label: "Collection", icon: "C" },
  { value: "option", label: "Product Option", icon: "O" },
  { value: "metafield", label: "Metafield", icon: "M" },
];

const DISPLAY_MODES = [
  { value: "list", label: "List (Checkboxes)" },
  { value: "range", label: "Range (Price Slider)" },
  { value: "swatch", label: "Color Swatch" },
  { value: "button", label: "Button / Chip" },
  { value: "dropdown", label: "Dropdown Select" },
];

// ── Loader ───────────────────────────────────────────────────────────
export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;

  const group = await prisma.filterGroup.findFirst({
    where: { id, shop },
    include: {
      collections: true,
      filters: { orderBy: { order: "asc" } },
    },
  });

  if (!group) {
    throw data({ message: "Filter group not found" }, { status: 404 });
  }

  // Get detected product option names for the add filter modal
  const products = await prisma.product.findMany({
    where: { shop },
    select: { options: true },
  });
  const optionNames = new Set();
  for (const p of products) {
    for (const opt of p.options || []) {
      if (opt.name) optionNames.add(opt.name);
    }
  }

  let shopifyCollections = [];
  let shopifyLocations = [];
  try {
    const graphqlQuery = await admin.graphql(`
      #graphql
      query {
        collections(first: 50, query: "published_status:published") {
          nodes {
            title
          }
        }
        locations(first: 250, includeInactive: true) {
          nodes {
            id
            name
            inventoryLevels(first: 250) {
              nodes {
                id
              }
            }
          }
        }
        shop {
          fulfillmentServices {
            location {
              id
              name
              inventoryLevels(first: 250) {
                nodes {
                  id
                }
              }
            }
          }
        }
      }
    `);
    const graphqlData = await graphqlQuery.json();
    shopifyCollections =
      graphqlData?.data?.collections?.nodes?.map((c) => c.title).sort() || [];

    const allLocsMap = new Map();
    // Add regular locations
    graphqlData?.data?.locations?.nodes?.forEach((l) => {
      allLocsMap.set(l.id, {
        value: l.name,
        id: l.id,
        count: l.inventoryLevels?.nodes?.length || 0,
      });
    });
    // Add fulfillment service locations
    graphqlData?.data?.shop?.fulfillmentServices?.forEach((fs) => {
      if (fs.location) {
        const l = fs.location;
        allLocsMap.set(l.id, {
          value: l.name,
          id: l.id,
          count: l.inventoryLevels?.nodes?.length || 0,
        });
      }
    });

    shopifyLocations = Array.from(allLocsMap.values());
  } catch (err) {
    console.error("Error fetching collections or locations:", err);
  }

  // Fetch unique vendors and product types with counts
  const vendors = await prisma.product.groupBy({
    by: ["vendor"],
    where: { shop, vendor: { not: "" } },
    _count: { vendor: true },
  });

  const productTypes = await prisma.product.groupBy({
    by: ["productType"],
    where: { shop, productType: { not: "" } },
    _count: { productType: true },
  });

  const allProducts = await prisma.product.findMany({
    where: { shop },
    select: {
      tags: true,
      options: true,
      variants: { select: { available: true, inventory: true } },
    },
  });

  const tagsMap = new Map();
  const optionsMap = new Map();

  let stockOnHandCount = 0;
  let preOrderCount = 0;
  let inStockCount = 0;
  let outOfStockCount = 0;

  for (const p of allProducts) {
    // Process tags
    for (const t of p.tags || []) {
      if (t) tagsMap.set(t, (tagsMap.get(t) || 0) + 1);
    }
    // Process options
    if (p.options && Array.isArray(p.options)) {
      for (const opt of p.options) {
        if (opt.name && opt.values) {
          const optNameLower = opt.name.toLowerCase();
          if (!optionsMap.has(optNameLower))
            optionsMap.set(optNameLower, new Map());
          const valMap = optionsMap.get(optNameLower);
          for (const v of opt.values) {
            valMap.set(v, (valMap.get(v) || 0) + 1);
          }
        }
      }
    }

    // Process stock status counts
    if (p.variants && p.variants.length > 0) {
      const hasStock = p.variants.some((v) => v.inventory > 0);
      const isPreOrder = p.variants.some(
        (v) => v.available && v.inventory <= 0,
      );
      const isAvailable = p.variants.some((v) => v.available);

      if (hasStock) stockOnHandCount++;
      if (isPreOrder) preOrderCount++;
      if (isAvailable) inStockCount++;
      if (!isAvailable) outOfStockCount++;
    }
  }

  const storeData = {
    totalProducts: allProducts.length,
    stockStatusCounts: {
      inStock: inStockCount,
      stockOnHand: stockOnHandCount,
      preOrder: preOrderCount,
      outOfStock: outOfStockCount,
    },
    vendors: vendors
      .map((v) => ({ value: v.vendor, count: v._count.vendor }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    productTypes: productTypes
      .map((p) => ({ value: p.productType, count: p._count.productType }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    tags: Array.from(tagsMap.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    locations: shopifyLocations,
    options: Array.from(optionsMap.entries()).reduce((acc, [name, valMap]) => {
      acc[name] = Array.from(valMap.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value));
      return acc;
    }, {}),
  };

  return {
    group,
    detectedOptions: Array.from(optionNames).sort(),
    shopifyCollections,
    storeData,
  };
};

// ── Action ───────────────────────────────────────────────────────────
export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id: filterGroupId } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Verify group belongs to shop
  const group = await prisma.filterGroup.findFirst({
    where: { id: filterGroupId, shop },
  });
  if (!group)
    return data({ success: false, error: "Not found" }, { status: 404 });

  if (intent === "updateGroupSettings") {
    const name = formData.get("name");
    const groupType = formData.get("groupType");
    const selectedCollections = JSON.parse(
      formData.get("selectedCollections") || "[]",
    );

    const existingGroup = await prisma.filterGroup.findFirst({
      where: {
        shop,
        name: { equals: name, mode: "insensitive" },
        id: { not: filterGroupId },
      },
    });

    if (existingGroup) {
      return {
        success: false,
        error: "A filter group with this name already exists.",
        intent,
      };
    }

    // Update the basic info
    await prisma.filterGroup.update({
      where: { id: filterGroupId },
      data: { name },
    });

    // Delete existing collections for this group
    await prisma.filterGroupCollection.deleteMany({ where: { filterGroupId } });

    // Re-create the collections based on new type
    if (groupType === "collections") {
      if (selectedCollections.length > 0) {
        await prisma.filterGroupCollection.createMany({
          data: selectedCollections.map((c) => ({
            filterGroupId,
            collectionId: c.id,
            collectionTitle: c.title,
            pageType: "collection",
          })),
        });
      } else {
        await prisma.filterGroupCollection.create({
          data: {
            filterGroupId,
            collectionId: "__all__",
            collectionTitle: "All Collections",
            pageType: "collection",
          },
        });
      }
    } else if (groupType === "search") {
      await prisma.filterGroupCollection.create({
        data: {
          filterGroupId,
          collectionId: "search",
          collectionTitle: "Search Page",
          pageType: "search",
        },
      });
    }

    return { success: true, intent };
  }

  if (intent === "addFilter") {
    let filterType = formData.get("filterType");
    let filterKey = formData.get("filterKey") || null;
    const label = formData.get("label");
    const displayMode = formData.get("displayMode") || "list";
    const config = formData.get("config")
      ? JSON.parse(formData.get("config"))
      : undefined;

    // Fix for option types (e.g. "color", "size", "title", "denominations")
    // Storefront expects filterType="option" and filterKey="Color"
    const isDynamicOption = ![
      "collection",
      "vendor",
      "product_type",
      "tags",
      "price",
      "percent_sale",
      "weight",
      "review_rating",
      "stock_status",
      "inventory_locations",
    ].includes(filterType);
    if (isDynamicOption) {
      filterKey = label; // The user's label becomes the key (e.g., "Color")
      filterType = "option";
    }

    const lastFilter = await prisma.filterGroupItem.findFirst({
      where: { filterGroupId },
      orderBy: { order: "desc" },
    });
    const nextOrder = (lastFilter?.order ?? -1) + 1;

    await prisma.filterGroupItem.create({
      data: {
        filterGroupId,
        filterType,
        filterKey,
        label,
        displayMode,
        isEnabled: true,
        order: nextOrder,
        ...(config !== undefined ? { config } : {}),
      },
    });
    return { success: true, intent };
  }

  if (intent === "updateFilter") {
    const filterId = formData.get("filterId");
    const label = formData.get("label");
    const displayMode = formData.get("displayMode");
    const config = formData.get("config")
      ? JSON.parse(formData.get("config"))
      : undefined;

    await prisma.filterGroupItem.update({
      where: { id: filterId },
      data: {
        label,
        displayMode,
        ...(config !== undefined ? { config } : {}),
      },
    });
    return { success: true, intent };
  }

  if (intent === "toggleFilter") {
    const filterId = formData.get("filterId");
    const current = await prisma.filterGroupItem.findUnique({
      where: { id: filterId },
      select: { isEnabled: true, label: true },
    });
    if (!current)
      return data(
        { success: false, error: "Filter not found" },
        { status: 404 },
      );

    const newStatus = !current.isEnabled;
    await prisma.filterGroupItem.update({
      where: { id: filterId },
      data: { isEnabled: newStatus },
    });

    return {
      success: true,
      intent,
      isEnabled: newStatus,
      label: current.label,
    };
  }

  if (intent === "deleteFilter") {
    const filterId = formData.get("filterId");
    await prisma.filterGroupItem.delete({ where: { id: filterId } });
    return { success: true, intent };
  }

  if (intent === "duplicateFilter") {
    const filterId = formData.get("filterId");
    const source = await prisma.filterGroupItem.findUnique({
      where: { id: filterId },
    });
    if (!source) return { success: false };

    const lastFilter = await prisma.filterGroupItem.findFirst({
      where: { filterGroupId },
      orderBy: { order: "desc" },
    });
    await prisma.filterGroupItem.create({
      data: {
        filterGroupId,
        filterType: source.filterType,
        filterKey: source.filterKey,
        label: `${source.label} (Copy)`,
        displayMode: source.displayMode,
        isEnabled: source.isEnabled,
        order: (lastFilter?.order ?? -1) + 1,
        config: source.config,
      },
    });
    return { success: true, intent };
  }

  if (intent === "reorderFilters") {
    const orderedIds = JSON.parse(formData.get("orderedIds"));
    await prisma.$transaction(
      orderedIds.map((filterId, index) =>
        prisma.filterGroupItem.update({
          where: { id: filterId },
          data: { order: index },
        }),
      ),
    );
    return { success: true, intent };
  }

  return { success: false };
};

// ── Helper ────────────────────────────────────────────────────────────
function getFilterTypeLabel(type, key) {
  const found = FILTER_TYPE_OPTIONS.find((o) => o.value === type);
  if (type === "option") return `${key || "Option"} (option)`;
  if (type === "metafield") return `Metafield: ${key || ""}`;
  return found?.label || type;
}

function DisplayModeBadge({ mode }) {
  const colors = {
    list: { bg: "#e4e5e7", text: "#202223" },
    range: { bg: "#d1e9ff", text: "#0050b3" },
    swatch: { bg: "#ffe4d6", text: "#8a2b06" },
    button: { bg: "#e3f5e0", text: "#1a6130" },
    dropdown: { bg: "#f3ebf9", text: "#4b1277" },
  };
  const c = colors[mode] || colors.list;
  const label =
    DISPLAY_MODES.find((d) => d.value === mode)?.label.split(" ")[0] || mode;
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: "4px",
        backgroundColor: c.bg,
        color: c.text,
        fontSize: "12px",
        fontWeight: "600",
      }}
    >
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────
export default function FilterGroupDetail() {
  const { group, detectedOptions, shopifyCollections, storeData } =
    useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [groupName, setGroupName] = useState(group.name);

  // -- Group Settings State --
  const initialGroupType = group.collections.some(
    (c) => c.pageType === "search",
  )
    ? "search"
    : "collections";
  const initialSelectedColls = group.collections
    .filter((c) => c.pageType === "collection" && c.collectionId !== "__all__")
    .map((c) => ({ id: c.collectionId, title: c.collectionTitle }));

  const [groupType, setGroupType] = useState(initialGroupType);
  const [selectedColls, setSelectedColls] = useState(initialSelectedColls);
  const [showCollDropdown, setShowCollDropdown] = useState(false);
  const [searchColl, setSearchColl] = useState("");
  const filteredCollections = shopifyCollections.filter((c) =>
    c.toLowerCase().includes(searchColl.toLowerCase()),
  );

  const handleToggleCollection = (title) => {
    // Generate a pseudo-ID like shopify uses (or just use title)
    const id = `gid://shopify/Collection/${title}`;
    setSelectedColls((prev) =>
      prev.find((c) => c.title === title)
        ? prev.filter((c) => c.title !== title)
        : [...prev, { id, title }],
    );
  };
  // --------------------------

  const [showAddFilter, setShowAddFilter] = useState(false);
  const [addType, setAddType] = useState("vendor");
  const [addKey, setAddKey] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addDisplayMode, setAddDisplayMode] = useState("list");

  const [configFilter, setConfigFilter] = useState(null);
  const [configLabel, setConfigLabel] = useState("");
  const [configDisplayMode, setConfigDisplayMode] = useState("list");
  const [configSortBy, setConfigSortBy] = useState("count");
  const [configLimit, setConfigLimit] = useState(0);
  const [configShowSearch, setConfigShowSearch] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingFilterData, setEditingFilterData] = useState(null);

  // Toolbar State
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatusView, setFilterStatusView] = useState("all"); // 'all', 'active', 'inactive'
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);
  const [isAdvancedFilterOpen, setIsAdvancedFilterOpen] = useState(false);
  const [advancedConditions, setAdvancedConditions] = useState([]);
  const [advancedMatchType, setAdvancedMatchType] = useState("all");
  const dropdownRef = useRef(null);

  // Column Customization State
  const ALL_COLUMNS = [
    { id: "title", label: "Filter title", locked: true },
    { id: "displayMode", label: "Display mode", locked: true },
    { id: "values", label: "Filter values", locked: true },
    { id: "status", label: "Status", locked: false },
    { id: "action", label: "Action", locked: false },
  ];
  const [tableColumns, setTableColumns] = useState(
    ALL_COLUMNS.map((c) => c.id),
  );
  const [tempTableColumns, setTempTableColumns] = useState([...tableColumns]);
  const [columnsSearch, setColumnsSearch] = useState("");
  const [draggedColumnIdx, setDraggedColumnIdx] = useState(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsViewDropdownOpen(false);
      }
      if (!event.target.closest('.filter-dropdown-inside')) {
        setShowCollDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        if (actionData.intent === "toggleFilter") {
          shopify.toast.show(
            `${actionData.label ?? "Filter"} ${actionData.isEnabled ? "enabled" : "disabled"}`,
          );
        } else if (actionData.intent === "updateGroupSettings") {
          shopify.toast.show("Group settings saved successfully");
        } else if (actionData.intent === "addFilter") {
          shopify.toast.show("Filter added successfully");
        } else if (actionData.intent === "updateFilter") {
          shopify.toast.show("Filter updated successfully");
        } else if (actionData.intent === "deleteFilter") {
          shopify.toast.show("Filter deleted successfully");
        } else if (actionData.intent === "duplicateFilter") {
          shopify.toast.show("Filter duplicated successfully");
        } else if (actionData.intent === "reorderFilters") {
          shopify.toast.show("Filters reordered successfully");
        }
      } else if (actionData.error) {
        shopify.toast.show(actionData.error, { isError: true });
      }
    }
  }, [actionData, shopify]);

  const openConfigModal = (filter) => {
    let parsedConfig = {};
    try {
      if (filter.config)
        parsedConfig =
          typeof filter.config === "string"
            ? JSON.parse(filter.config)
            : filter.config;
    } catch (e) {}

    setEditingFilterData({
      id: filter.id,
      optionType:
        filter.filterType === "option"
          ? filter.filterKey
            ? filter.filterKey.toLowerCase()
            : "option"
          : filter.filterType,
      filterTitle: filter.label,
      prefix: parsedConfig.prefix || "",
      navCollections: parsedConfig.navCollections || false,
      childType: parsedConfig.childType || "Select child type",
      mainCollections: parsedConfig.mainCollections || [
        { id: Date.now(), collection: "" },
      ],
      keepMainCollectionsUnchanged:
        parsedConfig.keepMainCollectionsUnchanged || false,
      multipleSelection: parsedConfig.multipleSelection || false,
      narrowDown: parsedConfig.narrowDown || false,
      useManualValues: parsedConfig.useManualValues || false,
      excludedValues: parsedConfig.excludedValues || [],
      manualValues: parsedConfig.manualValues || [],
      sortManualValues: parsedConfig.sortManualValues || false,
      advanced: parsedConfig.advanced || {},
      displayMode: filter.displayMode || "List",
      priceRanges: parsedConfig.priceRanges,
      saleRanges: parsedConfig.saleRanges,
      weightRanges: parsedConfig.weightRanges,
      reviewRanges: parsedConfig.reviewRanges,
      stockStatusConfig: parsedConfig.stockStatusConfig,
      ratingColor: parsedConfig.ratingColor,
      sliderConfig: parsedConfig.sliderConfig,
      swatchConfig: parsedConfig.swatchConfig,
    });
    setIsCreateModalOpen(true);
  };

  const handleSaveFilterModal = (data) => {
    const {
      filterId,
      optionType,
      prefix,
      filterTitle,
      navCollections,
      childType,
      mainCollections,
      keepMainCollectionsUnchanged,
      multipleSelection,
      narrowDown,
      useManualValues,
      excludedValues,
      manualValues,
      sortManualValues,
      advanced,
      displayMode,
      priceRanges,
      saleRanges,
      weightRanges,
      reviewRanges,
      stockStatusConfig,
      ratingColor,
      sliderConfig,
      swatchConfig,
    } = data;

    if (!filterTitle || filterTitle.trim() === "") {
      shopify.toast.show("Filter title is required");
      return;
    }

    submit(
      {
        intent: filterId ? "updateFilter" : "addFilter",
        filterId: filterId || "",
        filterType: optionType,
        filterKey: "",
        label: filterTitle,
        displayMode: displayMode || "List",
        config: JSON.stringify({
          prefix,
          navCollections,
          childType,
          mainCollections,
          keepMainCollectionsUnchanged,
          multipleSelection,
          narrowDown,
          useManualValues,
          excludedValues,
          manualValues,
          sortManualValues,
          advanced,
          priceRanges,
          saleRanges,
          weightRanges,
          reviewRanges,
          stockStatusConfig,
          ratingColor,
          sliderConfig,
          swatchConfig,
        }),
      },
      { method: "POST" },
    );
    setIsCreateModalOpen(false);
    setEditingFilterData(null);
  };

  const handleUpdateGroupSettings = () => {
    if (!groupName.trim()) return;
    submit(
      {
        intent: "updateGroupSettings",
        name: groupName,
        groupType,
        selectedCollections: JSON.stringify(selectedColls),
      },
      { method: "POST" },
    );
    shopify.toast.show("Group updated");
  };

  return (
    <s-page>
      <ui-title-bar title={group.name}></ui-title-bar>
      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
        }}
      >
        <Link
          to="/app/filters/groups"
          style={{
            color: "#006e52",
            textDecoration: "underline",
            fontWeight: "500",
          }}
        >
          Filter groups
        </Link>
        <span style={{ color: "#6d7175" }}>›</span>
        <span style={{ color: "#202223", fontWeight: "600" }}>
          {group.name}
        </span>
      </div>

      <s-stack direction="block" gap="base">
        <s-card heading="Filter group information">
          <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "#6d7175",
                }}
              >
                Name{" "}
                <span
                  style={{
                    color: "#8c9196",
                    fontWeight: "normal",
                    fontSize: "11px",
                    cursor: "help",
                  }}
                  title="The name of this filter group"
                >
                  ?
                </span>
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
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

              {/* Editable Group Type & Collections */}
              {!group.isDefault && (
                <div
                  style={{
                    marginTop: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {/* For collection pages */}
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
                      style={{
                        cursor: "pointer",
                        width: "16px",
                        height: "16px",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "14px",
                        color: "#202223",
                        fontWeight: groupType === "collections" ? "600" : "400",
                      }}
                    >
                      For collection pages
                    </span>
                  </label>

                  {groupType === "collections" && (
                    <div
                      style={{
                        marginLeft: "26px",
                        position: "relative",
                        marginBottom: "10px",
                      }}
                      className="filter-dropdown-inside"
                    >
                      <s-text
                        variant="bodySm"
                        tone="subdued"
                        style={{ display: "block", marginBottom: "6px" }}
                      >
                        Select collections using this filter group
                      </s-text>
                      <div
                        onClick={() => setShowCollDropdown(!showCollDropdown)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #c9cccf",
                          fontSize: "13px",
                          cursor: "pointer",
                          background: "#f6f6f7",
                          userSelect: "none",
                          minHeight: "40px",
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "6px",
                        }}
                      >
                        {selectedColls.length > 0 ? (
                          selectedColls.map((c) => (
                            <span
                              key={c.id}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: "#007bff",
                                color: "#fff",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "12px",
                                fontWeight: "500",
                                gap: "4px",
                              }}
                            >
                              {c.title}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleCollection(c.title);
                                }}
                                style={{
                                  cursor: "pointer",
                                  marginLeft: "4px",
                                  fontSize: "10px",
                                }}
                              >
                                ✕
                              </span>
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "#8c9196" }}>
                            All collections (no specific selection)
                          </span>
                        )}
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
                          <div
                            style={{
                              padding: "8px",
                              position: "sticky",
                              top: 0,
                              background: "#fff",
                              borderBottom: "1px solid #f1f2f4",
                            }}
                          >
                            <input
                              type="text"
                              placeholder="Search collections..."
                              value={searchColl}
                              onChange={(e) => setSearchColl(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 10px",
                                borderRadius: "4px",
                                border: "1px solid #c9cccf",
                                fontSize: "13px",
                                outline: "none",
                                boxSizing: "border-box",
                              }}
                            />
                          </div>
                          {filteredCollections.map((c) => {
                            const isSelected = selectedColls.some(
                              (sc) => sc.title === c,
                            );
                            return (
                              <div
                                key={c}
                                onClick={() => handleToggleCollection(c)}
                                style={{
                                  padding: "8px 12px",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                  background: isSelected
                                    ? "#f0f4f9"
                                    : "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                />
                                {c}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* For search page */}
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
                      style={{
                        cursor: "pointer",
                        width: "16px",
                        height: "16px",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "14px",
                        color: "#202223",
                        fontWeight: groupType === "search" ? "600" : "400",
                      }}
                    >
                      For search page
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "16px",
              paddingTop: "16px",
              borderTop: "1px solid #f1f2f4",
            }}
          >
            <s-button variant="primary" onClick={handleUpdateGroupSettings}>
              UPDATE
            </s-button>
          </div>
        </s-card>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid #e1e3e5",
            }}
          >
            {/* Left side: Filters heading */}
            <div style={{ width: "120px" }}>
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#202223",
                }}
              >
                Filters
              </span>
            </div>

            {/* Middle: Filter views & Add Filter */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {/* All Filters Dropdown */}
              <div style={{ position: "relative" }} ref={dropdownRef}>
                <button
                  onClick={() => setIsViewDropdownOpen(!isViewDropdownOpen)}
                  style={{
                    background: "#f1f8ff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    color: "#007bff",
                    fontWeight: "600",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                  }}
                >
                  {filterStatusView === "active"
                    ? "Active filters"
                    : filterStatusView === "inactive"
                      ? "Inactive filters"
                      : "All filters"}{" "}
                  ({group.filters.length})
                  <svg
                    viewBox="0 0 20 20"
                    style={{
                      width: "16px",
                      height: "16px",
                      fill: "currentColor",
                    }}
                  >
                    <path d="M10 14a1 1 0 0 1-.707-.293l-4-4a1 1 0 0 1 1.414-1.414L10 11.586l3.293-3.293a1 1 0 0 1 1.414 1.414l-4 4A1 1 0 0 1 10 14z" />
                  </svg>
                </button>
                {isViewDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: "8px",
                      background: "#fff",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      border: "1px solid #e1e3e5",
                      width: "200px",
                      zIndex: 10,
                      padding: "8px 0",
                    }}
                  >
                    <button
                      onClick={() => {
                        setFilterStatusView("all");
                        setIsViewDropdownOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 16px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      All filters
                    </button>
                    <button
                      onClick={() => {
                        setFilterStatusView("active");
                        setIsViewDropdownOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 16px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Active filters
                    </button>
                    <button
                      onClick={() => {
                        setFilterStatusView("inactive");
                        setIsViewDropdownOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 16px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Inactive filters
                    </button>
                  </div>
                )}
              </div>

              {/* Add Filter Split Button */}
              <div
                style={{
                  display: "flex",
                  borderRadius: "20px",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  style={{
                    background: "#007bff",
                    color: "#fff",
                    border: "none",
                    padding: "8px 16px",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  Add filter
                </button>
                <div
                  style={{
                    width: "1px",
                    background: "rgba(255,255,255,0.3)",
                    backgroundColor: "#007bff",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: "1px",
                      background: "rgba(255,255,255,0.3)",
                    }}
                  ></div>
                </div>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  style={{
                    background: "#007bff",
                    color: "#fff",
                    border: "none",
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <svg
                    viewBox="0 0 20 20"
                    style={{
                      width: "16px",
                      height: "16px",
                      fill: "currentColor",
                    }}
                  >
                    <path d="M10 14a1 1 0 0 1-.707-.293l-4-4a1 1 0 0 1 1.414-1.414L10 11.586l3.293-3.293a1 1 0 0 1 1.414 1.414l-4 4A1 1 0 0 1 10 14z" />
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ flex: 1 }}></div>

            {/* Right side: Search and Icons */}
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {/* Search Bar */}
              <div style={{ position: "relative" }}>
                <svg
                  viewBox="0 0 20 20"
                  style={{
                    width: "16px",
                    height: "16px",
                    fill: "#007bff",
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                >
                  <path d="M8 2a6 6 0 1 0 4.243 10.243l4.05 4.05a1 1 0 0 0 1.414-1.414l-4.05-4.05A6 6 0 0 0 8 2zM4 8a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  style={{
                    background: "#f1f8ff",
                    border: "none",
                    padding: "8px 16px 8px 36px",
                    borderRadius: "20px",
                    fontSize: "14px",
                    color: "#007bff",
                    width: "200px",
                    outline: "none",
                  }}
                />
              </div>

              {/* Icons */}
              <button
                onClick={() => setIsCustomizeColumnsOpen(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  color: "#007bff",
                  display: "flex",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "20px",
                    height: "20px",
                    fill: "currentColor",
                  }}
                >
                  <path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19.33 13.04l2.12.88a1 1 0 0 1 .53 1.28l-1.5 3.62a1 1 0 0 1-1.28.53l-2.12-.88a7.073 7.073 0 0 1-2.14 1.26l-.33 2.27a1 1 0 0 1-.99.85h-3.88a1 1 0 0 1-.99-.85l-.33-2.27a7.073 7.073 0 0 1-2.14-1.26l-2.12.88a1 1 0 0 1-1.28-.53l-1.5-3.62a1 1 0 0 1 .53-1.28l2.12-.88c-.06-.41-.11-.83-.11-1.26s.05-.85.11-1.26l-2.12-.88a1 1 0 0 1-.53-1.28l1.5-3.62a1 1 0 0 1 1.28-.53l2.12.88c.63-.53 1.34-.97 2.14-1.26l.33-2.27a1 1 0 0 1 .99-.85h3.88a1 1 0 0 1 .99.85l.33 2.27c.8.29 1.51.73 2.14 1.26l2.12-.88a1 1 0 0 1 1.28.53l1.5 3.62a1 1 0 0 1-.53 1.28l-2.12.88c.06.41.11.83.11 1.26s-.05.85-.11 1.26z" />
                </svg>
              </button>
              <button
                onClick={() => setIsAdvancedFilterOpen(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  color: "#007bff",
                  display: "flex",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "20px",
                    height: "20px",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <line x1="4" y1="21" x2="4" y2="14"></line>
                  <line x1="4" y1="10" x2="4" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12" y2="3"></line>
                  <line x1="20" y1="21" x2="20" y2="16"></line>
                  <line x1="20" y1="12" x2="20" y2="3"></line>
                  <line x1="1" y1="14" x2="7" y2="14"></line>
                  <line x1="9" y1="8" x2="15" y2="8"></line>
                  <line x1="17" y1="16" x2="23" y2="16"></line>
                </svg>
              </button>
            </div>
          </div>

          {group.filters.length === 0 ? (
            <div
              style={{
                padding: "40px 16px",
                textAlign: "center",
                color: "#6d7175",
              }}
            >
              <svg
                viewBox="0 0 20 20"
                style={{
                  width: "32px",
                  height: "32px",
                  fill: "#c9cccf",
                  marginBottom: "12px",
                }}
              >
                <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
              </svg>
              <p style={{ margin: "0 0 16px", fontSize: "14px" }}>
                No filters yet. Add your first filter.
              </p>
              <s-button onClick={() => setIsCreateModalOpen(true)}>
                Add filter
              </s-button>
            </div>
          ) : (
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
                    background: "#fafafa",
                    borderBottom: "1px solid #e1e3e5",
                  }}
                >
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                      width: "32px",
                    }}
                  ></th>
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                    }}
                  >
                    Filter title
                  </th>
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                    }}
                  >
                    Display mode
                  </th>
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                    }}
                  >
                    Filter values
                  </th>
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      padding: "10px 16px",
                      fontWeight: "600",
                      fontSize: "12px",
                      color: "#6d7175",
                      textAlign: "right",
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.filters
                  .filter((filter) => {
                    if (filterStatusView === "active") return filter.isEnabled;
                    if (filterStatusView === "inactive")
                      return !filter.isEnabled;
                    return true;
                  })
                  .filter((filter) =>
                    filter.label
                      .toLowerCase()
                      .includes(filterSearch.toLowerCase()),
                  )
                  .filter((filter) => {
                    if (advancedConditions.length === 0) return true;

                    const passesCondition = (c) => {
                      const val = filter[c.field];
                      const target = c.value;

                      if (c.operator === "equals") return val === target;
                      if (c.operator === "doesNotEqual") return val !== target;

                      if (typeof val === "string") {
                        const sVal = val.toLowerCase();
                        const sTarget = String(target).toLowerCase();
                        if (c.operator === "contains")
                          return sVal.includes(sTarget);
                        if (c.operator === "doesNotContain")
                          return !sVal.includes(sTarget);
                        if (c.operator === "startsWith")
                          return sVal.startsWith(sTarget);
                        if (c.operator === "endsWith")
                          return sVal.endsWith(sTarget);
                      }
                      return false;
                    };

                    if (advancedMatchType === "all") {
                      return advancedConditions.every(passesCondition);
                    } else {
                      return advancedConditions.some(passesCondition);
                    }
                  })
                  .map((filter) => (
                    <tr
                      key={filter.id}
                      style={{ borderBottom: "1px solid #f1f2f4" }}
                    >
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "#c9cccf",
                          cursor: "grab",
                          textAlign: "center",
                        }}
                      >
                        <svg
                          viewBox="0 0 20 20"
                          style={{
                            width: "16px",
                            height: "16px",
                            fill: "#c9cccf",
                          }}
                        >
                          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                        </svg>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <button
                          onClick={() => openConfigModal(filter)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#000",
                            fontSize: "14px",
                            fontWeight: "400",
                            cursor: "pointer",
                            padding: 0,
                            textAlign: "left",
                          }}
                        >
                          {filter.label}
                          {filter.filterType === "option" && (
                            <span style={{ color: "#a1a5a8", fontWeight: "normal", marginLeft: "4px" }}>
                              (option)
                            </span>
                          )}
                        </button>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <DisplayModeBadge mode={filter.displayMode} />
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: "13px",
                          color: "#6d7175",
                        }}
                      >
                        All values
                      </td>
                      <td style={{ padding: "14px 16px" }}>
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
                            checked={filter.isEnabled}
                            onChange={() =>
                              submit(
                                { intent: "toggleFilter", filterId: filter.id },
                                { method: "POST" },
                              )
                            }
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              inset: 0,
                              backgroundColor: filter.isEnabled
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
                                left: filter.isEnabled ? "20px" : "4px",
                                bottom: "3px",
                                backgroundColor: "white",
                                transition: "0.2s",
                                borderRadius: "50%",
                              }}
                            />
                          </span>
                        </label>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            justifyContent: "flex-end",
                            alignItems: "center",
                          }}
                        >
                          <button
                            onClick={() => openConfigModal(filter)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Configure"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{
                                width: "16px",
                                height: "16px",
                                fill: "#5c5f62",
                              }}
                            >
                              <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828z" />
                              <path d="M3 16h14v2H3v-2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() =>
                              submit(
                                {
                                  intent: "duplicateFilter",
                                  filterId: filter.id,
                                },
                                { method: "POST" },
                              )
                            }
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
                              <path d="M14 6h-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-8 6V4h6v2H8a2 2 0 0 0-2 2v4H6zm8 4H8V8h6v8z" />
                            </svg>
                          </button>
                          <button
                            onClick={() =>
                              submit(
                                { intent: "deleteFilter", filterId: filter.id },
                                { method: "POST" },
                              )
                            }
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
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </s-stack>

      {showAddFilter && (
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
            if (e.target === e.currentTarget) setShowAddFilter(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "32px",
              width: "480px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowAddFilter(false)}
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
              Add Filter
            </h2>

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "#6d7175",
                }}
              >
                Filter Type
              </label>
              <select
                value={addType}
                onChange={(e) => handleAddTypeChange(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  fontSize: "14px",
                }}
              >
                {FILTER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {addType === "option" && (
              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    marginBottom: "8px",
                    fontSize: "13px",
                    color: "#6d7175",
                  }}
                >
                  Option Name
                </label>
                {detectedOptions.length > 0 ? (
                  <select
                    value={addKey}
                    onChange={(e) => handleAddKeyChange(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                    }}
                  >
                    <option value="">-- Select option --</option>
                    {detectedOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    <option value="__custom">Type custom name...</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. Color"
                    value={addKey}
                    onChange={(e) => handleAddKeyChange(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                )}
                {addKey === "__custom" && (
                  <input
                    type="text"
                    placeholder="Type option name (e.g. Material)"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      marginTop: "8px",
                      borderRadius: "8px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                    onChange={(e) => handleAddKeyChange(e.target.value)}
                  />
                )}
              </div>
            )}

            {addType === "metafield" && (
              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    marginBottom: "8px",
                    fontSize: "13px",
                    color: "#6d7175",
                  }}
                >
                  Metafield Key (namespace.key)
                </label>
                <input
                  type="text"
                  placeholder="e.g. custom.material"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #c9cccf",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "#6d7175",
                }}
              >
                Display Label
              </label>
              <input
                type="text"
                placeholder="Label shown on storefront"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "#6d7175",
                }}
              >
                Display Mode
              </label>
              <select
                value={addDisplayMode}
                onChange={(e) => setAddDisplayMode(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  fontSize: "14px",
                }}
              >
                {DISPLAY_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <s-button onClick={() => setShowAddFilter(false)}>
                Cancel
              </s-button>
              <s-button
                variant="primary"
                onClick={handleAddFilter}
                disabled={!addLabel.trim()}
              >
                Add Filter
              </s-button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={isCustomizeColumnsOpen}
        onClose={() => setIsCustomizeColumnsOpen(false)}
        title="Customize Columns"
        width="700px"
        footer={
          <>
            <Button
              variant="default"
              onClick={() => setIsCustomizeColumnsOpen(false)}
              style={{
                borderRadius: "20px",
                padding: "8px 24px",
                color: "#c4cdd5",
                border: "1px solid #e1e3e5",
              }}
            >
              CANCEL
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setTableColumns(tempTableColumns);
                setIsCustomizeColumnsOpen(false);
              }}
              style={{
                borderRadius: "20px",
                padding: "8px 24px",
                background: "#51a2ff",
                border: "none",
              }}
            >
              OK
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", gap: "40px" }}>
          {/* Left Side */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <SearchInput
                value={columnsSearch}
                onChange={(e) => setColumnsSearch(e.target.value)}
                style={{ width: "200px" }}
              />
              <button
                onClick={() =>
                  setTempTableColumns(ALL_COLUMNS.map((c) => c.id))
                }
                style={{
                  background: "none",
                  border: "none",
                  color: "#007bff",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                select all
              </button>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {ALL_COLUMNS.filter((c) =>
                c.label.toLowerCase().includes(columnsSearch.toLowerCase()),
              ).map((c) => (
                <label
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                    fontSize: "14px",
                    color: "#007bff",
                    fontWeight: 500,
                  }}
                >
                  <Checkbox
                    checked={tempTableColumns.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setTempTableColumns([...tempTableColumns, c.id]);
                      } else {
                        setTempTableColumns(
                          tempTableColumns.filter((id) => id !== c.id),
                        );
                      }
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          {/* Right Side */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <span style={{ fontSize: "14px", color: "#4a4c4e" }}>
                {tempTableColumns.length} columns selected
              </span>
              <button
                onClick={() => setTempTableColumns([])}
                style={{
                  background: "none",
                  border: "none",
                  color: "#007bff",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                clear all
              </button>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              {tempTableColumns.map((colId, index) => {
                const col = ALL_COLUMNS.find((c) => c.id === colId);
                return (
                  <div
                    key={colId}
                    draggable
                    onDragStart={(e) => setDraggedColumnIdx(index)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const newCols = [...tempTableColumns];
                      const [removed] = newCols.splice(draggedColumnIdx, 1);
                      newCols.splice(index, 0, removed);
                      setTempTableColumns(newCols);
                      setDraggedColumnIdx(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      fontSize: "14px",
                      color: "#4a4c4e",
                      cursor: "grab",
                    }}
                  >
                    <span
                      style={{
                        color: "#6d7175",
                        fontSize: "18px",
                        userSelect: "none",
                      }}
                    >
                      =
                    </span>
                    <span style={{ flex: 1 }}>{col.label}</span>
                    {col.locked ? (
                      <svg
                        viewBox="0 0 20 20"
                        style={{
                          width: "16px",
                          height: "16px",
                          fill: "#2c2c2c",
                        }}
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <button
                        onClick={() =>
                          setTempTableColumns(
                            tempTableColumns.filter((id) => id !== colId),
                          )
                        }
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                        }}
                      >
                        <svg
                          viewBox="0 0 20 20"
                          style={{
                            width: "16px",
                            height: "16px",
                            fill: "#8c9196",
                          }}
                        >
                          <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      <AdvancedFilterBuilder
        isOpen={isAdvancedFilterOpen}
        onClose={() => setIsAdvancedFilterOpen(false)}
        initialMatchType={advancedMatchType}
        initialConditions={advancedConditions}
        onApply={(matchType, conditions) => {
          setAdvancedMatchType(matchType);
          setAdvancedConditions(conditions);
          // Optional: Prompt to save view in db here if user wants a saved view feature.
        }}
      />
      <CreateFilterModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingFilterData(null);
        }}
        onSave={handleSaveFilterModal}
        initialData={editingFilterData}
        shopifyCollections={shopifyCollections}
        storeData={storeData}
      />
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
