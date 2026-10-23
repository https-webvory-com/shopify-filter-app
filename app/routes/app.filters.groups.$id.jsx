import { useEffect, useState, useRef } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useActionData,
  useLoaderData,
  useSubmit,
  Link,
  data,
  useNavigation,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { invalidateShop } from "../services/shopCache.server";
import { normalizeProductTitleFilter } from "../utils/productTitleFilter.js";
import { useAppBridge } from "@shopify/app-bridge-react";
import { CreateFilterModal } from "../components/ui/CreateFilterModal";
import { ExportFilterItemsModal } from "../components/ui/ExportFilterItemsModal";
import { ImportFilterItemsModal } from "../components/ui/ImportFilterItemsModal";
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
  { value: "tag", label: "Tag", icon: "#" },
];

const DISPLAY_MODES = [
  { value: "list", label: "List (Checkboxes)" },
  { value: "range", label: "Range (Price Slider)" },
  { value: "swatch", label: "Swatch (Color)" },
  { value: "button", label: "Button / Chip" },
  { value: "dropdown", label: "Dropdown Select" },
  { value: "box", label: "Box" },
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

  // Option names will be derived from the fast options SQL below

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

  // 1. Tags
  const tagsRaw = await prisma.$queryRaw`
    SELECT tag as value, count(*)::int as count 
    FROM "Product", unnest(tags) as tag
    WHERE shop = ${shop} 
    GROUP BY tag
  `;

  // 2. Options (value counts)
  const optionsRaw = await prisma.$queryRaw`
    SELECT 
      el->>'name' as name, 
      jsonb_array_elements_text(el->'values') as value, 
      count(*)::int as count 
    FROM "Product", 
    jsonb_array_elements(options) as el 
    WHERE shop = ${shop} AND options IS NOT NULL AND options::text != 'null' AND options::text != '[]'
    GROUP BY 1, 2
  `;

  // 3. Titles
  const titlesRaw = await prisma.$queryRaw`
    SELECT title as value, count(*)::int as count 
    FROM "Product" 
    WHERE shop = ${shop} AND title IS NOT NULL AND title != ''
    GROUP BY title
  `;

  // 4. Stock statuses
  const stockRaw = await prisma.$queryRaw`
    SELECT 
      SUM(CASE WHEN has_stock THEN 1 ELSE 0 END)::int as "stockOnHandCount",
      SUM(CASE WHEN is_preorder THEN 1 ELSE 0 END)::int as "preOrderCount",
      SUM(CASE WHEN is_available THEN 1 ELSE 0 END)::int as "inStockCount",
      SUM(CASE WHEN NOT is_available THEN 1 ELSE 0 END)::int as "outOfStockCount",
      COUNT(*)::int as "totalProducts"
    FROM (
      SELECT 
        p.id,
        bool_or(v.inventory > 0) as has_stock,
        bool_or(v.available AND v.inventory <= 0) as is_preorder,
        bool_or(v.available) as is_available
      FROM "Product" p
      LEFT JOIN "Variant" v ON v."productId" = p.id
      WHERE p.shop = ${shop}
      GROUP BY p.id
    ) as p_agg
  `;

  const optionNamesSet = new Set();
  const optionsObj = {};
  for (const row of optionsRaw) {
    if (row.name) {
      optionNamesSet.add(row.name);
      if (!optionsObj[row.name]) optionsObj[row.name] = [];
      if (row.value) optionsObj[row.name].push({ value: row.value, count: Number(row.count) });
    }
  }

  for (const key in optionsObj) {
    optionsObj[key].sort((a, b) => a.value.localeCompare(b.value));
  }

  const storeData = {
    totalProducts: Number(stockRaw[0]?.totalProducts || 0),
    stockStatusCounts: {
      inStock: Number(stockRaw[0]?.inStockCount || 0),
      stockOnHand: Number(stockRaw[0]?.stockOnHandCount || 0),
      preOrder: Number(stockRaw[0]?.preOrderCount || 0),
      outOfStock: Number(stockRaw[0]?.outOfStockCount || 0),
    },
    vendors: vendors
      .map((v) => ({ value: v.vendor, count: v._count.vendor }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    productTypes: productTypes
      .map((p) => ({ value: p.productType, count: p._count.productType }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    tags: tagsRaw.map(t => ({ value: t.value, count: Number(t.count) })).sort((a, b) => a.value.localeCompare(b.value)),
    titles: titlesRaw.map(t => ({ value: t.value, count: Number(t.count) })).sort((a, b) => a.value.localeCompare(b.value)),
    locations: shopifyLocations,
    options: optionsObj,
  };

  return {
    group,
    detectedOptions: Array.from(optionNamesSet).sort(),
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

  if (intent === "importFilters") {
    const filtersData = JSON.parse(formData.get("filters") || "[]");
    
    // Process imports
    for (const importedFilter of filtersData) {
      const filter = normalizeProductTitleFilter(importedFilter);
      let existingFilter = null;
      if (filter.id) {
        existingFilter = await prisma.filterGroupItem.findFirst({
          where: { filterGroupId, id: filter.id }
        });
      }
      
      if (!existingFilter) {
        existingFilter = await prisma.filterGroupItem.findFirst({
          where: { 
            filterGroupId, 
            filterType: filter.filterType, 
            ...(filter.filterKey ? { filterKey: filter.filterKey } : { label: filter.label })
          }
        });
      }
      
      if (existingFilter) {
        await prisma.filterGroupItem.update({
          where: { id: existingFilter.id },
          data: {
            label: filter.label,
            filterType: filter.filterType,
            filterKey: filter.filterKey,
            displayMode: filter.displayMode,
            isEnabled: filter.isEnabled,
            order: filter.order !== undefined ? filter.order : existingFilter.order,
            ...(filter.config ? { config: filter.config } : {})
          }
        });
      } else {
        await prisma.filterGroupItem.create({
          data: {
            filterGroupId,
            filterType: filter.filterType,
            filterKey: filter.filterKey,
            label: filter.label,
            displayMode: filter.displayMode,
            isEnabled: filter.isEnabled,
            order: filter.order !== undefined ? filter.order : 0,
            ...(filter.config ? { config: filter.config } : {})
          }
        });
      }
    }
    
    await invalidateShop(shop);
    return { success: true, intent, count: filtersData.length };
  }

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

    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "addFilter") {
    let filterType = formData.get("filterType");
    let filterKey = formData.get("filterKey") || null;
    if (filterType?.toLowerCase() === "title") { filterType = "title"; filterKey = null; }
    const label = formData.get("label");
    const displayMode = formData.get("displayMode") || "list";
    const config = formData.get("config")
      ? JSON.parse(formData.get("config"))
      : undefined;

    // Fix for option types (e.g. "color", "size", "title", "denominations")
    // Storefront expects filterType="option" and filterKey="Color"
    const isDynamicOption = ![
      "collection",
      "title",
      "vendor",
      "product_type",
      "tag",
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
    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "updateFilter") {
    const filterId = formData.get("filterId");
    const label = formData.get("label");
    const displayMode = formData.get("displayMode");
    
    let filterType = formData.get("filterType");
    let filterKey = formData.get("filterKey") || null;
    if (filterType?.toLowerCase() === "title") { filterType = "title"; filterKey = null; }
    
    const config = formData.get("config")
      ? JSON.parse(formData.get("config"))
      : undefined;

    // Fix for option types
    const isDynamicOption = ![
      "collection",
      "title",
      "vendor",
      "product_type",
      "tag",
      "tags",
      "price",
      "percent_sale",
      "weight",
      "review_rating",
      "stock_status",
      "inventory_locations",
    ].includes(filterType);

    if (isDynamicOption && filterType) {
      filterKey = filterType;
      filterType = "option";
    }

    await prisma.filterGroupItem.update({
      where: { id: filterId },
      data: {
        ...(filterType ? { filterType } : {}),
        ...(filterKey !== undefined ? { filterKey } : {}),
        label,
        displayMode,
        ...(config !== undefined ? { config } : {}),
      },
    });
    invalidateShop(shop);
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

    invalidateShop(shop);
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
    invalidateShop(shop);
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
    invalidateShop(shop);
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
    invalidateShop(shop);
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
    list: { bg: "rgba(30, 27, 75, 0.05)", text: "#1E1B4B", border: "rgba(30, 27, 75, 0.12)" },
    range: { bg: "rgba(16, 185, 129, 0.05)", text: "#10B981", border: "rgba(16, 185, 129, 0.15)" },
    swatch: { bg: "rgba(219, 58, 93, 0.05)", text: "#DB3A5D", border: "rgba(219, 58, 93, 0.15)" },
    button: { bg: "rgba(91, 33, 182, 0.05)", text: "#5B21B6", border: "rgba(91, 33, 182, 0.15)" },
    box: { bg: "rgba(91, 33, 182, 0.05)", text: "#5B21B6", border: "rgba(91, 33, 182, 0.15)" },
    dropdown: { bg: "rgba(123, 96, 243, 0.06)", text: "#7B60F3", border: "rgba(123, 96, 243, 0.15)" },
  };
  const c = colors[mode] || colors.list;
  const label =
    DISPLAY_MODES.find((d) => d.value === mode)?.label.split(" ")[0] || mode;
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "6px",
        backgroundColor: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        fontSize: "12px",
        fontWeight: "600",
      }}
    >
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────
const SortableItem = ({ id, item, index }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: transform ? 1000 : 1 };
  return (
    <div 
      ref={setNodeRef} 
      {...attributes} 
      {...listeners} 
      style={style}
      className="sortable-item-card"
    >
      <div className="sortable-item-drag-handle">
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
      </div>
      <div className="sortable-item-label">{item.label}</div>
      <div className="sortable-item-badge">Pos: {index + 1}</div>
    </div>
  );
};

export default function FilterGroupDetail() {
  const { group, detectedOptions, shopifyCollections, storeData } =
    useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const navigation = useNavigation();

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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const handleImportSubmit = (parsedFilters) => {
    submit(
      {
        intent: "importFilters",
        filters: JSON.stringify(parsedFilters),
      },
      { method: "POST" }
    );
    setIsImportModalOpen(false);
  };
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [editingFilterData, setEditingFilterData] = useState(null);

  // Toolbar State
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatusView, setFilterStatusView] = useState("all"); // 'all', 'active', 'inactive'
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isAddFilterDropdownOpen, setIsAddFilterDropdownOpen] = useState(false);
  const addFilterDropdownRef = useRef(null);
  const [isReorderModalOpen, setIsReorderModalOpen] = useState(false);
  const [reorderItems, setReorderItems] = useState([]);
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (isReorderModalOpen) {
      setReorderItems([...group.filters].sort((a, b) => a.order - b.order));
    }
  }, [isReorderModalOpen, group.filters]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setReorderItems((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const saveReorder = () => {
    const orderedIds = reorderItems.map(item => item.id);
    submit({ intent: "reorderFilters", orderedIds: JSON.stringify(orderedIds) }, { method: "post" });
    setIsReorderModalOpen(false);
  };
  
  const sortReorderAZ = () => {
    setReorderItems([...reorderItems].sort((a, b) => a.label.localeCompare(b.label)));
  };
  
  const sortReorderZA = () => {
    setReorderItems([...reorderItems].sort((a, b) => b.label.localeCompare(a.label)));
  };

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
      if (addFilterDropdownRef.current && !addFilterDropdownRef.current.contains(event.target)) {
        setIsAddFilterDropdownOpen(false);
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
        } else if (actionData.intent === "importFilters") {
          shopify.toast.show(`${actionData.count || "Filters"} imported successfully`);
        }
      } else if (actionData.error) {
        shopify.toast.show(actionData.error, { isError: true });
      }
    }
  }, [actionData, shopify]);

  const openConfigModal = (filter) => {
    filter = normalizeProductTitleFilter(filter);
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
            ? filter.filterKey
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
    shopify.toast.show("Group updated");
  };

  const filteredFiltersList = group.filters
    .filter((filter) => {
      if (filterStatusView === "active") return filter.isEnabled;
      if (filterStatusView === "inactive") return !filter.isEnabled;
      return true;
    })
    .filter((filter) =>
      filter.label.toLowerCase().includes(filterSearch.toLowerCase()),
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
          if (c.operator === "contains") return sVal.includes(sTarget);
          if (c.operator === "doesNotContain") return !sVal.includes(sTarget);
          if (c.operator === "startsWith") return sVal.startsWith(sTarget);
          if (c.operator === "endsWith") return sVal.endsWith(sTarget);
        }
        return false;
      };

      if (advancedMatchType === "all") {
        return advancedConditions.every(passesCondition);
      } else {
        return advancedConditions.some(passesCondition);
      }
    });

  return (
    <s-page>
      <ui-title-bar title={group.name}></ui-title-bar>
      
      <style dangerouslySetInnerHTML={{ __html: `
        /* Premium custom styling for Filter Group Detail page */
        .back-link-breadcrumb {
          color: #5B21B6 !important;
          text-decoration: none !important;
          font-weight: 700 !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          padding: 8px 14px !important;
          border-radius: 8px !important;
          background: rgba(91, 33, 182, 0.04) !important;
          border: 1px solid rgba(91, 33, 182, 0.08) !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .back-link-breadcrumb:hover {
          color: #ffffff !important;
          background: #5B21B6 !important;
          border-color: #5B21B6 !important;
          transform: translateX(-2px);
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }

        /* Group Info Card styling */
        .group-info-card {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          padding: 24px !important;
          margin-bottom: 24px !important;
        }
        s-card {
          --s-card-border-radius: 16px !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: hidden !important;
        }

        .input-group-name {
          width: 100% !important;
          padding: 12px 16px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #1E1B4B !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-sizing: border-box !important;
        }
        .input-group-name:focus {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1) !important;
        }

        /* Dropdown Trigger Box */
        .collection-select-trigger {
          width: 100% !important;
          padding: 12px 16px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #1E1B4B !important;
          cursor: pointer !important;
          background: #ffffff !important;
          user-select: none !important;
          display: flex !important;
          align-items: center !important;
          flex-wrap: wrap !important;
          gap: 6px !important;
          transition: all 0.2s ease !important;
          box-sizing: border-box !important;
        }
        .collection-select-trigger:hover {
          border-color: #5B21B6 !important;
        }

        /* Collection Pill Badges */
        .collection-pill {
          display: inline-flex !important;
          align-items: center !important;
          background: rgba(91, 33, 182, 0.08) !important;
          color: #5B21B6 !important;
          padding: 4px 10px !important;
          border-radius: 8px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          gap: 6px !important;
          border: 1px solid rgba(91, 33, 182, 0.15) !important;
          transition: all 0.2s ease !important;
        }
        .collection-pill:hover {
          background: rgba(91, 33, 182, 0.12) !important;
        }

        /* Radio selectors */
        input[type="radio"] {
          accent-color: #5B21B6 !important;
        }

        /* Update button */
        .btn-update-group {
          background-color: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 10px 24px !important;
          font-size: 13.5px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          position: relative !important;
          overflow: hidden !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }
        .btn-update-group::after {
          content: '' !important;
          position: absolute !important;
          top: 0 !important;
          left: -120% !important;
          width: 80% !important;
          height: 100% !important;
          background: linear-gradient(
            90deg, 
            rgba(255, 255, 255, 0) 0%, 
            rgba(255, 255, 255, 0.4) 50%, 
            rgba(255, 255, 255, 0) 100%
          ) !important;
          transform: skewX(-25deg) !important;
          transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .btn-update-group:hover::after {
          left: 150% !important;
        }
        .btn-update-group:hover {
          background-color: #1E1B4B !important;
          box-shadow: 0 4px 12px rgba(30, 27, 75, 0.2) !important;
          transform: translateY(-1px) !important;
        }

        /* Filters list container */
        .filters-list-card {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: hidden !important;
        }

        .filters-toolbar {
          padding: 20px 24px !important;
          display: flex !important;
          align-items: center !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important;
        }

        /* Filter View Button */
        .btn-view-filters {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 10px 18px !important;
          border-radius: 10px !important;
          color: #1E1B4B !important;
          font-weight: 600 !important;
          font-size: 13.5px !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
        }
        .btn-view-filters:hover {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
        }

        /* Add Filter Split Button */
        .btn-add-filter-main {
          background: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          padding: 10px 16px !important;
          font-weight: 600 !important;
          font-size: 13.5px !important;
          cursor: pointer !important;
          border-radius: 10px 0 0 10px !important;
          position: relative !important;
          overflow: hidden !important;
          transition: all 0.2s ease !important;
        }
        .btn-add-filter-arrow {
          background: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          padding: 10px 12px !important;
          cursor: pointer !important;
          display: inline-flex !important;
          align-items: center !important;
          border-radius: 0 10px 10px 0 !important;
          border-left: 1px solid rgba(255, 255, 255, 0.2) !important;
          transition: all 0.2s ease !important;
        }
        .add-filter-split-btn:hover .btn-add-filter-main,
        .add-filter-split-btn:hover .btn-add-filter-arrow {
          background-color: #1E1B4B !important;
        }

        /* Search input inside list */
        .search-filters-input {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 10px 16px 10px 40px !important;
          border-radius: 10px !important;
          font-size: 13.5px !important;
          color: #1E1B4B !important;
          width: 220px !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .search-filters-input:focus {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1) !important;
        }

        /* Icon action buttons */
        .btn-icon-action {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          cursor: pointer !important;
          padding: 9px !important;
          border-radius: 10px !important;
          color: #1E1B4B !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .btn-icon-action:hover {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
          background-color: rgba(91, 33, 182, 0.04) !important;
        }

        /* Table design */
        .filters-table {
          width: 100% !important;
          border-collapse: collapse !important;
          text-align: left !important;
        }
        .filters-table th {
          background: #1E1B4B !important;
          border-bottom: 3px solid #5B21B6 !important;
          padding: 18px 24px !important;
          font-weight: 700 !important;
          font-size: 12.5px !important;
          color: #ffffff !important;
          text-transform: uppercase !important;
          letter-spacing: 0.8px !important;
        }
        .filters-table tr {
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          transition: background-color 0.2s ease !important;
        }
        .filters-table tr:hover {
          background-color: rgba(91, 33, 182, 0.02) !important;
        }
        .filters-table td {
          padding: 18px 24px !important;
          font-size: 14px !important;
        }

        /* Toggle switch */
        .toggle-switch-slider {
          background-color: #e2e8f0 !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        input:checked + .toggle-switch-slider {
          background-color: #10B981 !important;
        }

        /* Row action small icon buttons */
        .row-action-btn-small {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          cursor: pointer !important;
          padding: 8px !important;
          border-radius: 8px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          box-shadow: 0 1px 3px rgba(30, 27, 75, 0.02) !important;
        }
        .row-action-btn-small svg {
          fill: #4b5563 !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .row-action-edit:hover {
          background-color: #5B21B6 !important;
          border-color: #5B21B6 !important;
          transform: scale(1.15) !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.25) !important;
        }
        .row-action-edit:hover svg {
          fill: #ffffff !important;
        }
        .row-action-duplicate:hover {
          background-color: #10B981 !important;
          border-color: #10B981 !important;
          transform: scale(1.15) !important;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25) !important;
        }
        .row-action-duplicate:hover svg {
          fill: #ffffff !important;
        }
        .row-action-delete:hover {
          background-color: #DB3A5D !important;
          border-color: #DB3A5D !important;
          transform: scale(1.15) !important;
          box-shadow: 0 4px 12px rgba(219, 58, 93, 0.25) !important;
        }
        .row-action-delete:hover svg {
          fill: #ffffff !important;
        }

        /* Manual/All Values labels */
        .badge-values-tag {
          padding: 5px 12px !important;
          border-radius: 8px !important;
          background-color: rgba(30, 27, 75, 0.05) !important;
          color: #1E1B4B !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          display: inline-flex !important;
        }

        /* Reorder Modal Styles */
        .sortable-item-card {
          display: flex !important;
          align-items: center !important;
          padding: 12px 16px !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 10px !important;
          background: #ffffff !important;
          margin-bottom: 10px !important;
          position: relative !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
          cursor: grab !important;
        }
        .sortable-item-card:hover {
          border-color: #5B21B6 !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.08) !important;
          background-color: rgba(91, 33, 182, 0.01) !important;
        }
        .sortable-item-drag-handle {
          margin-right: 14px !important;
          color: #8c9196 !important;
          display: flex !important;
          align-items: center !important;
          transition: color 0.2s ease !important;
        }
        .sortable-item-card:hover .sortable-item-drag-handle {
          color: #5B21B6 !important;
        }
        .sortable-item-label {
          flex: 1 !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          color: #1E1B4B !important;
        }
        .sortable-item-badge {
          color: #5B21B6 !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          background: rgba(91, 33, 182, 0.06) !important;
          padding: 4px 10px !important;
          border-radius: 20px !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
        }

        /* Reorder Modal Buttons */
        .btn-reorder-action {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          border-radius: 10px !important;
          padding: 8px 16px !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          color: #1E1B4B !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }
        .btn-reorder-action:hover {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
          background: rgba(91, 33, 182, 0.04) !important;
        }
        .btn-reorder-cancel {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          border-radius: 10px !important;
          padding: 8px 20px !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          color: #4b5563 !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }
        .btn-reorder-cancel:hover {
          background: #f9fafb !important;
          color: #111827 !important;
          border-color: #d1d5db !important;
        }
        .btn-reorder-save {
          background: #5B21B6 !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 8px 24px !important;
          font-size: 13.5px !important;
          font-weight: 700 !important;
          color: #ffffff !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }
        .btn-reorder-save:hover {
          background: #1E1B4B !important;
          box-shadow: 0 4px 12px rgba(30, 27, 75, 0.2) !important;
          transform: translateY(-1px) !important;
        }

        /* Custom scrollbar for reorder modal */
        .reorder-scroll-container::-webkit-scrollbar {
          width: 6px !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-track {
          background: rgba(30, 27, 75, 0.02) !important;
          border-radius: 10px !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(30, 27, 75, 0.15) !important;
          border-radius: 10px !important;
          transition: background 0.2s ease !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-thumb:hover {
          background: #5B21B6 !important;
        }
        /* Firefox fallback */
        .reorder-scroll-container {
          scrollbar-width: thin !important;
          scrollbar-color: rgba(30, 27, 75, 0.15) rgba(30, 27, 75, 0.02) !important;
        }

        /* Customize Columns Modal */
        .customize-col-container {
          display: flex !important;
          gap: 40px !important;
        }
        .customize-col-section {
          flex: 1 !important;
        }
        .customize-col-header {
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          margin-bottom: 20px !important;
          justify-content: space-between !important;
        }
        .customize-col-btn-link {
          background: none !important;
          border: none !important;
          color: #5B21B6 !important;
          cursor: pointer !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          padding: 0 !important;
          transition: color 0.2s ease !important;
        }
        .customize-col-btn-link:hover {
          color: #1E1B4B !important;
        }
        .customize-col-list {
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
        }
        .customize-col-label {
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          cursor: pointer !important;
          font-size: 14px !important;
          color: #1E1B4B !important;
          font-weight: 600 !important;
          padding: 8px 12px !important;
          border-radius: 8px !important;
          border: 1px solid transparent !important;
          transition: all 0.2s ease !important;
        }
        .customize-col-label:hover {
          background: rgba(91, 33, 182, 0.04) !important;
          border-color: rgba(91, 33, 182, 0.08) !important;
        }
        .customize-col-drag-card {
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          font-size: 14px !important;
          color: #1E1B4B !important;
          cursor: grab !important;
          padding: 10px 14px !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 10px !important;
          background: #ffffff !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .customize-col-drag-card:hover {
          border-color: #5B21B6 !important;
          background: rgba(91, 33, 182, 0.01) !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.06) !important;
        }
        .customize-col-drag-handle {
          color: #8c9196 !important;
          display: flex !important;
          align-items: center !important;
          transition: color 0.2s ease !important;
        }
        .customize-col-drag-card:hover .customize-col-drag-handle {
          color: #5B21B6 !important;
        }
        .customize-col-remove-btn {
          background: none !important;
          border: none !important;
          cursor: pointer !important;
          padding: 4px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 6px !important;
          color: #8c9196 !important;
          transition: all 0.2s ease !important;
        }
        .customize-col-remove-btn:hover {
          background: rgba(219, 58, 93, 0.08) !important;
          color: #DB3A5D !important;
        }
      ` }} />

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
          className="back-link-breadcrumb"
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
          Filter groups
        </Link>
        <span style={{ color: "#6d7175" }}>›</span>
        <span style={{ color: "#1E1B4B", fontWeight: "700", fontSize: "14.5px" }}>
          {group.name}
        </span>
      </div>

      <s-stack direction="block" gap="base">
        <div className="group-info-card">
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E1B4B", marginBottom: "20px" }}>
            Filter group information
          </h2>
          <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter filter group name"
                className="input-group-name"
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
                        color: "#1E1B4B",
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
                        style={{ display: "block", marginBottom: "12px", fontSize: "13px", color: "#6d7175", fontWeight: "500" }}
                      >
                        Select collections using this filter group
                      </s-text>
                      <div
                        onClick={() => setShowCollDropdown(!showCollDropdown)}
                        className="collection-select-trigger"
                      >
                        {selectedColls.length > 0 ? (
                          selectedColls.map((c) => (
                            <span
                              key={c.id}
                              className="collection-pill"
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
                        color: "#1E1B4B",
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
              borderTop: "1px solid rgba(30, 27, 75, 0.08)",
            }}
          >
            <button className="btn-update-group" onClick={handleUpdateGroupSettings}>
              UPDATE
            </button>
          </div>
        </div>

        <div className="filters-list-card">
          <div className="filters-toolbar">
            {/* Left side: Filters heading */}
            <div style={{ width: "120px" }}>
              <span
                style={{
                  fontSize: "18px",
                  fontWeight: "700",
                  color: "#1E1B4B",
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
                  className="btn-view-filters"
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
                ref={addFilterDropdownRef}
                style={{
                  position: "relative",
                  display: "inline-block"
                }}
              >
                <div
                  className="add-filter-split-btn"
                  style={{
                    display: "flex",
                    borderRadius: "10px",
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="btn-add-filter-main"
                  >
                    Add filter
                  </button>
                  <button
                    onClick={() => setIsAddFilterDropdownOpen(!isAddFilterDropdownOpen)}
                    className="btn-add-filter-arrow"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "16px",
                        height: "16px",
                        fill: "currentColor",
                        display: "block",
                      }}
                    >
                      <path d="M10 14a1 1 0 0 1-.707-.293l-4-4a1 1 0 0 1 1.414-1.414L10 11.586l3.293-3.293a1 1 0 0 1 1.414 1.414l-4 4A1 1 0 0 1 10 14z" />
                    </svg>
                  </button>
                </div>
                
                {isAddFilterDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: "4px",
                      background: "#ffffff",
                      border: "1px solid rgba(30, 27, 75, 0.08)",
                      borderRadius: "8px",
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                      minWidth: "160px",
                      zIndex: 50,
                      padding: "6px",
                    }}
                  >
                    <button
                      onClick={() => {
                        setIsCreateModalOpen(true);
                        setIsAddFilterDropdownOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "10px 12px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1E1B4B",
                        borderRadius: "6px",
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = "rgba(30, 27, 75, 0.04)"}
                      onMouseOut={(e) => e.currentTarget.style.background = "none"}
                    >
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "none", stroke: "#007BFF", strokeWidth: "2" }}>
                        <path d="M10 4v12m-6-6h12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Add filter
                    </button>
                    <button
                      onClick={() => {
                        setIsImportModalOpen(true);
                        setIsAddFilterDropdownOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "10px 12px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: "#1E1B4B",
                        borderRadius: "6px",
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = "rgba(30, 27, 75, 0.04)"}
                      onMouseOut={(e) => e.currentTarget.style.background = "none"}
                    >
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "none", stroke: "#007BFF", strokeWidth: "2" }}>
                        <path d="M4 4v1a3 3 0 003 3h10a3 3 0 003-3V4m-4 4l-4-4m0 0l-4 4m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Import filters
                    </button>
                  </div>
                )}
              </div>

              {selectedFilters.length > 0 && (
                <button
                  onClick={() => setIsExportModalOpen(true)}
                  className="btn-view-filters"
                  style={{
                    color: "#5B21B6",
                    borderColor: "#5B21B6",
                  }}
                >
                  <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "none", stroke: "currentColor", strokeWidth: "2" }}>
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Export selected
                </button>
              )}
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
                    fill: "#5B21B6",
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
                  className="search-filters-input"
                />
              </div>

              {/* Icons */}
              <button
                onClick={() => setIsReorderModalOpen(true)}
                title="Reorder Filters"
                className="btn-icon-action"
                style={{ marginRight: "8px" }}
              >
                <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><path d="M5.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm13 5.5a1 1 0 0 0 0-2h-10a1 1 0 0 0 0 2h10zm0-6a1 1 0 0 0 0-2h-10a1 1 0 0 0 0 2h10z"/></svg>
              </button>
              <button
                onClick={() => setIsCustomizeColumnsOpen(true)}
                title="Customize Columns"
                className="btn-icon-action"
                style={{ marginRight: "8px" }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "18px",
                    height: "18px",
                    fill: "currentColor",
                  }}
                >
                  <path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19.33 13.04l2.12.88a1 1 0 0 1 .53 1.28l-1.5 3.62a1 1 0 0 1-1.28.53l-2.12-.88a7.073 7.073 0 0 1-2.14 1.26l-.33 2.27a1 1 0 0 1-.99.85h-3.88a1 1 0 0 1-.99-.85l-.33-2.27a7.073 7.073 0 0 1-2.14-1.26l-2.12.88a1 1 0 0 1-1.28-.53l-1.5-3.62a1 1 0 0 1 .53-1.28l2.12-.88c-.06-.41-.11-.83-.11-1.26s.05-.85.11-1.26l-2.12-.88a1 1 0 0 1-.53-1.28l1.5-3.62a1 1 0 0 1 1.28-.53l2.12.88c.63-.53 1.34-.97 2.14-1.26l.33-2.27a1 1 0 0 1 .99-.85h3.88a1 1 0 0 1 .99.85l.33 2.27c.8.29 1.51.73 2.14 1.26l2.12-.88a1 1 0 0 1 1.28.53l1.5 3.62a1 1 0 0 1-.53 1.28l-2.12.88c.06.41.11.83.11 1.26s-.05.85-.11 1.26z" />
                </svg>
              </button>
              <button
                onClick={() => setIsAdvancedFilterOpen(true)}
                title="Advanced Filter"
                className="btn-icon-action"
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "18px",
                    height: "18px",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2.5",
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
            <table className="filters-table">
              <thead>
                <tr>
                  <th style={{ width: "32px", padding: "12px 16px" }}></th>
                  <th style={{ display: "flex", alignItems: "center", gap: "12px", color: "#fff" }}>
                    <Checkbox
                      checked={selectedFilters.length > 0 && selectedFilters.length === filteredFiltersList.length}
                      onChange={(checked) => {
                        if (checked) setSelectedFilters(filteredFiltersList.map((f) => f.id));
                        else setSelectedFilters([]);
                      }}
                    />
                    Filter title
                  </th>
                  <th>Display mode</th>
                  <th>Filter values</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiltersList.map((filter) => (
                    <tr key={filter.id}>
                      <td style={{ cursor: "grab", textAlign: "center", verticalAlign: "middle" }}>
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
                      <td style={{ display: "flex", alignItems: "center", gap: "12px", verticalAlign: "middle" }}>
                        <Checkbox
                          checked={selectedFilters.includes(filter.id)}
                          onChange={(checked) => {
                            if (checked) setSelectedFilters([...selectedFilters, filter.id]);
                            else setSelectedFilters(selectedFilters.filter(id => id !== filter.id));
                          }}
                        />
                        <button
                          onClick={() => openConfigModal(filter)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#1E1B4B",
                            fontSize: "14px",
                            fontWeight: "700",
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
                      <td>
                        <DisplayModeBadge mode={filter.displayMode} />
                      </td>
                      <td>
                        {(() => {
                          let configObj = {};
                          try {
                            configObj = typeof filter.config === "string" ? JSON.parse(filter.config) : (filter.config || {});
                          } catch (e) {}
                          
                          if (configObj.useManualValues) {
                            return <span className="badge-values-tag">Manual values</span>;
                          }
                          return (
                            <span className="badge-values-tag">
                              All values
                            </span>
                          );
                        })()}
                      </td>
                      <td>
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
                            className="toggle-switch-slider"
                            style={{
                              position: "absolute",
                              inset: 0,
                              backgroundColor: filter.isEnabled
                                ? "#10B981"
                                : "#e2e8f0",
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
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            justifyContent: "flex-end",
                            alignItems: "center",
                          }}
                        >
                          <button
                            onClick={() => openConfigModal(filter)}
                            className="row-action-btn-small row-action-edit"
                            title="Configure"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{
                                width: "15px",
                                height: "15px",
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
                            className="row-action-btn-small row-action-duplicate"
                            title="Duplicate"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{
                                width: "15px",
                                height: "15px",
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
                            className="row-action-btn-small row-action-delete"
                            title="Delete"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{
                                width: "15px",
                                height: "15px",
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

      <ExportFilterItemsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        filters={selectedFilters.length > 0 ? group.filters.filter(f => selectedFilters.includes(f.id)) : group.filters}
        filterGroupId={group.id}
      />
      
      <ImportFilterItemsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSubmit={handleImportSubmit}
        isSubmitting={navigation.state === "submitting" && navigation.formData?.get("intent") === "importFilters"}
      />

      <Modal
          isOpen={isReorderModalOpen}
          onClose={() => setIsReorderModalOpen(false)}
          title="Reorder Filters"
          width="500px"
          padding="26px"
          footer={
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={sortReorderAZ} className="btn-reorder-action">Sort A-Z</button>
                <button onClick={sortReorderZA} className="btn-reorder-action">Sort Z-A</button>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setIsReorderModalOpen(false)} className="btn-reorder-cancel">Cancel</button>
                <button onClick={saveReorder} className="btn-reorder-save">Save Order</button>
              </div>
            </div>
          }
        >
          <div className="reorder-scroll-container" style={{ padding: "0", maxHeight: "60vh", overflowY: "auto" }}>
            <p style={{ color: "#6d7175", fontSize: "13px", marginBottom: "16px" }}>Drag and drop filters to reorder them on the storefront.</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={reorderItems} strategy={verticalListSortingStrategy}>
                {reorderItems.map((item, index) => (
                  <SortableItem key={item.id} id={item.id} item={item} index={index} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </Modal>

        <Modal
        isOpen={isCustomizeColumnsOpen}
        onClose={() => setIsCustomizeColumnsOpen(false)}
        title="Customize Columns"
        width="700px"
        padding="26px"
        footer={
          <>
            <button
              onClick={() => setIsCustomizeColumnsOpen(false)}
              className="btn-reorder-cancel"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setTableColumns(tempTableColumns);
                setIsCustomizeColumnsOpen(false);
              }}
              className="btn-reorder-save"
            >
              Save Columns
            </button>
          </>
        }
      >
        <div className="customize-col-container">
          {/* Left Side */}
          <div className="customize-col-section">
            <div className="customize-col-header">
              <SearchInput
                value={columnsSearch}
                onChange={(e) => setColumnsSearch(e.target.value)}
                style={{ width: "200px" }}
              />
              <button
                onClick={() =>
                  setTempTableColumns(ALL_COLUMNS.map((c) => c.id))
                }
                className="customize-col-btn-link"
              >
                select all
              </button>
            </div>
            <div className="customize-col-list">
              {ALL_COLUMNS.filter((c) =>
                c.label.toLowerCase().includes(columnsSearch.toLowerCase()),
              ).map((c) => (
                <label
                  key={c.id}
                  className="customize-col-label"
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
          <div className="customize-col-section">
            <div className="customize-col-header">
              <span style={{ fontSize: "14px", color: "#1E1B4B", fontWeight: "600" }}>
                {tempTableColumns.length} columns selected
              </span>
              <button
                onClick={() => setTempTableColumns([])}
                className="customize-col-btn-link"
              >
                clear all
              </button>
            </div>
            <div className="customize-col-list">
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
                    className="customize-col-drag-card"
                  >
                    <div className="customize-col-drag-handle">
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}>
                        <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontWeight: "600", color: "#1E1B4B" }}>{col.label}</span>
                    {col.locked ? (
                      <svg
                        viewBox="0 0 20 20"
                        style={{
                          width: "16px",
                          height: "16px",
                          fill: "#10B981",
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
                        className="customize-col-remove-btn"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          style={{
                            width: "16px",
                            height: "16px",
                            fill: "currentColor",
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
