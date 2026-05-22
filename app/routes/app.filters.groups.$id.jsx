import { useEffect, useState } from "react";
import { useActionData, useLoaderData, useSubmit, Link, data } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";

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
  const { session } = await authenticate.admin(request);
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

  return { group, detectedOptions: Array.from(optionNames).sort() };
};

// ── Action ───────────────────────────────────────────────────────────
export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id: filterGroupId } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Verify group belongs to shop
  const group = await prisma.filterGroup.findFirst({ where: { id: filterGroupId, shop } });
  if (!group) return data({ success: false, error: "Not found" }, { status: 404 });

  if (intent === "updateGroupName") {
    const name = formData.get("name");
    await prisma.filterGroup.update({ where: { id: filterGroupId }, data: { name } });
    return { success: true, intent };
  }

  if (intent === "addFilter") {
    const filterType = formData.get("filterType");
    const filterKey = formData.get("filterKey") || null;
    const label = formData.get("label");
    const displayMode = formData.get("displayMode") || "list";

    const lastFilter = await prisma.filterGroupItem.findFirst({
      where: { filterGroupId },
      orderBy: { order: "desc" },
    });
    const nextOrder = (lastFilter?.order ?? -1) + 1;

    await prisma.filterGroupItem.create({
      data: { filterGroupId, filterType, filterKey, label, displayMode, isEnabled: true, order: nextOrder },
    });
    return { success: true, intent };
  }

  if (intent === "updateFilter") {
    const filterId = formData.get("filterId");
    const label = formData.get("label");
    const displayMode = formData.get("displayMode");
    const config = formData.get("config") ? JSON.parse(formData.get("config")) : undefined;

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
    if (!current) return data({ success: false, error: "Filter not found" }, { status: 404 });

    const newStatus = !current.isEnabled;
    await prisma.filterGroupItem.update({
      where: { id: filterId },
      data: { isEnabled: newStatus },
    });

    return { success: true, intent, isEnabled: newStatus, label: current.label };
  }

  if (intent === "deleteFilter") {
    const filterId = formData.get("filterId");
    await prisma.filterGroupItem.delete({ where: { id: filterId } });
    return { success: true, intent };
  }

  if (intent === "duplicateFilter") {
    const filterId = formData.get("filterId");
    const source = await prisma.filterGroupItem.findUnique({ where: { id: filterId } });
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
        prisma.filterGroupItem.update({ where: { id: filterId }, data: { order: index } })
      )
    );
    return { success: true, intent };
  }

  return { success: false };
};

// ── Helper ────────────────────────────────────────────────────────────
function getFilterTypeLabel(type, key) {
  const found = FILTER_TYPE_OPTIONS.find((o) => o.value === type);
  if (type === "option") return `${key || "Option"}`;
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
  const label = DISPLAY_MODES.find((d) => d.value === mode)?.label.split(" ")[0] || mode;
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
  const { group, detectedOptions } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [groupName, setGroupName] = useState(group.name);

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

  useEffect(() => {
    if (actionData?.intent === "toggleFilter") {
      if (actionData.success) {
        shopify.toast.show(
          `${actionData.label ?? "Filter"} ${actionData.isEnabled ? "enabled" : "disabled"}`
        );
      } else if (actionData.error) {
        shopify.toast.show(actionData.error, { isError: true });
      }
    }
  }, [actionData, shopify]);

  const openConfigModal = (filter) => {
    setConfigFilter(filter);
    setConfigLabel(filter.label);
    setConfigDisplayMode(filter.displayMode);
    const cfg = filter.config || {};
    setConfigSortBy(cfg.sortBy || "count");
    setConfigLimit(cfg.limit || 0);
    setConfigShowSearch(cfg.showSearch || false);
    setConfigCollapsed(cfg.collapsed || false);
  };

  const handleSaveConfig = () => {
    submit(
      {
        intent: "updateFilter",
        filterId: configFilter.id,
        label: configLabel,
        displayMode: configDisplayMode,
        config: JSON.stringify({
          sortBy: configSortBy,
          limit: configLimit,
          showSearch: configShowSearch,
          collapsed: configCollapsed,
        }),
      },
      { method: "POST" }
    );
    setConfigFilter(null);
  };

  const handleUpdateName = () => {
    if (!groupName.trim()) return;
    submit({ intent: "updateGroupName", name: groupName }, { method: "POST" });
  };

  const handleAddFilter = () => {
    if (!addLabel.trim()) return;
    submit(
      {
        intent: "addFilter",
        filterType: addType,
        filterKey: addType === "option" || addType === "metafield" ? addKey : "",
        label: addLabel,
        displayMode: addDisplayMode,
      },
      { method: "POST" }
    );
    setShowAddFilter(false);
    setAddType("vendor");
    setAddKey("");
    setAddLabel("");
    setAddDisplayMode("list");
  };

  const handleAddTypeChange = (val) => {
    setAddType(val);
    setAddKey("");
    const found = FILTER_TYPE_OPTIONS.find((o) => o.value === val);
    setAddLabel(found && val !== "option" && val !== "metafield" ? found.label : "");
    setAddDisplayMode(val === "price" ? "range" : "list");
  };

  const handleAddKeyChange = (val) => {
    setAddKey(val);
    if (addType === "option" && val) setAddLabel(val);
  };

  return (
    <s-page>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
        <Link to="/app/filters/groups" style={{ color: "#006e52", textDecoration: "underline", fontWeight: "500" }}>
          Filter groups
        </Link>
        <span style={{ color: "#6d7175" }}>›</span>
        <span style={{ color: "#202223", fontWeight: "600" }}>{group.name}</span>
      </div>

      <s-stack direction="block" gap="base">
        <s-card heading="Filter group information">
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", marginTop: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Group Name
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
            </div>
            <s-button variant="primary" onClick={handleUpdateName}>
              Update
            </s-button>
          </div>

          <div style={{ marginTop: "16px" }}>
            <s-text variant="bodySm" tone="subdued">Assigned to:</s-text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {group.collections.map((c) => (
                <span
                  key={c.id}
                  style={{
                    padding: "3px 10px",
                    borderRadius: "4px",
                    backgroundColor: "#e4e5e7",
                    border: "1px solid #c9cccf",
                    fontSize: "12px",
                    color: "#202223",
                  }}
                >
                  {c.collectionTitle}
                </span>
              ))}
            </div>
          </div>
        </s-card>

        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px" }}>
          <div
            style={{
              padding: "14px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #e1e3e5",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text variant="headingMd" fontWeight="bold">Filters</s-text>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#f1f2f4",
                  fontSize: "12px",
                  color: "#6d7175",
                  fontWeight: "600",
                }}
              >
                {group.filters.length}
              </span>
            </div>
            <s-button variant="primary" onClick={() => setShowAddFilter(true)}>
              Add filter
            </s-button>
          </div>

          {group.filters.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#6d7175" }}>
              <svg viewBox="0 0 20 20" style={{ width: "32px", height: "32px", fill: "#c9cccf", marginBottom: "12px" }}>
                <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
              </svg>
              <p style={{ margin: "0 0 16px", fontSize: "14px" }}>No filters yet. Add your first filter.</p>
              <s-button onClick={() => setShowAddFilter(true)}>Add filter</s-button>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#fafafa", borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175", width: "32px" }}></th>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175" }}>Filter title</th>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175" }}>Type</th>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175" }}>Display mode</th>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175" }}>Status</th>
                  <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.filters.map((filter) => (
                  <tr key={filter.id} style={{ borderBottom: "1px solid #f1f2f4" }}>
                    <td style={{ padding: "14px 16px", color: "#c9cccf", cursor: "grab", textAlign: "center" }}>
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#c9cccf" }}>
                        <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                      </svg>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <button
                        onClick={() => openConfigModal(filter)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#006e52",
                          fontSize: "14px",
                          fontWeight: "600",
                          textDecoration: "underline",
                          cursor: "pointer",
                          padding: 0,
                          textAlign: "left",
                        }}
                      >
                        {filter.label}
                      </button>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6d7175" }}>
                      {getFilterTypeLabel(filter.filterType, filter.filterKey)}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <DisplayModeBadge mode={filter.displayMode} />
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <label style={{ position: "relative", display: "inline-block", width: "40px", height: "22px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={filter.isEnabled}
                          onChange={() => submit({ intent: "toggleFilter", filterId: filter.id }, { method: "POST" })}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            backgroundColor: filter.isEnabled ? "#008060" : "#8c9196",
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
                      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", alignItems: "center" }}>
                        <button
                          onClick={() => openConfigModal(filter)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                          title="Configure"
                        >
                          <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5c5f62" }}>
                            <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828z" />
                            <path d="M3 16h14v2H3v-2z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => submit({ intent: "duplicateFilter", filterId: filter.id }, { method: "POST" })}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                          title="Duplicate"
                        >
                          <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5c5f62" }}>
                            <path d="M14 6h-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-8 6V4h6v2H8a2 2 0 0 0-2 2v4H6zm8 4H8V8h6v8z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => submit({ intent: "deleteFilter", filterId: filter.id }, { method: "POST" })}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                          title="Delete"
                        >
                          <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#d82c0d" }}>
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
              style={{ position: "absolute", top: "16px", right: "16px", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2 style={{ margin: "0 0 24px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>Add Filter</h2>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Filter Type
              </label>
              <select
                value={addType}
                onChange={(e) => handleAddTypeChange(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px" }}
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
                <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                  Option Name
                </label>
                {detectedOptions.length > 0 ? (
                  <select
                    value={addKey}
                    onChange={(e) => handleAddKeyChange(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px" }}
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
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
                  />
                )}
                {addKey === "__custom" && (
                  <input
                    type="text"
                    placeholder="Type option name (e.g. Material)"
                    style={{ width: "100%", padding: "10px 14px", marginTop: "8px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
                    onChange={(e) => handleAddKeyChange(e.target.value)}
                  />
                )}
              </div>
            )}

            {addType === "metafield" && (
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                  Metafield Key (namespace.key)
                </label>
                <input
                  type="text"
                  placeholder="e.g. custom.material"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
                />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Display Label
              </label>
              <input
                type="text"
                placeholder="Label shown on storefront"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Display Mode
              </label>
              <select
                value={addDisplayMode}
                onChange={(e) => setAddDisplayMode(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px" }}
              >
                {DISPLAY_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <s-button onClick={() => setShowAddFilter(false)}>Cancel</s-button>
              <s-button variant="primary" onClick={handleAddFilter} disabled={!addLabel.trim()}>
                Add Filter
              </s-button>
            </div>
          </div>
        </div>
      )}

      {configFilter && (
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
            if (e.target === e.currentTarget) setConfigFilter(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "32px",
              width: "520px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              position: "relative",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <button
              onClick={() => setConfigFilter(null)}
              style={{ position: "absolute", top: "16px", right: "16px", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
              Configure Filter
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#6d7175" }}>
              {getFilterTypeLabel(configFilter.filterType, configFilter.filterKey)}
            </p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Display Label
              </label>
              <input
                type="text"
                value={configLabel}
                onChange={(e) => setConfigLabel(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Display Mode
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {DISPLAY_MODES.map((m) => (
                  <label
                    key={m.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: `2px solid ${configDisplayMode === m.value ? "#008060" : "#e1e3e5"}`,
                      cursor: "pointer",
                      background: configDisplayMode === m.value ? "#e6f5ef" : "#fff",
                      fontSize: "13px",
                      fontWeight: configDisplayMode === m.value ? "600" : "400",
                      color: configDisplayMode === m.value ? "#008060" : "#202223",
                    }}
                  >
                    <input
                      type="radio"
                      name="displayMode"
                      value={m.value}
                      checked={configDisplayMode === m.value}
                      onChange={() => setConfigDisplayMode(m.value)}
                      style={{ display: "none" }}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            <div
              style={{
                marginBottom: "24px",
                padding: "16px",
                borderRadius: "8px",
                background: "#f6f6f7",
                border: "1px solid #e1e3e5",
              }}
            >
              <p style={{ margin: "0 0 12px", fontWeight: 600, fontSize: "13px", color: "#202223" }}>
                Advanced Options
              </p>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", color: "#6d7175", fontWeight: 500 }}>
                  Sort values by
                </label>
                <select
                  value={configSortBy}
                  onChange={(e) => setConfigSortBy(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
                >
                  <option value="count">Count (highest first)</option>
                  <option value="az">Alphabetical A → Z</option>
                  <option value="za">Alphabetical Z → A</option>
                </select>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", color: "#6d7175", fontWeight: 500 }}>
                  Limit values shown (0 = show all)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={configLimit}
                  onChange={(e) => setConfigLimit(parseInt(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "13px", color: "#202223" }}>
                  <input
                    type="checkbox"
                    checked={configShowSearch}
                    onChange={(e) => setConfigShowSearch(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Enable search within this filter
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "13px", color: "#202223" }}>
                  <input
                    type="checkbox"
                    checked={configCollapsed}
                    onChange={(e) => setConfigCollapsed(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Collapsed by default on storefront
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <s-button onClick={() => setConfigFilter(null)}>Cancel</s-button>
              <s-button variant="primary" onClick={handleSaveConfig}>
                Save Changes
              </s-button>
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