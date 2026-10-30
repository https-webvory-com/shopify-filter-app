import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { invalidateShop } from "../services/shopCache.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { ImportFilterGroupModal } from "../components/ui/ImportFilterGroupModal";
import { ExportFilterGroupsModal } from "../components/ui/ExportFilterGroupsModal";

// Ã¢â€â‚¬Ã¢â€â‚¬ Built-in filters seeded into every new default group Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
    filterKey: "Size",
    label: "Size",
    displayMode: "list",
    order: 5,
  },
];

// Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  const existingFilterKeys = new Set(
    existing.filters.map((filter) => `${filter.filterType}:${filter.filterKey ?? ""}`)
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Loader Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  return { groups, collections, shop };
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Action Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    await invalidateShop(shop);
    return { success: true, groupId: group.id, intent };
  }

  if (intent === "import") {
    const parsedGroupsStr = formData.get("groups") || "[]";
    let parsedGroups = [];
    try {
      parsedGroups = JSON.parse(parsedGroupsStr);
    } catch (e) {
      console.error("Failed to parse imported groups", e);
    }

    if (!parsedGroups || parsedGroups.length === 0) {
      return {
        success: false,
        error: "No valid groups found to import.",
        intent,
      };
    }

    const lastGroup = await prisma.filterGroup.findFirst({
      where: { shop },
      orderBy: { order: "desc" },
    });
    let nextOrder = (lastGroup?.order ?? -1) + 1;

    for (const groupData of parsedGroups) {
      let existingGroup = null;
      if (groupData.id) {
        existingGroup = await prisma.filterGroup.findFirst({
          where: { shop, id: groupData.id },
        });
      }
      if (!existingGroup) {
        existingGroup = await prisma.filterGroup.findFirst({
          where: { shop, name: { equals: groupData.name, mode: "insensitive" } },
        });
      }

      let collectionsToCreate = [];
      if (groupData.forCollections !== false) {
        // It's for collection pages
        let parsedCollectionIds = [];
        let parsedCollectionTitles = [];
        try {
          if (groupData.collections) parsedCollectionIds = JSON.parse(groupData.collections);
          if (groupData.collectionTitles) parsedCollectionTitles = JSON.parse(groupData.collectionTitles);
        } catch (e) {
          console.error("Failed to parse collection IDs/Titles from CSV", e);
        }

        if (parsedCollectionIds.length > 0) {
          // Map specific collections
          collectionsToCreate = parsedCollectionIds.map((id, index) => ({
            collectionId: id.toString(),
            collectionTitle: parsedCollectionTitles[index] || "Unknown Collection",
            pageType: "collection",
          }));
        } else {
          // Fallback to All Collections if none specified
          collectionsToCreate = [
            {
              collectionId: "__all__",
              collectionTitle: "All Collections",
              pageType: "collection",
            },
          ];
        }
      } else {
        // It's for the search page
        collectionsToCreate = [
          {
            collectionId: "search",
            collectionTitle: "Search Results",
            pageType: "search",
          },
        ];
      }

      if (existingGroup) {
        // Delete old collections
        await prisma.filterGroupCollection.deleteMany({
          where: { filterGroupId: existingGroup.id },
        });

        // Update group and create new collections
        await prisma.filterGroup.update({
          where: { id: existingGroup.id },
          data: {
            name: groupData.name,
            status: groupData.status !== undefined ? groupData.status : true,
            collections: {
              create: collectionsToCreate,
            },
          },
        });
      } else {
        await prisma.filterGroup.create({
          data: {
            shop,
            name: groupData.name,
            isDefault: false,
            status: groupData.status !== undefined ? groupData.status : true,
            order: nextOrder++,
            collections: {
              create: collectionsToCreate,
            },
          },
        });
      }
    }

    await invalidateShop(shop);
    return { success: true, importedCount: parsedGroups.length, intent };
  }

  if (intent === "delete") {
    const id = formData.get("id");
    await prisma.filterGroup.delete({ where: { id, shop } });
    await invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "toggle") {
    const id = formData.get("id");
    const current = await prisma.filterGroup.findUnique({
      where: { id, shop },
      select: { status: true },
    });
    if (!current) return { success: false, error: "Filter group not found", intent };
    await prisma.filterGroup.update({
      where: { id, shop },
      data: { status: !current.status },
    });
    await invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "duplicate") {
    const id = formData.get("id");
    const source = await prisma.filterGroup.findUnique({
      where: { id, shop },
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

    await invalidateShop(shop);
    return { success: true, intent };
  }

  return { success: false };
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
  const { groups, collections, shop } = useLoaderData();
  const [favoriteGroups, setFavoriteGroups] = useState([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`cfp:favorite-filter-groups:${shop}`) || '[]');
      setFavoriteGroups(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
    } catch { setFavoriteGroups([]); }
  }, [shop]);
  const toggleFavorite = id => {
    const next = favoriteGroups.includes(id) ? favoriteGroups.filter(value => value !== id) : [...favoriteGroups, id];
    try { localStorage.setItem(`cfp:favorite-filter-groups:${shop}`, JSON.stringify(next)); }
    catch { shopify.toast.show("Unable to save favorites in this browser.", { isError: true }); return; }
    setFavoriteGroups(next);
  };
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
      if (!e.target.closest(".filter-dropdown-inside")) {
        setShowViewsDropdown(false);
        setShowCollDropdown(false);
        setShowCreateDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [showCreate, setShowCreate] = useState(false);
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
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
    if (activeView === "favorites") matchesView = favoriteGroups.includes(g.id);
    return matchesSearch && matchesView;
  });

  const getActiveViewLabel = () => {
    if (activeView === "active") return "Active filters groups";
    if (activeView === "inactive") return "Inactive filters groups";
    if (activeView === "favorites") return "My favorite groups";
    return "All groups";
  };

  const [selectedGroups, setSelectedGroups] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);

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

  const handleImportSubmit = (parsedGroups) => {
    submit(
      {
        intent: "import",
        groups: JSON.stringify(parsedGroups),
      },
      { method: "POST" }
    );
    setShowImportModal(false);
  };

  return (
    <s-page heading="Filter Groups">
      <ui-title-bar title="Filter Groups">
        <button variant="breadcrumb" onClick={() => navigate("/app/filters")}>
          Filters
        </button>
      </ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* Custom styling for Filter Groups Page */
        .filter-groups-container {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: hidden;
        }

        .table-toolbar {
          padding: 20px 24px !important;
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important; /* Premium subtle gradient */
        }

        /* Back link */
        .back-link {
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
        .back-link:hover {
          color: #ffffff !important;
          background: #5B21B6 !important;
          border-color: #5B21B6 !important;
          transform: translateX(-2px);
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }

        /* Dropdown trigger button */
        .view-dropdown-btn {
          background: #ffffff !important;
          color: #1E1B4B !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 10px 18px !important;
          border-radius: 10px !important; /* Premium modern corners */
          font-size: 13.5px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          transition: all 0.2s ease !important;
          outline: none;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .view-dropdown-btn:hover {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
          background: rgba(91, 33, 182, 0.02) !important;
        }

        /* Create button styling */
        .btn-create-group {
          background-color: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 10px !important; /* Match premium card rounding */
          padding: 10px 20px !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          position: relative !important;
          overflow: hidden !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }

        .btn-create-group::after {
          content: '';
          position: absolute;
          top: 0;
          left: -120%;
          width: 80%;
          height: 100%;
          background: linear-gradient(
            90deg, 
            rgba(255, 255, 255, 0) 0%, 
            rgba(255, 255, 255, 0.4) 50%, 
            rgba(255, 255, 255, 0) 100%
          );
          transform: skewX(-25deg);
          transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-create-group:hover::after {
          left: 150%;
        }
        .btn-create-group:hover {
          background-color: #1E1B4B !important;
          transform: translateY(-1px);
          box-shadow: inset 0 1px 0px rgba(255, 255, 255, 0.2), 0 4px 12px rgba(30, 27, 75, 0.2) !important;
        }

        /* Search bar styling */
        .search-input-field {
          width: 100% !important;
          padding: 10px 12px 10px 40px !important;
          border-radius: 10px !important; /* Premium corners */
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          background-color: #ffffff !important;
          font-size: 13.5px !important;
          color: #1E1B4B !important;
          font-weight: 500 !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-sizing: border-box !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .search-input-field:focus {
          background-color: #ffffff !important;
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1) !important;
        }

        /* Icon Buttons */
        .toolbar-icon-btn {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          cursor: pointer !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 9px !important;
          border-radius: 10px !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .toolbar-icon-btn:hover {
          background-color: rgba(91, 33, 182, 0.04) !important;
          border-color: #5B21B6 !important;
        }
        .toolbar-icon-btn svg {
          stroke: #1E1B4B !important;
          transition: stroke 0.2s ease !important;
        }
        .toolbar-icon-btn:hover svg {
          stroke: #5B21B6 !important;
        }

        /* Table styling - Luxury dark navy header theme */
        .groups-table {
          width: 100% !important;
          min-width: 860px;
          table-layout: fixed;
          border-collapse: collapse !important;
          text-align: left !important;
        }
        .groups-table-scroll { width: 100%; max-width: 100%; overflow-x: auto; }
        .groups-table th:first-child, .groups-table td:first-child { width: 48px; box-sizing: border-box; padding-inline: 12px !important; }
        .groups-table td { vertical-align: top; overflow-wrap: anywhere; }
        .groups-table .group-name-btn { max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-align: left; }
        .groups-table .collection-tag-badge { max-width: 100%; box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; }
        .filter-groups-container { min-width: 0; max-width: 100%; }
        .filter-groups-container .table-toolbar { flex-wrap: wrap; gap: 12px; }
        .groups-table th {
          background: #1E1B4B !important; /* Deep navy luxury background */
          border-bottom: 3px solid #5B21B6 !important; /* Indigo underline accent */
          padding: 18px 24px !important;
          font-weight: 700 !important;
          font-size: 12.5px !important;
          color: #ffffff !important; /* Sharp contrast white text */
          text-transform: uppercase !important;
          letter-spacing: 0.8px !important;
        }
        .groups-table tr {
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          transition: background-color 0.2s ease !important;
        }
        .groups-table tr:hover {
          background-color: rgba(91, 33, 182, 0.02) !important;
        }
        .groups-table td {
          padding: 18px 24px !important;
          font-size: 14px !important;
        }

        /* Group Name button link */
        .group-name-btn {
          background: none !important;
          border: none !important;
          color: #1E1B4B !important;
          font-size: 14.5px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          padding: 0 !important;
          transition: color 0.2s ease !important;
        }
        .group-name-btn:hover {
          color: #5B21B6 !important;
        }

        /* Badges */
        .badge-default-group {
          margin-left: 8px !important;
          padding: 4px 10px !important;
          border-radius: 6px !important;
          background: rgba(91, 33, 182, 0.08) !important;
          color: #5B21B6 !important;
          font-size: 10.5px !important;
          font-weight: 700 !important;
          letter-spacing: 0.5px !important;
          border: 1px solid rgba(91, 33, 182, 0.15) !important;
        }

        .collection-tag-badge {
          padding: 5px 12px !important;
          border-radius: 8px !important;
          background-color: rgba(91, 33, 182, 0.05) !important;
          color: #5B21B6 !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          transition: all 0.2s ease !important;
        }
        .collection-tag-badge:hover {
          background-color: rgba(91, 33, 182, 0.1) !important;
          border-color: rgba(91, 33, 182, 0.2) !important;
        }

        /* Action icons inside rows */
        .row-action-btn {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          cursor: pointer !important;
          padding: 8px !important;
          border-radius: 8px !important;
          display: inline-flex !important;
          align-items: center !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 1px 3px rgba(30, 27, 75, 0.02) !important;
        }
        .row-action-btn:hover {
          background-color: #fcfcff !important;
          border-color: rgba(30, 27, 75, 0.15) !important;
        }
        .row-action-btn svg {
          fill: #4b5563 !important;
          transition: all 0.2s ease !important;
        }
        .btn-edit-action:hover svg {
          fill: #5B21B6 !important;
          transform: scale(1.08);
        }
        .btn-duplicate-action:hover svg {
          fill: #10B981 !important;
          transform: scale(1.08);
        }
        .btn-delete-action:hover svg {
          fill: #DB3A5D !important;
          transform: scale(1.08);
        }

        /* Switch toggle custom styling */
        .toggle-switch-slider {
          background-color: #e2e8f0 !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        input:checked + .toggle-switch-slider {
          background-color: #10B981 !important;
        }

        /* Always Active Badge */
        .badge-always-active {
          padding: 4px 10px !important;
          border-radius: 6px !important;
          background: rgba(16, 185, 129, 0.08) !important;
          color: #10B981 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          border: 1px solid rgba(16, 185, 129, 0.15) !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
        }
        .badge-always-active::before {
          content: '' !important;
          width: 6px !important;
          height: 6px !important;
          background-color: #10B981 !important;
          border-radius: 50% !important;
          display: inline-block !important;
        }

        /* Glassmorphic Dropdown Popups */
        .glass-popup-menu {
          background: rgba(255, 255, 255, 0.98) !important;
          backdrop-filter: blur(10px) !important;
          -webkit-backdrop-filter: blur(10px) !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 12px !important;
          box-shadow: 0 10px 25px -5px rgba(30, 27, 75, 0.08) !important;
        }

        .filter-groups-container .table-toolbar { background: #ffffff !important; padding: 16px 20px !important; }
        .groups-table { table-layout: auto !important; min-width: 760px; }
        .groups-table th {
          background: #f8fafc !important;
          color: #475569 !important;
          border-bottom: 1px solid #e2e8f0 !important;
          padding: 13px 16px !important;
          font-size: 11px !important;
          letter-spacing: .04em !important;
          white-space: nowrap;
        }
        .groups-table td { padding: 15px 16px !important; vertical-align: middle !important; overflow-wrap: normal !important; }
        .groups-table th:nth-child(2), .groups-table td:nth-child(2) { min-width: 190px; }
        .groups-table th:last-child, .groups-table td:last-child { min-width: 116px; }
        .groups-table tbody tr:last-child { border-bottom: 0 !important; }
        .group-name-content { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
        .group-name-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
        .group-favorite-btn { flex: 0 0 22px; width: 22px; height: 22px; line-height: 1; padding: 0 !important; font-size: 18px; }
        .groups-table .badge-default-group { margin: 0 !important; }
        .group-empty-cell { color: #94a3b8; }
        .groups-table .row-action-btn { min-width: 32px; min-height: 32px; justify-content: center; }
        .groups-table input[type="checkbox"] { accent-color: #5b21b6; }
      `,
        }}
      />

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
          className="back-link"
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
          Back to Filters
        </a>
      </div>

      <s-stack direction="block" gap="base">
        {/* Toolbar & Groups Table */}
        <div
          className="filter-groups-container"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(30, 27, 75, 0.02)",
            overflow: "hidden",
            marginTop: "16px",
          }}
        >
          {/* Toolbar */}
          <div
            className="table-toolbar"
            style={{
              padding: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #e2e8f0",
              background: "#ffffff",
            }}
          >
            {/* Left Actions */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {/* Views Dropdown */}
              <div
                style={{ position: "relative" }}
                className="filter-dropdown-inside"
              >
                <button
                  onClick={() => setShowViewsDropdown(!showViewsDropdown)}
                  className="view-dropdown-btn"
                  style={{
                    background: "rgba(91, 33, 182, 0.06)",
                    color: "#5B21B6",
                    border: "1px solid rgba(91, 33, 182, 0.12)",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.2s ease",
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
                      strokeWidth: "2.5",
                    }}
                  >
                    <path d="M5 7l5 5 5-5" />
                  </svg>
                </button>

                {showViewsDropdown && (
                  <div
                    className="glass-popup-menu"
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: "8px",
                      width: "240px",
                      zIndex: 100,
                      background: "rgba(255, 255, 255, 0.98)",
                      border: "1px solid rgba(30, 27, 75, 0.08)",
                      borderRadius: "12px",
                      boxShadow: "0 10px 25px rgba(30, 27, 75, 0.08)",
                      overflow: "hidden",
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
                          color: activeView === view.id ? "#5B21B6" : "#1E1B4B",
                          fontWeight: activeView === view.id ? "600" : "400",
                          borderBottom:
                            view.id === "all"
                              ? "1px solid rgba(30, 27, 75, 0.08)"
                              : "none",
                        }}
                      >
                        {view.label}
                        {view.isFavorite ? (
                          <svg
                            viewBox="0 0 20 20"
                            style={{
                              width: "16px",
                              height: "16px",
                              fill: "#5B21B6",
                              stroke: "#5B21B6",
                              strokeWidth: "1.5",
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
                              stroke: "rgba(91, 33, 182, 0.5)",
                              strokeWidth: "1.5",
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

              {/* Export button */}
              {selectedGroups.length > 0 && (
                <button
                  onClick={() => setShowExportModal(true)}
                  style={{
                    backgroundColor: "#ffffff",
                    color: "#1E1B4B",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    padding: "10px 16px",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f8fafc";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#ffffff";
                  }}
                >
                  <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "none", stroke: "currentColor", strokeWidth: "2" }}>
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Export filters groups
                </button>
              )}

              {/* Create filter group dropdown */}
              <div style={{ position: "relative" }} className="filter-dropdown-inside">
                <button
                  onClick={() => setShowCreateDropdown(!showCreateDropdown)}
                  className="btn-create-group"
                  style={{
                    backgroundColor: "#5B21B6",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "10px 20px",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all 0.3s ease",
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
                        strokeWidth: "2.5",
                      }}
                    >
                      <path d="M5 7l5 5 5-5" />
                    </svg>
                  </span>
                </button>

                {showCreateDropdown && (
                  <div
                    className="glass-popup-menu"
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: "8px",
                      width: "220px",
                      zIndex: 100,
                      background: "rgba(255, 255, 255, 0.98)",
                      border: "1px solid rgba(30, 27, 75, 0.08)",
                      borderRadius: "12px",
                      boxShadow: "0 10px 25px rgba(30, 27, 75, 0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() => {
                        setShowCreateDropdown(false);
                        setShowCreate(true);
                      }}
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                        color: "#1E1B4B",
                        fontWeight: "500",
                        fontSize: "13.5px",
                        borderBottom: "1px solid rgba(30, 27, 75, 0.08)",
                        transition: "background 0.2s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        style={{
                          width: "18px",
                          height: "18px",
                          fill: "none",
                          stroke: "#3b82f6",
                          strokeWidth: "2",
                        }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Create filter group
                    </div>
                    <div
                      onClick={() => {
                        setShowCreateDropdown(false);
                        setShowImportModal(true);
                      }}
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                        color: "#1E1B4B",
                        fontWeight: "500",
                        fontSize: "13.5px",
                        transition: "background 0.2s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        style={{
                          width: "18px",
                          height: "18px",
                          fill: "none",
                          stroke: "#3b82f6",
                          strokeWidth: "2",
                        }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Import filters groups
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Actions */}
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
                    stroke: "#5B21B6",
                    strokeWidth: "2.5",
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
                  className="search-input-field"
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 40px",
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#f9fafb",
                    fontSize: "13.5px",
                    color: "#1E1B4B",
                    outline: "none",
                    fontWeight: "500",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <button
                onClick={openColumnsModal}
                className="toolbar-icon-btn"
                title="Customize Columns"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "8px",
                  borderRadius: "8px",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "22px",
                    height: "22px",
                    fill: "none",
                    stroke: "#1E1B4B",
                    strokeWidth: "1.8",
                  }}
                >
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button
                onClick={() => setShowFilterModal(true)}
                className="toolbar-icon-btn"
                title="Filter"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "8px",
                  borderRadius: "8px",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: "22px",
                    height: "22px",
                    fill: "none",
                    stroke: "#1E1B4B",
                    strokeWidth: "1.8",
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

          <div className="groups-table-scroll" role="region" aria-label="Filter groups" tabIndex={0}>
          <table
            className="groups-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "16px 20px", width: "40px" }}>
                  <input
                    type="checkbox"
                    checked={selectedGroups.length > 0 && selectedGroups.length === filteredGroups.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedGroups(filteredGroups.map(g => g.id));
                      } else {
                        setSelectedGroups([]);
                      }
                    }}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                </th>
                {columns
                  .filter((c) => c.isVisible)
                  .map((col) => (
                    <th
                      key={col.id}
                      style={{
                        background: "#1E1B4B",
                        padding: "16px 20px",
                        fontWeight: "600",
                        fontSize: "13px",
                        color: "#ffffff",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
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
                    colSpan={columns.filter((c) => c.isVisible).length + 1}
                    style={{
                      padding: "32px",
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
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      transition: "background-color 0.2s ease",
                      background: selectedGroups.includes(group.id) ? "rgba(0, 122, 255, 0.05)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "18px 20px", width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(group.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroups([...selectedGroups, group.id]);
                          } else {
                            setSelectedGroups(selectedGroups.filter(id => id !== group.id));
                          }
                        }}
                        style={{ cursor: "pointer", width: "16px", height: "16px" }}
                      />
                    </td>
                    {columns
                      .filter((c) => c.isVisible)
                      .map((col) => {
                        if (col.id === "name") {
                          return (
                            <td key="name" style={{ padding: "18px 20px" }}>
                              <div className="group-name-content">
                              <button type="button" className="group-favorite-btn" aria-label={`${favoriteGroups.includes(group.id) ? 'Remove' : 'Add'} ${group.name} ${favoriteGroups.includes(group.id) ? 'from' : 'to'} favorites`} aria-pressed={favoriteGroups.includes(group.id)} onClick={() => toggleFavorite(group.id)} style={{ background: 'none', border: 0, cursor: 'pointer', color: '#5B21B6' }}>
                                {favoriteGroups.includes(group.id) ? '★' : '☆'}
                              </button>
                              <div className="group-name-stack">
                              <button
                                onClick={() =>
                                  navigate(`/app/filters/groups/${group.id}`)
                                }
                                className="group-name-btn"
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
                                {group.name}
                              </button>
                              {group.isDefault && (
                                <span
                                  className="badge-default-group"
                                  style={{
                                    marginLeft: "8px",
                                    padding: "3px 10px",
                                    borderRadius: "6px",
                                    background: "rgba(91, 33, 182, 0.08)",
                                    color: "#5B21B6",
                                    fontSize: "10.5px",
                                    fontWeight: "700",
                                    letterSpacing: "0.5px",
                                  }}
                                >
                                  DEFAULT
                                </span>
                              )}
                              </div>
                              </div>
                            </td>
                          );
                        }
                        if (col.id === "collections") {
                          return (
                            <td
                              key="collections"
                              style={{ padding: "18px 20px" }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "6px",
                                }}
                              >
                                {group.collections.filter((c) => c.pageType === "collection").length === 0 && <span className="group-empty-cell">—</span>}
                                {group.collections
                                  .filter((c) => c.pageType === "collection")
                                  .map((c) => (
                                    <span
                                      key={c.id}
                                      className="collection-tag-badge"
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
                            <td key="pages" style={{ padding: "18px 20px" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "6px",
                                }}
                              >
                                {group.collections.filter((c) => c.pageType === "search").length === 0 && <span className="group-empty-cell">—</span>}
                                {group.collections
                                  .filter((c) => c.pageType === "search")
                                  .map((c) => (
                                    <span
                                      key={c.id}
                                      className="collection-tag-badge"
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
                            <td key="status" style={{ padding: "18px 20px" }}>
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
                                  className="toggle-switch-slider"
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    borderRadius: "34px",
                                    backgroundColor: group.status
                                      ? "#10B981"
                                      : "#e2e8f0",
                                    transition: "all 0.3s ease",
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
                            </td>
                          );
                        }
                        if (col.id === "action") {
                          return (
                            <td
                              key="action"
                              style={{
                                padding: "18px 20px",
                                textAlign: "right",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: "8px",
                                  justifyContent: "flex-end",
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  onClick={() =>
                                    navigate(`/app/filters/groups/${group.id}`)
                                  }
                                  className="row-action-btn btn-edit-action"
                                  title="Edit"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: "6px",
                                    borderRadius: "6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
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
                                  className="row-action-btn btn-duplicate-action"
                                  title="Duplicate"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: "6px",
                                    borderRadius: "6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
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
                                    className="row-action-btn btn-delete-action"
                                    title="Delete"
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "6px",
                                      borderRadius: "6px",
                                      display: "inline-flex",
                                      alignItems: "center",
                                    }}
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
        </div>
      </s-stack>

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Create Group Modal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
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
                  <div
                    style={{ marginLeft: "24px", position: "relative" }}
                    className="filter-dropdown-inside"
                  >
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
      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Filter Modal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
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
              borderRadius: "16px",
              padding: "26px",
              width: "700px",
              boxShadow: "0 24px 64px rgba(30, 27, 75, 0.12)",
              position: "relative",
              overflow: "visible",
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
                style={{ width: "20px", height: "20px", fill: "#c9cccf" }}
              >
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2
              style={{
                margin: "0 0 24px",
                fontSize: "18px",
                fontWeight: 700,
                color: "#1E1B4B",
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
                      background: "#ffffff",
                      color: "#1E1B4B",
                      padding: "8px 28px 8px 16px",
                      borderRadius: "10px",
                      border: "1px solid rgba(30, 27, 75, 0.12)",
                      fontSize: "13.5px",
                      fontWeight: "600",
                      outline: "none",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
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
                      stroke: "#1e1b4b",
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
                    border: "1px solid rgba(30, 27, 75, 0.12)",
                    color: "#4b5563",
                    borderRadius: "10px",
                    padding: "8px 16px",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#DB3A5D";
                    e.currentTarget.style.color = "#DB3A5D";
                    e.currentTarget.style.background =
                      "rgba(219, 58, 93, 0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(30, 27, 75, 0.12)";
                    e.currentTarget.style.color = "#4b5563";
                    e.currentTarget.style.background = "#fff";
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
                        background: "#ffffff",
                        color: "#1E1B4B",
                        padding: "10px 32px 10px 16px",
                        borderRadius: "10px",
                        border: "1px solid rgba(30, 27, 75, 0.12)",
                        fontSize: "13.5px",
                        fontWeight: "600",
                        outline: "none",
                        cursor: "pointer",
                        width: "100%",
                        boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
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
                        stroke: "#1e1b4b",
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
                        background: "#ffffff",
                        color: "#1E1B4B",
                        padding: "10px 32px 10px 16px",
                        borderRadius: "10px",
                        border: "1px solid rgba(30, 27, 75, 0.12)",
                        fontSize: "13.5px",
                        fontWeight: "600",
                        outline: "none",
                        cursor: "pointer",
                        width: "100%",
                        boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
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
                        stroke: "#1e1b4b",
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
                          padding: "10px 16px",
                          borderRadius: "10px",
                          border: "1px solid rgba(30, 27, 75, 0.12)",
                          backgroundColor: "#ffffff",
                          fontSize: "13.5px",
                          color: "#1E1B4B",
                          outline: "none",
                          boxSizing: "border-box",
                          boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
                        }}
                      />
                    ) : (
                      <label
                        style={{
                          position: "relative",
                          display: "inline-block",
                          width: "44px",
                          height: "24px",
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
                              cond.value === "true"
                                ? "#10B981"
                                : "rgba(30, 27, 75, 0.12)",
                            borderRadius: "34px",
                            transition: "0.2s",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              height: "18px",
                              width: "18px",
                              left: cond.value === "true" ? "23px" : "3px",
                              bottom: "3px",
                              backgroundColor: "white",
                              transition: "0.2s",
                              borderRadius: "50%",
                              boxShadow: "0 1px 3px rgba(30,27,75,0.1)",
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
                      borderRadius: "8px",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(219, 58, 93, 0.08)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "none")
                    }
                  >
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        width: "18px",
                        height: "18px",
                        fill: "none",
                        stroke: "#DB3A5D",
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
                style={{
                  marginTop: filterConditions.length > 0 ? "12px" : "0",
                }}
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
                    background: "#5B21B6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 24px",
                    fontSize: "14.5px",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    width: filterConditions.length > 0 ? "auto" : "100%",
                    transition: "all 0.2s ease",
                    boxShadow: "0 4px 12px rgba(91, 33, 182, 0.15)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#1E1B4B";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(30, 27, 75, 0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#5B21B6";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(91, 33, 182, 0.15)";
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
                  border: "1px solid rgba(30, 27, 75, 0.12)",
                  borderRadius: "10px",
                  padding: "12px 24px",
                  fontSize: "14.5px",
                  fontWeight: "600",
                  color: "#4b5563",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.color = "#111827";
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.color = "#4b5563";
                  e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)";
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => setShowFilterModal(false)}
                style={{
                  background: "#5B21B6",
                  border: "none",
                  borderRadius: "10px",
                  padding: "12px 32px",
                  fontSize: "14.5px",
                  fontWeight: "700",
                  color: "#fff",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: "0 4px 12px rgba(91, 33, 182, 0.15)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1E1B4B";
                  e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(30, 27, 75, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#5B21B6";
                  e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(91, 33, 182, 0.15)";
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Customize Columns Modal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
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

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Delete Confirm Modal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
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

      {/* Import Modal */}
      <ImportFilterGroupModal 
        isOpen={showImportModal} 
        onClose={() => setShowImportModal(false)} 
        onSubmit={handleImportSubmit}
      />

      <ExportFilterGroupsModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        selectedGroups={selectedGroups}
        allGroups={groups}
      />
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
