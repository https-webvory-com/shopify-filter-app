import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Customization() {
  const [activeTab, setActiveTab] = useState("style");
  const [cssCode, setCssCode] = useState("/* Write custom CSS here */\n.cfp-filter-title {\n  font-weight: bold;\n}");
  const [jsCode, setJsCode] = useState("// Write custom Javascript here\nconsole.log('Collection Filter Pro initialized');");

  const [swatches, setSwatches] = useState([
    { color: "Red", hex: "#FF0000" },
    { color: "Blue", hex: "#0000FF" },
    { color: "Green", hex: "#00FF00" },
    { color: "Black", hex: "#000000" },
    { color: "White", hex: "#FFFFFF" }
  ]);

  const [newColor, setNewColor] = useState("");
  const [newHex, setNewHex] = useState("#ffffff");

  const handleAddSwatch = () => {
    if (!newColor) return;
    setSwatches([...swatches, { color: newColor, hex: newHex }]);
    setNewColor("");
    setNewHex("#ffffff");
  };

  return (
    <s-page heading="Customization">
      <ui-title-bar title="Customization"></ui-title-bar>
      <s-button slot="primary-action">
        Save Customization
      </s-button>

      <s-stack direction="block" gap="base">
        {/* Navigation tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e1e3e5", gap: "16px" }}>
          <button
            onClick={() => setActiveTab("style")}
            style={{
              padding: "12px 8px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "style" ? "2px solid #008060" : "none",
              color: activeTab === "style" ? "#008060" : "#6d7175",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "14px"
            }}
          >
            Widget Styling
          </button>
          <button
            onClick={() => setActiveTab("swatches")}
            style={{
              padding: "12px 8px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "swatches" ? "2px solid #008060" : "none",
              color: activeTab === "swatches" ? "#008060" : "#6d7175",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "14px"
            }}
          >
            Color Swatches
          </button>
          <button
            onClick={() => setActiveTab("code")}
            style={{
              padding: "12px 8px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "code" ? "2px solid #008060" : "none",
              color: activeTab === "code" ? "#008060" : "#6d7175",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "14px"
            }}
          >
            Custom CSS / JS
          </button>
        </div>

        {/* Tab content: Style */}
        {activeTab === "style" && (
          <s-layout>
            <s-layout-section>
              <s-card heading="General Settings">
                <s-stack direction="block" gap="base">
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontWeight: "600", fontSize: "14px" }}>Filter Sidebar Position</label>
                    <select style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px" }}>
                      <option>Left Sidebar</option>
                      <option>Right Sidebar</option>
                      <option>Top Toolbar (Horizontal)</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontWeight: "600", fontSize: "14px" }}>Products Per Page</label>
                    <input type="number" defaultValue="16" style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px", width: "120px" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontWeight: "600", fontSize: "14px" }}>Theme Accent Color</label>
                    <input type="color" defaultValue="#008060" style={{ width: "60px", height: "40px", border: "1px solid #ccc", borderRadius: "4px" }} />
                  </div>
                </s-stack>
              </s-card>
            </s-layout-section>
            
            <s-layout-section variant="secondary">
              <s-card heading="Facet Options">
                <s-stack direction="block" gap="base">
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" defaultChecked id="show-count" style={{ width: "16px", height: "16px" }} />
                    <label htmlFor="show-count" style={{ fontSize: "14px" }}>Show product count badge on filters</label>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" defaultChecked id="hide-empty" style={{ width: "16px", height: "16px" }} />
                    <label htmlFor="hide-empty" style={{ fontSize: "14px" }}>Hide filter values with 0 products</label>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" id="multi-select" defaultChecked style={{ width: "16px", height: "16px" }} />
                    <label htmlFor="multi-select" style={{ fontSize: "14px" }}>Allow multi-selection in facets</label>
                  </div>
                </s-stack>
              </s-card>
            </s-layout-section>
          </s-layout>
        )}

        {/* Tab content: Swatches */}
        {activeTab === "swatches" && (
          <s-layout>
            <s-layout-section>
              <s-card heading="Manage Color Hex Mapping">
                <s-paragraph>
                  Provide hex codes for color filters to render actual color circles/swatches instead of basic text options.
                </s-paragraph>
                <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  {swatches.map((swatch, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px", border: "1px solid #e1e3e5", padding: "8px 12px", borderRadius: "6px" }}>
                      <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: swatch.hex, display: "inline-block", border: "1px solid #ccc" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "600", fontSize: "13px" }}>{swatch.color}</div>
                        <div style={{ fontSize: "12px", color: "#6d7175" }}>{swatch.hex}</div>
                      </div>
                      <button
                        onClick={() => setSwatches(swatches.filter((_, i) => i !== idx))}
                        style={{ background: "none", border: "none", color: "#d82c0d", cursor: "pointer", fontWeight: "600" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </s-card>
            </s-layout-section>

            <s-layout-section variant="secondary">
              <s-card heading="Add Custom Swatch">
                <s-stack direction="block" gap="base">
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontWeight: "600", fontSize: "14px" }}>Color Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Navy Blue"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontWeight: "600", fontSize: "14px" }}>Hex Code</label>
                    <input
                      type="color"
                      value={newHex}
                      onChange={(e) => setNewHex(e.target.value)}
                      style={{ width: "60px", height: "40px", border: "1px solid #ccc", borderRadius: "4px", padding: 0 }}
                    />
                  </div>
                  <button
                    onClick={handleAddSwatch}
                    style={{
                      background: "#008060",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "10px 18px",
                      fontWeight: "600",
                      fontSize: "14px",
                      cursor: "pointer",
                      marginTop: "10px"
                    }}
                  >
                    Add Swatch
                  </button>
                </s-stack>
              </s-card>
            </s-layout-section>
          </s-layout>
        )}

        {/* Tab content: Code */}
        {activeTab === "code" && (
          <s-stack direction="block" gap="base">
            <s-card heading="Custom Styling (CSS)">
              <s-paragraph>Add custom styles to override default widget design elements.</s-paragraph>
              <textarea
                value={cssCode}
                onChange={(e) => setCssCode(e.target.value)}
                style={{
                  width: "100%",
                  height: "150px",
                  fontFamily: "monospace",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "13px",
                  marginTop: "8px"
                }}
              />
            </s-card>
            <s-card heading="Custom Scripting (JS)">
              <s-paragraph>Insert custom Javascript hooks or trackers that run upon search/filter loads.</s-paragraph>
              <textarea
                value={jsCode}
                onChange={(e) => setJsCode(e.target.value)}
                style={{
                  width: "100%",
                  height: "150px",
                  fontFamily: "monospace",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "13px",
                  marginTop: "8px"
                }}
              />
            </s-card>
          </s-stack>
        )}

      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
