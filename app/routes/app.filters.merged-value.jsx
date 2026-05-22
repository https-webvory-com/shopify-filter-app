import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useAppBridge } from "@shopify/app-bridge-react";

// ── Loader ───────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [rules, products] = await Promise.all([
    prisma.mergedValue.findMany({
      where: { shop },
      orderBy: [{ filterType: "asc" }, { targetValue: "asc" }],
    }),
    prisma.product.findMany({
      where: { shop },
      select: { options: true },
    }),
  ]);

  // Detect available filter/option names from products
  const optionNames = new Set();
  for (const p of products) {
    for (const opt of p.options || []) {
      if (opt.name) optionNames.add(opt.name);
    }
  }

  return { rules, optionNames: Array.from(optionNames).sort() };
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

  return { success: false };
};

// ── Component ─────────────────────────────────────────────────────────
export default function MergedValues() {
  const { rules, optionNames } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isLoading = navigation.state !== "idle";

  // Add/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null); // null = add, object = edit

  const [filterType, setFilterType] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [sourceValues, setSourceValues] = useState("");

  const openAdd = () => {
    setEditingRule(null);
    setFilterType(optionNames[0] || "");
    setTargetValue("");
    setSourceValues("");
    setShowModal(true);
  };

  const openEdit = (rule) => {
    setEditingRule(rule);
    setFilterType(rule.filterType);
    setTargetValue(rule.targetValue);
    setSourceValues(rule.sourceValues.join(", "));
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (!filterType.trim() || !targetValue.trim() || !sourceValues.trim()) return;
    if (editingRule) {
      submit(
        { intent: "update", id: editingRule.id, targetValue, sourceValues },
        { method: "POST" }
      );
    } else {
      submit(
        { intent: "add", filterType, filterKey: "", targetValue, sourceValues },
        { method: "POST" }
      );
    }
    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (!confirm("Delete this merged value rule?")) return;
    submit({ intent: "delete", id }, { method: "POST" });
  };

  // Group rules by filterType for display
  const grouped = rules.reduce((acc, rule) => {
    if (!acc[rule.filterType]) acc[rule.filterType] = [];
    acc[rule.filterType].push(rule);
    return acc;
  }, {});

  return (
    <s-page heading="Merged Filter Values">
      <s-button slot="primary-action" variant="primary" onClick={openAdd}>
        Add merged rule
      </s-button>

      <s-stack direction="block" gap="base">

        {/* Info card */}
        <s-box
          padding="base"
          style={{ background: "#f1f2f4", border: "1px solid #c9cccf", borderRadius: "8px" }}
        >
          <s-stack direction="inline" gap="base" blockAlign="center">
            <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62", flexShrink: 0 }} aria-hidden="true">
              <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-9v5h2V9H9zm0-3v2h2V6H9z" />
            </svg>
            <div>
              <s-text variant="headingSm" fontWeight="bold">About Merged Values</s-text>
              <s-paragraph style={{ margin: "4px 0 0", fontSize: "13px", color: "#202223" }}>
                Merged values let you consolidate similar option variants into a single clean filter value. For example, merge "Crimson", "Wine", and "Ruby Red" into a single <strong>"Red"</strong> filter option. Rules apply globally across all filter groups.
              </s-paragraph>
            </div>
          </s-stack>
        </s-box>

        {/* Rules Table */}
        {rules.length === 0 ? (
          <s-card>
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <svg viewBox="0 0 20 20" style={{ width: "40px", height: "40px", fill: "#c9cccf", margin: "0 auto 16px" }}>
                <path d="M3 6h14v2H3V6zm2 4h10v2H5v-2zm2 4h6v2H7v-2z" />
              </svg>
              <p style={{ margin: "0 0 16px", color: "#6d7175", fontSize: "14px" }}>
                No merged value rules yet.
              </p>
              <s-button onClick={openAdd}>Add your first rule</s-button>
            </div>
          </s-card>
        ) : (
          Object.entries(grouped).map(([type, typeRules]) => (
            <div
              key={type}
              style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}
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
                <svg viewBox="0 0 20 20" style={{ width: "14px", height: "14px", fill: "#5c5f62" }}>
                  <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
                </svg>
                <s-text variant="headingSm" fontWeight="bold">{type}</s-text>
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
                    <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175", textAlign: "left" }}>
                      Show as (Target Value)
                    </th>
                    <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175", textAlign: "left" }}>
                      Raw values to merge
                    </th>
                    <th style={{ padding: "10px 16px", fontWeight: "600", fontSize: "12px", color: "#6d7175", textAlign: "right" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {typeRules.map((rule) => (
                    <tr key={rule.id} style={{ borderBottom: "1px solid #f1f2f4" }}>
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
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
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
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", alignItems: "center" }}>
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(rule)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                            title="Edit"
                          >
                            <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5c5f62" }}>
                              <path d="M17.414 2.586a2 2 0 0 0-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 0 0 0-2.828z" />
                              <path d="M3 16h14v2H3v-2z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(rule.id)}
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
            </div>
          ))
        )}

      </s-stack>

      {/* ── Add / Edit Modal ─────────────────────────────────────── */}
      {showModal && (
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
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
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
              onClick={() => setShowModal(false)}
              style={{ position: "absolute", top: "16px", right: "16px", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
                <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
              </svg>
            </button>

            <h2 style={{ margin: "0 0 24px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
              {editingRule ? "Edit Merged Rule" : "Create Merged Rule"}
            </h2>

            {/* Filter / Option Name — only for add */}
            {!editingRule && (
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                  Filter / Option Name
                </label>
                {optionNames.length > 0 ? (
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px" }}
                  >
                    {optionNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                    <option value="__custom">Custom...</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. Color"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
                  />
                )}
                {filterType === "__custom" && (
                  <input
                    type="text"
                    placeholder="Type filter name..."
                    style={{ width: "100%", padding: "10px 14px", marginTop: "8px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
                    onChange={(e) => setFilterType(e.target.value)}
                  />
                )}
              </div>
            )}
            {editingRule && (
              <div style={{ marginBottom: "16px", padding: "10px 14px", borderRadius: "8px", background: "#f6f6f7", border: "1px solid #e1e3e5" }}>
                <s-text variant="bodySm" tone="subdued">Filter type: </s-text>
                <s-text variant="bodySm" fontWeight="bold">{editingRule.filterType}</s-text>
              </div>
            )}

            {/* Target Value */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Target Value <span style={{ fontWeight: 400 }}>(clean value shown to shopper)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Red"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>

            {/* Source Values */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "#6d7175" }}>
                Values to merge <span style={{ fontWeight: 400 }}>(comma-separated raw values)</span>
              </label>
              <textarea
                placeholder="e.g. Crimson, Wine, Ruby Red, Burgundy"
                value={sourceValues}
                onChange={(e) => setSourceValues(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6d7175" }}>
                Separate values with commas. Matching is case-insensitive.
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <s-button onClick={() => setShowModal(false)}>Cancel</s-button>
              <s-button
                variant="primary"
                onClick={handleSubmit}
                disabled={!filterType.trim() || !targetValue.trim() || !sourceValues.trim()}
              >
                {editingRule ? "Save Changes" : "Create Rule"}
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
