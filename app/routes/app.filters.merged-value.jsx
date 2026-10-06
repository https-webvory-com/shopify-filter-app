import { useNavigate } from "react-router";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { invalidateShop } from "../services/shopCache.server";

// â”€â”€ Loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const sort = url.searchParams.get("sort") || "newest";
  const search = url.searchParams.get("q") || "";
  const limit = 20;
  const skip = (page - 1) * limit;

  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let orderBy = [{ createdAt: "desc" }];
  if (sort === "oldest") {
    orderBy = [{ createdAt: "asc" }];
  }

  const whereClause = { shop };
  if (search) {
    whereClause.OR = [
      { targetValue: { contains: search } },
      { filterType: { contains: search } }
    ];
  }

  const [rules, totalRules, products] = await Promise.all([
    prisma.mergedValue.findMany({
      where: whereClause,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.mergedValue.count({ where: whereClause }),
    prisma.product.findMany({
      where: { shop },
      select: { options: true },
    }),
  ]);

  // Detect available product options
  const optionNames = new Set();
  for (const p of products) {
    for (const opt of p.options || []) {
      if (opt.name) optionNames.add(opt.name);
    }
  }

  // Fetch shopify collections
  let shopifyCollections = [];
  let shopifyLocations = [];
  try {
    const graphqlQuery = await admin.graphql(`
      #graphql
      query {
        collections(first: 50, query: "published_status:published") { nodes { title } }
        locations(first: 250, includeInactive: true) { nodes { id name } }
        shop { fulfillmentServices { location { id name } } }
      }
    `);
    const graphqlData = await graphqlQuery.json();
    shopifyCollections =
      graphqlData?.data?.collections?.nodes?.map((c) => c.title).sort() || [];

    const allLocsMap = new Map();
    graphqlData?.data?.locations?.nodes?.forEach((l) =>
      allLocsMap.set(l.id, l.name),
    );
    graphqlData?.data?.shop?.fulfillmentServices?.forEach((fs) => {
      if (fs.location) allLocsMap.set(fs.location.id, fs.location.name);
    });
    shopifyLocations = Array.from(allLocsMap.values()).sort();
  } catch (err) {
    console.error("Error fetching collections or locations:", err);
  }

  // Fetch unique vendors and product types
  const vendors = await prisma.product.groupBy({
    by: ["vendor"],
    where: { shop, vendor: { not: "" } },
  });
  const productTypes = await prisma.product.groupBy({
    by: ["productType"],
    where: { shop, productType: { not: "" } },
  });
  const tagsRaw = await prisma.$queryRaw`
    SELECT DISTINCT unnest(tags) as tag
    FROM "Product"
    WHERE shop = ${shop}
  `;
  const tagsList = tagsRaw.map(t => t.tag.trim()).sort();

  const optionsRaw = await prisma.$queryRaw`
    SELECT DISTINCT 
      LOWER(opt->>'name') as name,
      jsonb_array_elements_text(opt->'values') as value
    FROM "Product" p,
    jsonb_array_elements(p.options) as opt
    WHERE p.shop = ${shop}
  `;
  const optionsMap = new Map();
  optionsRaw.forEach(row => {
    if (!optionsMap.has(row.name)) optionsMap.set(row.name, new Set());
    optionsMap.get(row.name).add(row.value.trim());
  });

  const storeData = {
    collection: shopifyCollections,
    vendor: vendors.map((v) => v.vendor).sort(),
    product_type: productTypes.map((p) => p.productType).sort(),
    tags: tagsList,
    inventory_locations: shopifyLocations,
    options: Array.from(optionsMap.entries()).reduce((acc, [name, valSet]) => {
      acc[name] = Array.from(valSet).sort();
      return acc;
    }, {}),
  };

  const pagination = {
    currentPage: page,
    totalPages: Math.ceil(totalRules / limit),
    totalItems: totalRules,
    sort,
    search,
  };

  return {
    rules,
    optionNames: Array.from(optionNames).sort(),
    storeData,
    pagination,
  };
};

// â”€â”€ Action â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add") {
    const filterType = formData.get("filterType");
    const filterKey = formData.get("filterKey") || null;
    const targetValue = formData.get("targetValue");
    const sourceValues = formData
      .get("sourceValues")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    await prisma.mergedValue.create({
      data: { shop, filterType, filterKey, targetValue, sourceValues },
    });
    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "add_bulk") {
    const filterType = formData.get("filterType");
    const filterKey = formData.get("filterKey") || null;
    const rulesJson = formData.get("rules");

    if (rulesJson) {
      const parsedRules = JSON.parse(rulesJson);
      for (const rule of parsedRules) {
        if (!rule.targetValue || !rule.sourceValues) continue;
        const sourceValues = rule.sourceValues
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (sourceValues.length > 0) {
          await prisma.mergedValue.create({
            data: {
              shop,
              filterType,
              filterKey,
              targetValue: rule.targetValue,
              sourceValues,
            },
          });
        }
      }
    }
    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "update") {
    const id = formData.get("id");
    const targetValue = formData.get("targetValue");
    const sourceValues = formData
      .get("sourceValues")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    await prisma.mergedValue.update({
      where: { id },
      data: { targetValue, sourceValues },
    });
    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "delete") {
    const id = formData.get("id");
    await prisma.mergedValue.delete({ where: { id } });
    invalidateShop(shop);
    return { success: true, intent };
  }

  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await prisma.mergedValue.update({
      where: { id },
      data: { isActive },
    });
    invalidateShop(shop);
    return { success: true, intent };
  }

  return { success: false };
};

// â”€â”€ Custom UI Components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const OPTION_TYPES = [
  { value: "collection", label: "Collections" },
  { value: "vendor", label: "Vendor" },
  { value: "product_type", label: "Product type" },
  { value: "tags", label: "Tags" },
  { value: "color", label: "Color (product option)" },
  { value: "size", label: "Size (product option)" },
  { value: "slot", label: "slot (product option)" },
  { value: "title", label: "Title (product option)" },
  { value: "inventory_locations", label: "Locations" },
];

const OptionTypeDropdown = ({ value, onChange, optionNames = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const dynamicOptions = [...OPTION_TYPES];
  optionNames.forEach((name) => {
    const v = name.toLowerCase();
    if (!dynamicOptions.find((o) => o.value === v)) {
      dynamicOptions.push({ value: name, label: `${name} (product option)` });
    }
  });

  const selectedLabel =
    dynamicOptions.find((o) => o.value === value || o.label === value)?.label ||
    value ||
    "Select option type";

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%" }} ref={dropdownRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: "10px",
          border: "1px solid rgba(30, 27, 75, 0.12)",
          background: "#ffffff",
          color: "#1E1B4B",
          fontSize: "13.5px",
          fontWeight: "600",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
          transition: "all 0.2s ease",
          boxSizing: "border-box",
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#5B21B6"}
        onMouseLeave={(e) => !isOpen && (e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)")}
      >
        {selectedLabel}
        <svg
          viewBox="0 0 20 20"
          style={{
            width: "12px",
            height: "12px",
            fill: "#1e1b4b",
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "0.2s",
          }}
        >
          <path d="M10 13a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 10 13z" />
        </svg>
      </div>

      {isOpen && (
        <div
          className="reorder-scroll-container"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "8px",
            background: "#fff",
            borderRadius: "10px",
            boxShadow: "0 10px 30px rgba(30, 27, 75, 0.08)",
            border: "1px solid rgba(30, 27, 75, 0.08)",
            zIndex: 1000,
            padding: "6px 0",
            maxHeight: "240px",
            overflowY: "auto",
          }}
        >
          {dynamicOptions.map((opt) => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: "10px 20px",
                cursor: "pointer",
                fontSize: "13.5px",
                fontWeight: "600",
                color: value === opt.value ? "#5B21B6" : "#1e1b4b",
                background: value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                e.currentTarget.style.color = "#5B21B6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent";
                e.currentTarget.style.color = value === opt.value ? "#5B21B6" : "#1e1b4b";
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AutocompleteInput = ({
  value,
  onChange,
  placeholder,
  suggestions = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const dropdownRef = useRef(null);

  const selectedValues = value
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

  const filteredSuggestions = suggestions.filter(
    (s) => s.toLowerCase().includes(inputValue.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e) => {
    setInputValue(e.target.value);
    setIsOpen(true);
  };

  const handleToggle = (val) => {
    if (selectedValues.includes(val)) {
      const newValues = selectedValues.filter((v) => v !== val);
      onChange(newValues.join(", "));
    } else {
      const newValues = [...selectedValues, val];
      onChange(newValues.join(", "));
    }
    // Keep input value if they are filtering, otherwise let them continue checking
  };

  const handleRemove = (valToRemove) => {
    const newValues = selectedValues.filter((v) => v !== valToRemove);
    onChange(newValues.join(", "));
  };

  return (
    <div
      style={{
        position: "relative",
        flex: 7,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
      ref={dropdownRef}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={inputValue}
        onChange={handleChange}
        onClick={() => setIsOpen(true)}
        style={{
          width: "100%",
          padding: "10px 16px",
          background: "#ffffff",
          border: "1px solid rgba(30, 27, 75, 0.12)",
          borderRadius: "10px",
          fontSize: "13.5px",
          color: "#1E1B4B",
          outline: "none",
          boxSizing: "border-box",
          boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
          transition: "all 0.2s ease",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "#5B21B6";
          e.target.style.boxShadow = "0 0 0 3px rgba(91, 33, 182, 0.1)";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "rgba(30, 27, 75, 0.12)";
          e.target.style.boxShadow = "none";
        }}
      />

      {selectedValues.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", overflowWrap: "anywhere" }}>
          {selectedValues.map((val) => (
            <div key={val} className="autocomplete-tag">
              <span>{val}</span>
              <button
                type="button"
                onClick={() => handleRemove(val)}
                className="autocomplete-tag-remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {isOpen &&
        (filteredSuggestions.length > 0 || suggestions.length === 0) && (
          <div
            className="reorder-scroll-container"
            style={{
              position: "absolute",
              top: "42px",
              left: 0,
              right: 0,
              marginTop: "8px",
              background: "#fff",
              borderRadius: "10px",
              boxShadow: "0 10px 30px rgba(30, 27, 75, 0.08)",
              border: "1px solid rgba(30, 27, 75, 0.08)",
              zIndex: 1000,
              padding: "6px 0",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {filteredSuggestions.length > 0 ? (
              filteredSuggestions.map((s, i) => {
                const isSelected = selectedValues.includes(s);
                return (
                  <div
                    key={i}
                    onClick={(e) => {
                      e.preventDefault();
                      handleToggle(s);
                    }}
                    style={{
                      padding: "10px 20px",
                      cursor: "pointer",
                      fontSize: "13.5px",
                      fontWeight: "600",
                      color: "#1e1b4b",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      borderBottom:
                        i < filteredSuggestions.length - 1
                          ? "1px solid rgba(30, 27, 75, 0.04)"
                          : "none",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "4px",
                      border: isSelected ? "none" : "1px solid #d1d5db",
                      background: isSelected ? "#5B21B6" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill="white"/>
                        </svg>
                      )}
                    </div>
                    <span>{s}</span>
                  </div>
                );
              })
            ) : (
              <div
                style={{
                  padding: "12px 20px",
                  fontSize: "13.5px",
                  color: "#8c9196",
                }}
              >
                No items found
              </div>
            )}
          </div>
        )}
    </div>
  );
};

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function MergedValues() {
  const { rules, optionNames, storeData, pagination } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const isLoading = navigation.state !== "idle";
  const actionData = useActionData();

  const [searchValue, setSearchValue] = useState(pagination?.search || "");

  useEffect(() => {
    setSearchValue(pagination?.search || "");
  }, [pagination?.search]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchValue !== (pagination?.search || "")) {
        const url = new URL(window.location.href);
        if (searchValue) {
          url.searchParams.set("q", searchValue);
        } else {
          url.searchParams.delete("q");
        }
        url.searchParams.set("page", "1");
        navigate(url.pathname + url.search);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [searchValue, navigate, pagination?.search]);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle") {
      if (actionData.intent === "add_bulk" || actionData.intent === "add") {
        shopify.toast.show("Merged values created successfully");
        setShowModal(false);
      } else if (actionData.intent === "update") {
        shopify.toast.show("Merged value updated successfully");
        setShowModal(false);
      } else if (actionData.intent === "delete") {
        shopify.toast.show("Merged value deleted successfully");
      } else if (actionData.intent === "toggle_status") {
        shopify.toast.show("Status updated successfully");
      }
    }
  }, [actionData, navigation.state, shopify]);

  // Add/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null); // null = add, object = edit
  const [deletingId, setDeletingId] = useState(null); // For delete modal
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) {
        setIsSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [filterTitle, setFilterTitle] = useState("");
  const [filterType, setFilterType] = useState("");
  const [valueRows, setValueRows] = useState([
    { sourceValues: "", targetValue: "" },
  ]);

  const openAdd = () => {
    setEditingRule(null);
    setFilterTitle("");
    setFilterType("");
    setValueRows([{ sourceValues: "", targetValue: "" }]);
    setShowModal(true);
  };

  const openEdit = (rule) => {
    setEditingRule(rule);
    setFilterTitle(rule.filterKey || "");
    setFilterType(rule.filterType);
    setValueRows([
      {
        sourceValues: rule.sourceValues.join(", "),
        targetValue: rule.targetValue,
      },
    ]);
    setShowModal(true);
  };

  const handleAddRow = () => {
    setValueRows([...valueRows, { sourceValues: "", targetValue: "" }]);
  };

  const handleRowChange = (index, field, value) => {
    const newRows = [...valueRows];
    newRows[index][field] = value;
    setValueRows(newRows);
  };

  const handleRemoveRow = (index) => {
    const newRows = valueRows.filter((_, i) => i !== index);
    setValueRows(newRows);
  };

  const handleSubmit = () => {
    if (!filterTitle.trim()) {
      shopify.toast.show("Please enter a Title for this group", {
        isError: true,
      });
      return;
    }
    if (!filterType.trim()) {
      shopify.toast.show("Please select an Option type", { isError: true });
      return;
    }

    if (editingRule) {
      const row = valueRows[0];
      if (!row.targetValue.trim() || !row.sourceValues.trim()) {
        shopify.toast.show(
          "Please fill out both values to merge and merged value",
          { isError: true },
        );
        return;
      }
      submit(
        {
          intent: "update",
          id: editingRule.id,
          targetValue: row.targetValue,
          sourceValues: row.sourceValues,
        },
        { method: "POST" },
      );
    } else {
      const validRows = valueRows.filter(
        (r) => r.targetValue.trim() && r.sourceValues.trim(),
      );
      if (validRows.length === 0) {
        shopify.toast.show("Please fill out at least one row completely", {
          isError: true,
        });
        return;
      }
      submit(
        {
          intent: "add_bulk",
          filterType,
          filterKey: filterTitle,
          rules: JSON.stringify(validRows),
        },
        { method: "POST" },
      );
    }
  };

  const handleDelete = (id) => {
    setDeletingId(id);
  };

  const confirmDelete = () => {
    if (!deletingId) return;
    submit({ intent: "delete", id: deletingId }, { method: "POST" });
    setDeletingId(null);
  };

  // Group rules by filterType for display
  const grouped = rules.reduce((acc, rule) => {
    if (!acc[rule.filterType]) acc[rule.filterType] = [];
    acc[rule.filterType].push(rule);
    return acc;
  }, {});

  return (
    <div className="merged-values-page">
      <style dangerouslySetInnerHTML={{ __html: `
        /* General Premium Layout */
        .merged-values-page {
          background: #f8f9fc !important;
          min-height: calc(100vh - 56px) !important;
          display: flex !important;
          flex-direction: column !important;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        }
        .merged-values-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          padding: 20px 32px !important;
          background: #ffffff !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          box-shadow: 0 2px 8px rgba(30, 27, 75, 0.02) !important;
        }
        .header-count-badge {
          font-size: 15px !important;
          color: #5B21B6 !important;
          font-weight: 700 !important;
          background: rgba(91, 33, 182, 0.06) !important;
          padding: 12px 20px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .btn-merge-action {
          background: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 12px 26px !important;
          font-size: 15px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          line-height: 1.2 !important;
        }
        .btn-merge-action:hover {
          background: #1E1B4B !important;
          box-shadow: 0 4px 12px rgba(30, 27, 75, 0.2) !important;
          transform: translateY(-1px) !important;
        }
        .merged-values-page .btn-reorder-cancel {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          border-radius: 10px !important;
          padding: 12px 24px !important;
          font-size: 15px !important;
          font-weight: 600 !important;
          color: #4b5563 !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          line-height: 1.2 !important;
        }
        .merged-values-page .btn-reorder-cancel:hover {
          background: #f9fafb !important;
          color: #111827 !important;
          border-color: #d1d5db !important;
        }
        .merged-values-page .btn-reorder-save {
          background: #5B21B6 !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 12px 26px !important;
          font-size: 15px !important;
          font-weight: 700 !important;
          color: #ffffff !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
          line-height: 1.2 !important;
        }
        .merged-values-page .btn-reorder-save:hover {
          background: #1E1B4B !important;
          box-shadow: 0 4px 12px rgba(30, 27, 75, 0.2) !important;
          transform: translateY(-1px) !important;
        }
        .search-select-dropdown {
          padding: 9px 14px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          background: #ffffff !important;
          color: #1E1B4B !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          outline: none !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .search-select-dropdown:focus {
          border-color: #5B21B6 !important;
        }
        .search-input-box {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          padding: 9px 16px 9px 40px !important;
          border-radius: 10px !important;
          font-size: 13.5px !important;
          color: #1E1B4B !important;
          width: 240px !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
          font-weight: 500 !important;
        }
        .search-input-box:focus {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1) !important;
        }
        
        /* Empty State */
        .empty-state-container {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          flex: 1 !important;
          padding: 100px 40px !important;
          text-align: center !important;
          background: #ffffff !important;
        }
        .empty-state-title {
          font-size: 42px !important;
          font-weight: 800 !important;
          color: #1E1B4B !important;
          margin-bottom: 16px !important;
          letter-spacing: -0.5px !important;
        }
        .empty-state-subtitle {
          font-size: 16px !important;
          color: #6d7175 !important;
          margin-bottom: 32px !important;
          font-weight: 500 !important;
        }

        /* Group rules cards list */
        .merge-group-card {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: hidden !important;
          margin-bottom: 28px !important;
        }
        .merge-group-header {
          padding: 16px 24px !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
        }
        .merge-group-badge {
          padding: 4px 10px !important;
          border-radius: 20px !important;
          background: rgba(91, 33, 182, 0.06) !important;
          font-size: 11.5px !important;
          color: #5B21B6 !important;
          font-weight: 700 !important;
          border: 1px solid rgba(91, 33, 182, 0.1) !important;
        }

        /* Merge table styling */
        .merge-table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .merge-table th {
          background: #1E1B4B !important;
          border-bottom: 3px solid #5B21B6 !important;
          padding: 16px 24px !important;
          font-weight: 700 !important;
          font-size: 12.5px !important;
          color: #ffffff !important;
          text-transform: uppercase !important;
          letter-spacing: 0.8px !important;
          text-align: left !important;
        }
        .merge-table td {
          padding: 18px 24px !important;
          font-size: 14px !important;
        }
        .merge-table tr {
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          transition: background-color 0.2s ease !important;
        }
        .merge-table tr:hover {
          background-color: rgba(91, 33, 182, 0.02) !important;
        }
        
        /* Badges */
        .badge-target-val {
          padding: 5px 12px !important;
          border-radius: 8px !important;
          background-color: rgba(16, 185, 129, 0.08) !important;
          border: 1px solid rgba(16, 185, 129, 0.2) !important;
          color: #10B981 !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          display: inline-flex !important;
        }
        .badge-source-pill {
          padding: 4px 10px !important;
          border-radius: 6px !important;
          background-color: rgba(91, 33, 182, 0.05) !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          font-size: 12px !important;
          color: #5B21B6 !important;
          font-weight: 600 !important;
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
        .row-action-delete:hover {
          background-color: #DB3A5D !important;
          border-color: #DB3A5D !important;
          transform: scale(1.15) !important;
          box-shadow: 0 4px 12px rgba(219, 58, 93, 0.25) !important;
        }
        .row-action-delete:hover svg {
          fill: #ffffff !important;
        }

        /* Autocomplete tags */
        .autocomplete-tag {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          padding: 5px 12px !important;
          background: #5B21B6 !important;
          color: #ffffff !important;
          border-radius: 20px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          box-shadow: 0 2px 6px rgba(91, 33, 182, 0.15) !important;
        }
        .autocomplete-tag-remove {
          background: none !important;
          border: none !important;
          color: rgba(255, 255, 255, 0.8) !important;
          cursor: pointer !important;
          font-size: 14px !important;
          display: flex !important;
          align-items: center !important;
          padding: 0 !important;
          transition: color 0.2s ease !important;
        }
        .autocomplete-tag-remove:hover {
          color: #ffffff !important;
        }

        /* Modals */
        .merged-modal-overlay {
          position: fixed !important;
          inset: 0 !important;
          background: rgba(15, 23, 42, 0.6) !important;
          backdrop-filter: blur(4px) !important;
          display: flex !important;
          align-items: flex-start !important;
          justify-content: center !important;
          z-index: 99999 !important;
          padding: 40px 20px !important;
          overflow-y: auto !important;
        }
        .merged-modal-card {
          background: #ffffff !important;
          border-radius: 16px !important;
          padding: 26px !important;
          width: 100% !important;
          max-width: 800px !important;
          margin: 0 auto !important;
          overflow: visible !important;
          box-shadow: 0 24px 64px rgba(30, 27, 75, 0.12) !important;
          position: relative !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 24px !important;
        }
        .merged-modal-title {
          margin: 0 !important;
          font-size: 20px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
        }
        .merged-modal-note {
          background: rgba(91, 33, 182, 0.03) !important;
          border-left: 3px solid #5B21B6 !important;
          padding: 14px 20px !important;
          border-radius: 10px !important;
          font-size: 13.5px !important;
          color: #4b5563 !important;
          line-height: 1.6 !important;
        }
        .merged-modal-input-label {
          display: block !important;
          font-size: 11px !important;
          color: #1E1B4B !important;
          font-weight: 700 !important;
          margin-bottom: 8px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.5px !important;
        }

        /* Pagination Controls */
        .pagination-container {
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          gap: 16px !important;
          padding: 24px 0 !important;
        }
        .pagination-btn {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          border-radius: 10px !important;
          padding: 8px 18px !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          color: #1E1B4B !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .pagination-btn:hover:not(:disabled) {
          border-color: #5B21B6 !important;
          color: #5B21B6 !important;
          background: rgba(91, 33, 182, 0.04) !important;
        }
        .pagination-btn:disabled {
          opacity: 0.4 !important;
          cursor: not-allowed !important;
        }

        /* Custom scrollbar */
        .reorder-scroll-container::-webkit-scrollbar,
        .merged-modal-card::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-track,
        .merged-modal-card::-webkit-scrollbar-track {
          background: rgba(30, 27, 75, 0.02) !important;
          border-radius: 10px !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-thumb,
        .merged-modal-card::-webkit-scrollbar-thumb {
          background: rgba(30, 27, 75, 0.15) !important;
          border-radius: 10px !important;
          transition: background 0.2s ease !important;
        }
        .reorder-scroll-container::-webkit-scrollbar-thumb:hover,
        .merged-modal-card::-webkit-scrollbar-thumb:hover {
          background: #5B21B6 !important;
        }

        /* Delete modal card */
        .delete-modal-card {
          background: #ffffff !important;
          border-radius: 16px !important;
          width: 440px !important;
          padding: 26px !important;
          box-shadow: 0 20px 50px rgba(30, 27, 75, 0.15) !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
        }
        .delete-modal-title {
          margin: 0 0 12px 0 !important;
          font-size: 18px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
        }
        .delete-modal-body {
          margin: 0 0 26px 0 !important;
          font-size: 14.5px !important;
          color: #4b5563 !important;
          line-height: 1.6 !important;
        }
      ` }} />



      {/* Premium Header */}
      <div className="merged-values-header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => navigate("/app/filters")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              borderRadius: "8px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(30, 27, 75, 0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
            }}
            title="Back to Filters"
          >
            <svg
              viewBox="0 0 20 20"
              style={{ width: "20px", height: "20px", fill: "#1E1B4B" }}
            >
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="header-count-badge">
            Filter options ({rules.length})
          </span>
          <button onClick={openAdd} className="btn-merge-action">
            Add merge value
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Custom Sort Dropdown */}
          <div style={{ position: "relative", width: "160px" }} ref={sortRef}>
            <div
              onClick={() => setIsSortOpen(!isSortOpen)}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "10px",
                border: "1px solid rgba(30, 27, 75, 0.12)",
                background: "#ffffff",
                color: "#1E1B4B",
                fontSize: "13.5px",
                fontWeight: "600",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
                transition: "all 0.2s ease",
                boxSizing: "border-box",
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = "#5B21B6"}
              onMouseLeave={(e) => !isSortOpen && (e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)")}
            >
              {pagination?.sort === "oldest" ? "Oldest first" : "Newest first"}
              <svg
                viewBox="0 0 20 20"
                style={{
                  width: "12px",
                  height: "12px",
                  fill: "#1e1b4b",
                  transform: isSortOpen ? "rotate(180deg)" : "none",
                  transition: "0.2s",
                }}
              >
                <path d="M10 13a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 10 13z" />
              </svg>
            </div>

            {isSortOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "8px",
                  background: "#fff",
                  borderRadius: "10px",
                  boxShadow: "0 10px 30px rgba(30, 27, 75, 0.08)",
                  border: "1px solid rgba(30, 27, 75, 0.08)",
                  zIndex: 1000,
                  padding: "6px 0",
                }}
              >
                <div
                  onClick={() => {
                    navigate(`?page=1&sort=newest`);
                    setIsSortOpen(false);
                  }}
                  style={{
                    padding: "10px 20px",
                    cursor: "pointer",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    color: pagination?.sort !== "oldest" ? "#5B21B6" : "#1e1b4b",
                    background: pagination?.sort !== "oldest" ? "rgba(91, 33, 182, 0.05)" : "transparent",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                    e.currentTarget.style.color = "#5B21B6";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = pagination?.sort !== "oldest" ? "rgba(91, 33, 182, 0.05)" : "transparent";
                    e.currentTarget.style.color = pagination?.sort !== "oldest" ? "#5B21B6" : "#1e1b4b";
                  }}
                >
                  Newest first
                </div>
                <div
                  onClick={() => {
                    navigate(`?page=1&sort=oldest`);
                    setIsSortOpen(false);
                  }}
                  style={{
                    padding: "10px 20px",
                    cursor: "pointer",
                    fontSize: "13.5px",
                    fontWeight: "600",
                    color: pagination?.sort === "oldest" ? "#5B21B6" : "#1e1b4b",
                    background: pagination?.sort === "oldest" ? "rgba(91, 33, 182, 0.05)" : "transparent",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                    e.currentTarget.style.color = "#5B21B6";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = pagination?.sort === "oldest" ? "rgba(91, 33, 182, 0.05)" : "transparent";
                    e.currentTarget.style.color = pagination?.sort === "oldest" ? "#5B21B6" : "#1e1b4b";
                  }}
                >
                  Oldest first
                </div>
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <svg
              style={{
                position: "absolute",
                left: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "16px",
                height: "16px",
                fill: "#5B21B6",
              }}
              viewBox="0 0 20 20"
            >
              <path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="search-input-box"
            />
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: rules.length === 0 ? "0" : "32px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Empty State */}
        {rules.length === 0 ? (
          <div className="empty-state-container">
            <h1 className="empty-state-title">Merge filter values</h1>
            <p className="empty-state-subtitle">
              Stack similar values under the same value category
            </p>
            <button onClick={openAdd} className="btn-merge-action" style={{ padding: "12px 26px", borderRadius: "10px" }}>
              Add merge value
            </button>
          </div>
        ) : (
          Object.entries(grouped).map(([type, typeRules]) => (
            <div key={type} className="merge-group-card">
              {/* Group header */}
              <div className="merge-group-header">
                <svg
                  viewBox="0 0 20 20"
                  style={{ width: "15px", height: "15px", fill: "#5B21B6" }}
                >
                  <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
                </svg>
                <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#1E1B4B" }}>
                  {type}
                </span>
                <span className="merge-group-badge">
                  {typeRules.length} {typeRules.length === 1 ? "rule" : "rules"}
                </span>
              </div>

              <table className="merge-table">
                <thead>
                  <tr>
                    <th>Show as (Target Value)</th>
                    <th>Raw values to merge</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {typeRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <span className="badge-target-val">
                          {rule.targetValue}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {rule.sourceValues.map((val) => (
                            <span key={val} className="badge-source-pill">
                              {val}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div
                          onClick={() => {
                            submit(
                              {
                                intent: "toggle_status",
                                id: rule.id,
                                isActive: !rule.isActive,
                              },
                              { method: "POST" },
                            );
                          }}
                          style={{
                            width: "36px",
                            height: "20px",
                            backgroundColor: rule.isActive
                              ? "#10B981"
                              : "#e2e8f0",
                            borderRadius: "10px",
                            position: "relative",
                            cursor: isLoading ? "not-allowed" : "pointer",
                            display: "inline-block",
                            transition: "background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                            opacity: isLoading ? 0.7 : 1,
                          }}
                        >
                          <div
                            style={{
                              width: "16px",
                              height: "16px",
                              backgroundColor: "#fff",
                              borderRadius: "50%",
                              position: "absolute",
                              top: "2px",
                              left: rule.isActive ? "18px" : "2px",
                              transition: "left 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                              boxShadow: "0 1px 3px rgba(30,27,75,0.2)",
                            }}
                          />
                        </div>
                      </td>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: "10px",
                            justifyContent: "flex-end",
                            alignItems: "center",
                          }}
                        >
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(rule)}
                            className="row-action-btn-small row-action-edit"
                            title="Edit"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{ width: "15px", height: "15px" }}
                            >
                              <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828z" />
                              <path d="M3 16h14v2H3v-2z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(rule.id)}
                            className="row-action-btn-small row-action-delete"
                            title="Delete"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              style={{ width: "15px", height: "15px" }}
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
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div className="pagination-container">
          <button
            disabled={pagination.currentPage <= 1 || isLoading}
            onClick={() => {
              const u = new URL(window.location.href);
              u.searchParams.set("page", pagination.currentPage - 1);
              navigate(u.pathname + u.search);
            }}
            className="pagination-btn"
          >
            Previous
          </button>
          <span style={{ fontSize: "14px", fontWeight: "600", color: "#1E1B4B" }}>
            Page {pagination.currentPage} of {pagination.totalPages}
          </span>
          <button
            disabled={pagination.currentPage >= pagination.totalPages || isLoading}
            onClick={() => {
              const u = new URL(window.location.href);
              u.searchParams.set("page", pagination.currentPage + 1);
              navigate(u.pathname + u.search);
            }}
            className="pagination-btn"
          >
            Next
          </button>
        </div>
      )}

      {/* â”€â”€ Add / Edit Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {showModal && (
        <div className="merged-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="merged-modal-card">
            <button
              onClick={() => setShowModal(false)}
              style={{
                position: "absolute",
                top: "24px",
                right: "24px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#c9cccf" }}>
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2 className="merged-modal-title">Define merged values</h2>

            <div className="merged-modal-note">
              <strong style={{ color: "#1E1B4B", display: "block", marginBottom: "4px" }}>
                Note:
              </strong>
              Do not merge one value several times. For example, it's impossible
              to merge "Black/White" + "Black" into "Black" and "Black/White" +
              "White" into "White".
            </div>

            {/* Title */}
            <div>
              <label className="merged-modal-input-label">Title</label>
              <input
                type="text"
                placeholder="Title for this group"
                value={filterTitle}
                onChange={(e) => setFilterTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "#ffffff",
                  border: "1px solid rgba(30, 27, 75, 0.12)",
                  borderRadius: "10px",
                  fontSize: "13.5px",
                  color: "#1E1B4B",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#5B21B6";
                  e.target.style.boxShadow = "0 0 0 3px rgba(91, 33, 182, 0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(30, 27, 75, 0.12)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Option Type */}
            <div style={{ zIndex: 101 }}>
              <label className="merged-modal-input-label">Option type</label>
              <OptionTypeDropdown
                value={filterType}
                onChange={(newType) => {
                  setFilterType(newType);
                  setValueRows([{ sourceValues: "", targetValue: "" }]);
                }}
                optionNames={optionNames}
              />
            </div>

            {/* Value Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", zIndex: 100 }}>
              {valueRows.map((row, index) => {
                // Determine suggestions based on filterType
                let suggestions = [];
                if (filterType === "collection")
                  suggestions = storeData?.collection || [];
                else if (filterType === "vendor")
                  suggestions = storeData?.vendor || [];
                else if (filterType === "product_type")
                  suggestions = storeData?.product_type || [];
                else if (filterType === "tags")
                  suggestions = storeData?.tags || [];
                else if (filterType === "inventory_locations")
                  suggestions = storeData?.inventory_locations || [];
                else if (
                  storeData?.options &&
                  storeData.options[filterType.toLowerCase()]
                ) {
                  suggestions = storeData.options[filterType.toLowerCase()];
                }

                return (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      gap: "16px",
                      alignItems: "flex-start",
                      position: "relative",
                      zIndex: 100 - index,
                    }}
                  >
                    <AutocompleteInput
                      placeholder="Select values to merge"
                      value={row.sourceValues}
                      onChange={(val) =>
                        handleRowChange(index, "sourceValues", val)
                      }
                      suggestions={suggestions}
                    />
                    <input
                      type="text"
                      placeholder="Merged value"
                      value={row.targetValue}
                      onChange={(e) =>
                        handleRowChange(index, "targetValue", e.target.value)
                      }
                      style={{
                        flex: "3",
                        minWidth: 0,
                        boxSizing: "border-box",
                        padding: "10px 16px",
                        background: "#ffffff",
                        border: "1px solid rgba(30, 27, 75, 0.12)",
                        borderRadius: "10px",
                        fontSize: "13.5px",
                        color: "#1E1B4B",
                        outline: "none",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "#5B21B6";
                        e.target.style.boxShadow = "0 0 0 3px rgba(91, 33, 182, 0.1)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(30, 27, 75, 0.12)";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                    {valueRows.length > 1 && !editingRule && (
                      <button
                        onClick={() => handleRemoveRow(index)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "6px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "8px",
                          color: "#8c9196",
                          transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(219, 58, 93, 0.08)";
                          e.currentTarget.style.color = "#DB3A5D";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "#8c9196";
                        }}
                      >
                        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}>
                          <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM6 9v2h8V9H6z" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}

              {!editingRule && (
                <div style={{ marginTop: "4px" }}>
                  <button onClick={handleAddRow} className="btn-merge-action" style={{ fontSize: "14.5px", padding: "12px 24px", borderRadius: "10px" }}>
                    <svg viewBox="0 0 20 20" style={{ width: "14px", height: "14px", fill: "#fff" }}>
                      <path d="M11 9H15V11H11V15H9V11H5V9H9V5H11V9Z" />
                    </svg>
                    Add merged value
                  </button>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", marginTop: "16px" }}>
              <button onClick={() => setShowModal(false)} className="btn-reorder-cancel">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={isLoading} className="btn-reorder-save">
                {isLoading ? "Saving..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="merged-modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeletingId(null)}>
          <div className="delete-modal-card">
            <h2 className="delete-modal-title">Delete merged value?</h2>
            <p className="delete-modal-body">
              Are you sure you want to delete this merged value? This action cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setDeletingId(null)} disabled={isLoading} className="btn-reorder-cancel">
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isLoading}
                className="btn-reorder-save"
                style={{ background: "#DB3A5D", boxShadow: "0 4px 12px rgba(219, 58, 93, 0.15)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#b91c1c"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#DB3A5D"}
              >
                {isLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
