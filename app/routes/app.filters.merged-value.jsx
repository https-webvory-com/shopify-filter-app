import { useState, useRef, useEffect } from "react";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useNavigate,
  useActionData,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";

// ── Loader ───────────────────────────────────────────────────────────
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
  const allProducts = await prisma.product.findMany({
    where: { shop },
    select: { tags: true, options: true },
  });

  const tagsMap = new Set();
  const optionsMap = new Map();

  allProducts.forEach((p) => {
    if (p.tags && Array.isArray(p.tags)) {
      p.tags.forEach((t) => {
        if (t) tagsMap.add(t);
      });
    }

    if (p.options && Array.isArray(p.options)) {
      p.options.forEach((opt) => {
        if (opt.name && opt.values) {
          const optNameLower = opt.name.toLowerCase();
          if (!optionsMap.has(optNameLower))
            optionsMap.set(optNameLower, new Set());
          opt.values.forEach((v) => optionsMap.get(optNameLower).add(v));
        }
      });
    }
  });

  const storeData = {
    collection: shopifyCollections,
    vendor: vendors.map((v) => v.vendor).sort(),
    product_type: productTypes.map((p) => p.productType).sort(),
    tags: Array.from(tagsMap).sort(),
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

// ── Action ───────────────────────────────────────────────────────────
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
    return { success: true, intent };
  }

  if (intent === "delete") {
    const id = formData.get("id");
    await prisma.mergedValue.delete({ where: { id } });
    return { success: true, intent };
  }

  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await prisma.mergedValue.update({
      where: { id },
      data: { isActive },
    });
    return { success: true, intent };
  }

  return { success: false };
};

// ── Custom UI Components ────────────────────────────────────────────────
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

  // Build dynamic options combining predefined and actual optionNames
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
          padding: "12px 20px",
          borderRadius: "20px",
          border: "none",
          background: "#f4f8ff",
          color: "#007bff",
          fontSize: "13px",
          fontWeight: "600",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {selectedLabel}
        <svg
          viewBox="0 0 20 20"
          style={{
            width: "12px",
            height: "12px",
            fill: "currentColor",
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "0.2s",
          }}
        >
          <path d="M10 13a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 10 13z" />
        </svg>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "8px",
            background: "#fff",
            borderRadius: "8px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            border: "1px solid #e1e3e5",
            zIndex: 1000,
            padding: "8px 0",
            maxHeight: "300px",
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
                padding: "8px 20px",
                cursor: "pointer",
                fontSize: "13px",
                color: value === opt.value ? "#007bff" : "#202223",
                background: value === opt.value ? "#f4f8ff" : "transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f4f8ff")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background =
                  value === opt.value ? "#f4f8ff" : "transparent")
              }
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
    (s) =>
      s.toLowerCase().includes(inputValue.toLowerCase()) &&
      !selectedValues.includes(s),
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

  const handleSelect = (val) => {
    if (!selectedValues.includes(val)) {
      const newValues = [...selectedValues, val];
      onChange(newValues.join(", "));
    }
    setInputValue("");
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
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
        style={{
          width: "100%",
          padding: "12px 20px",
          background: "#f4f8ff",
          border: "none",
          borderRadius: "20px",
          fontSize: "13px",
          color: "#007bff",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {selectedValues.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {selectedValues.map((val) => (
            <div
              key={val}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 10px",
                background: "#007bff",
                color: "white",
                borderRadius: "16px",
                fontSize: "12px",
              }}
            >
              <span>{val}</span>
              <button
                type="button"
                onClick={() => handleRemove(val)}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  display: "flex",
                  alignItems: "center",
                  padding: "0",
                }}
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
            style={{
              position: "absolute",
              top: "40px",
              left: 0,
              right: 0,
              marginTop: "8px",
              background: "#fff",
              borderRadius: "8px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
              border: "1px solid #e1e3e5",
              zIndex: 1000,
              padding: "8px 0",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {filteredSuggestions.length > 0 ? (
              filteredSuggestions.map((s, i) => (
                <div
                  key={i}
                  onClick={() => handleSelect(s)}
                  style={{
                    padding: "10px 20px",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: "#202223",
                    borderBottom:
                      i < filteredSuggestions.length - 1
                        ? "1px solid #f1f2f4"
                        : "none",
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "#f4f8ff")}
                  onMouseLeave={(e) =>
                    (e.target.style.background = "transparent")
                  }
                >
                  {s}
                </div>
              ))
            ) : (
              <div
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
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

// ── Component ────────────────────────────────────────────────────────
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
    setShowModal(false);
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
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      {/* Global Spinner overlay for saving/loading */}
      {isLoading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(255,255,255,0.6)",
            zIndex: 100000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              border: "4px solid #f3f3f3",
              borderTop: "4px solid #007bff",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>
            {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
          </style>
        </div>
      )}

      {/* Premium Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px 32px",
          background: "#fff",
          borderBottom: "1px solid #f1f2f4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span
            style={{ fontSize: "13px", color: "#6d7175", fontWeight: "500" }}
          >
            Filter options ({rules.length})
          </span>
          <button
            onClick={openAdd}
            style={{
              background: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "20px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: "0 2px 4px rgba(0,123,255,0.2)",
              transition: "0.2s",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.transform = "translateY(-1px)")
            }
            onMouseOut={(e) => (e.currentTarget.style.transform = "none")}
          >
            Merge values
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <select
            value={pagination?.sort || "newest"}
            onChange={(e) => navigate(`?page=1&sort=${e.target.value}`)}
            style={{
              padding: "8px 12px",
              borderRadius: "20px",
              border: "1px solid #c9cccf",
              background: "#fff",
              color: "#202223",
              fontSize: "13px",
              fontWeight: "500",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <div style={{ position: "relative" }}>
            <svg
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "16px",
                height: "16px",
                fill: "#007bff",
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
              style={{
                background: "#f4f8ff",
                border: "none",
                borderRadius: "20px",
                padding: "8px 16px 8px 36px",
                fontSize: "13px",
                color: "#007bff",
                outline: "none",
                width: "240px",
                fontWeight: "500",
              }}
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              background: "#fff",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                fontSize: "48px",
                fontWeight: "900",
                color: "#007bff",
                margin: "0 0 16px 0",
                letterSpacing: "-0.5px",
              }}
            >
              Merge filter values
            </h1>
            <p
              style={{
                fontSize: "16px",
                color: "#6d7175",
                margin: "0 0 40px 0",
                fontWeight: "500",
              }}
            >
              Stack similar values under the same value category
            </p>
            <button
              onClick={openAdd}
              style={{
                background: "#007bff",
                color: "#fff",
                border: "none",
                borderRadius: "24px",
                padding: "12px 28px",
                fontSize: "15px",
                fontWeight: "700",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,123,255,0.3)",
                transition: "0.2s transform",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.transform = "translateY(-2px)")
              }
              onMouseOut={(e) => (e.currentTarget.style.transform = "none")}
            >
              Merge values
            </button>
          </div>
        ) : (
          Object.entries(grouped).map(([type, typeRules]) => (
            <div
              key={type}
              style={{
                background: "#fff",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              {/* Group header */}
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fafafa",
                  borderBottom: "1px solid #e1e3e5",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <svg
                  viewBox="0 0 20 20"
                  style={{ width: "14px", height: "14px", fill: "#5c5f62" }}
                >
                  <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
                </svg>
                <s-text variant="headingSm" fontWeight="bold">
                  {type}
                </s-text>
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: "10px",
                    background: "#e4e5e7",
                    fontSize: "11px",
                    color: "#6d7175",
                    fontWeight: "600",
                  }}
                >
                  {typeRules.length} {typeRules.length === 1 ? "rule" : "rules"}
                </span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f1f2f4" }}>
                    <th
                      style={{
                        padding: "10px 16px",
                        fontWeight: "600",
                        fontSize: "12px",
                        color: "#6d7175",
                        textAlign: "left",
                      }}
                    >
                      Show as (Target Value)
                    </th>
                    <th
                      style={{
                        padding: "10px 16px",
                        fontWeight: "600",
                        fontSize: "12px",
                        color: "#6d7175",
                        textAlign: "left",
                      }}
                    >
                      Raw values to merge
                    </th>
                    <th
                      style={{
                        padding: "10px 16px",
                        fontWeight: "600",
                        fontSize: "12px",
                        color: "#6d7175",
                        textAlign: "center",
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
                  {typeRules.map((rule) => (
                    <tr
                      key={rule.id}
                      style={{ borderBottom: "1px solid #f1f2f4" }}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            backgroundColor: "#e6f5ef",
                            border: "1px solid #b2dfcc",
                            color: "#005c3e",
                            fontSize: "13px",
                            fontWeight: "600",
                          }}
                        >
                          {rule.targetValue}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                          }}
                        >
                          {rule.sourceValues.map((val) => (
                            <span
                              key={val}
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                backgroundColor: "#f1f2f4",
                                border: "1px solid #e1e3e5",
                                fontSize: "12px",
                                color: "#4a4c4e",
                              }}
                            >
                              {val}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
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
                              ? "#007bff"
                              : "#c9cccf",
                            borderRadius: "10px",
                            position: "relative",
                            cursor: isLoading ? "not-allowed" : "pointer",
                            display: "inline-block",
                            transition: "background-color 0.2s",
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
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                            }}
                          />
                        </div>
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
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(rule)}
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
                              <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828z" />
                              <path d="M3 16h14v2H3v-2z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(rule.id)}
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
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "16px",
            padding: "24px 0",
          }}
        >
          <button
            disabled={pagination.currentPage <= 1 || isLoading}
            onClick={() => {
              const u = new URL(window.location.href);
              u.searchParams.set("page", pagination.currentPage - 1);
              navigate(u.pathname + u.search);
            }}
            style={{
              background: "#fff",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              padding: "6px 16px",
              fontSize: "13px",
              fontWeight: "600",
              cursor:
                pagination.currentPage <= 1 || isLoading
                  ? "not-allowed"
                  : "pointer",
              opacity: pagination.currentPage <= 1 || isLoading ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span
            style={{ fontSize: "14px", fontWeight: "500", color: "#202223" }}
          >
            Page {pagination.currentPage} of {pagination.totalPages}
          </span>
          <button
            disabled={
              pagination.currentPage >= pagination.totalPages || isLoading
            }
            onClick={() => {
              const u = new URL(window.location.href);
              u.searchParams.set("page", pagination.currentPage + 1);
              navigate(u.pathname + u.search);
            }}
            style={{
              background: "#fff",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              padding: "6px 16px",
              fontSize: "13px",
              fontWeight: "600",
              cursor:
                pagination.currentPage >= pagination.totalPages || isLoading
                  ? "not-allowed"
                  : "pointer",
              opacity:
                pagination.currentPage >= pagination.totalPages || isLoading
                  ? 0.5
                  : 1,
            }}
          >
            Next
          </button>
        </div>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────── */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            fontFamily:
              "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "16px",
              padding: "40px 48px",
              width: "100%",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 24px 64px rgba(0,0,0,0.12)",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
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
              <svg
                viewBox="0 0 20 20"
                style={{ width: "20px", height: "20px", fill: "#c9cccf" }}
              >
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2
              style={{
                margin: "0",
                fontSize: "20px",
                fontWeight: "700",
                color: "#3f4246",
              }}
            >
              Define merged values
            </h2>

            <div
              style={{
                background: "#f4f6f8",
                borderLeft: "3px solid #007bff",
                padding: "12px 16px",
                borderRadius: "4px",
                fontSize: "13px",
                color: "#6d7175",
                lineHeight: "1.5",
              }}
            >
              <strong
                style={{
                  color: "#202223",
                  display: "block",
                  marginBottom: "4px",
                }}
              >
                Note:
              </strong>
              Do not merge one value several times. For example, it's impossible
              to merge "Black/White" + "Black" into "Black" and "Black/White" +
              "White" into "White".
            </div>

            {/* Title */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  color: "#8c9196",
                  marginBottom: "6px",
                }}
              >
                Title
              </label>
              <input
                type="text"
                placeholder="Title for this group"
                value={filterTitle}
                onChange={(e) => setFilterTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  background: "#f4f8ff",
                  border: "none",
                  borderRadius: "20px",
                  fontSize: "13px",
                  color: "#007bff",
                  outline: "none",
                }}
              />
            </div>

            {/* Option Type */}
            <div style={{ zIndex: 101 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "11px",
                  color: "#8c9196",
                  marginBottom: "6px",
                }}
              >
                Option type
              </label>
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                zIndex: 100,
              }}
            >
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
                      alignItems: "center",
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
                        padding: "12px 20px",
                        background: "#f4f8ff",
                        border: "none",
                        borderRadius: "20px",
                        fontSize: "13px",
                        color: "#007bff",
                        outline: "none",
                      }}
                    />
                    {valueRows.length > 1 && !editingRule && (
                      <button
                        onClick={() => handleRemoveRow(index)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px",
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
                          <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM6 9v2h8V9H6z" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}

              {!editingRule && (
                <div style={{ marginTop: "4px" }}>
                  <button
                    onClick={handleAddRow}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "#007bff",
                      color: "#fff",
                      border: "none",
                      borderRadius: "20px",
                      padding: "8px 16px",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      viewBox="0 0 20 20"
                      style={{ width: "14px", height: "14px", fill: "#fff" }}
                    >
                      <path d="M11 9H15V11H11V15H9V11H5V9H9V5H11V9Z" />
                    </svg>
                    Add merged value
                  </button>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "16px",
                marginTop: "16px",
              }}
            >
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: "#fff",
                  color: "#a4a8ad",
                  border: "1px solid #e1e3e5",
                  borderRadius: "24px",
                  padding: "10px 32px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  background: "#007bff",
                  color: "#fff",
                  border: "none",
                  borderRadius: "24px",
                  padding: "10px 48px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                {isLoading ? "Saving..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              width: "400px",
              padding: "24px",
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
            }}
          >
            <h2
              style={{
                margin: "0 0 16px 0",
                fontSize: "16px",
                color: "#202223",
              }}
            >
              Delete merged value?
            </h2>
            <p
              style={{
                margin: "0 0 24px 0",
                fontSize: "14px",
                color: "#6d7175",
              }}
            >
              Are you sure you want to delete this merged value? This action
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
                onClick={() => setDeletingId(null)}
                disabled={isLoading}
                style={{
                  background: "#fff",
                  color: "#202223",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isLoading}
                style={{
                  background: "#d82c0d",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.7 : 1,
                }}
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
