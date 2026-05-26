import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Integrations() {
  const [integrations, setIntegrations] = useState([
    { id: 1, name: "Shopify Product Reviews", category: "Reviews", desc: "Display star ratings and filter products by rating badges.", enabled: true },
    { id: 2, name: "Loox Reviews", category: "Reviews", desc: "Show Loox photo reviews and rating stars in grid results.", enabled: false },
    { id: 3, name: "Judge.me Product Reviews", category: "Reviews", desc: "Integrate Judge.me ratings and stars inside the widget.", enabled: false },
    { id: 4, name: "Yotpo Reviews", category: "Reviews", desc: "Display Yotpo product reviews dynamically on cards.", enabled: false },
    { id: 5, name: "Shopify Markets Multicurrency", category: "Currency", desc: "Auto-convert price slider limits and values based on country currencies.", enabled: true },
    { id: 6, name: "Weglot Translate", category: "Translation", desc: "Enable multilingual support for all filters and dropdown text labels.", enabled: false },
  ]);

  const handleToggle = (id) => {
    setIntegrations(
      integrations.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item
      )
    );
  };

  return (
    <s-page heading="Integrations">
      <ui-title-bar title="Integrations"></ui-title-bar>
      <s-stack direction="block" gap="base">
        <s-section heading="Connect Third-Party Apps">
          <s-paragraph>
            Integrate Collection Filter Pro with your favorite Shopify apps to add rating stars, currency conversion, and translation options to your search and filtering widget.
          </s-paragraph>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px", marginTop: "16px" }}>
            {integrations.map((item) => (
              <s-box
                key={item.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
                style={{ backgroundColor: "#fff" }}
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" align="space-between" blockAlign="center" gap="base">
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: item.category === "Reviews" ? "#0080ff" : item.category === "Currency" ? "#9c6ade" : "#008060",
                        backgroundColor: item.category === "Reviews" ? "#e6f2ff" : item.category === "Currency" ? "#f3ebf9" : "#e6f5ef",
                        padding: "4px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      {item.category}
                    </span>
                    <label style={{ position: "relative", display: "inline-block", width: "40px", height: "22px" }}>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={() => handleToggle(item.id)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          cursor: "pointer",
                          inset: 0,
                          backgroundColor: item.enabled ? "#008060" : "#ccc",
                          transition: "0.2s",
                          borderRadius: "34px",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            content: '""',
                            height: "16px",
                            width: "16px",
                            left: item.enabled ? "20px" : "4px",
                            bottom: "3px",
                            backgroundColor: "#white",
                            transition: "0.2s",
                            borderRadius: "50%",
                            background: "white",
                          }}
                        />
                      </span>
                    </label>
                  </s-stack>

                  <s-text variant="headingSm" fontWeight="bold">
                    {item.name}
                  </s-text>

                  <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>
                    {item.desc}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ))}
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
