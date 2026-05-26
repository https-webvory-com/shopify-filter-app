import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Settings() {
  return (
    <s-page heading="App Settings">
      <ui-title-bar title="App Settings"></ui-title-bar>
      <s-button slot="primary-action">
        Save Settings
      </s-button>

      <s-stack direction="block" gap="base">
        <s-layout>
          <s-layout-section>
            <s-card heading="Synchronization Settings">
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontWeight: "600", fontSize: "14px" }}>Automatic Sync Frequency</label>
                  <select defaultValue="daily" style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px" }}>
                    <option value="realtime">Real-time (Webhooks only)</option>
                    <option value="hourly">Every Hour + Webhooks</option>
                    <option value="daily">Daily Cron + Webhooks</option>
                    <option value="manual">Manual only</option>
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontWeight: "600", fontSize: "14px" }}>Include Product Statuses</label>
                  <s-stack direction="inline" gap="base">
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input type="checkbox" defaultChecked id="status-active" style={{ width: "16px", height: "16px" }} />
                      <label htmlFor="status-active" style={{ fontSize: "14px" }}>Active</label>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input type="checkbox" defaultChecked id="status-draft" style={{ width: "16px", height: "16px" }} />
                      <label htmlFor="status-draft" style={{ fontSize: "14px" }}>Draft</label>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input type="checkbox" id="status-archived" style={{ width: "16px", height: "16px" }} />
                      <label htmlFor="status-archived" style={{ fontSize: "14px" }}>Archived</label>
                    </div>
                  </s-stack>
                </div>
              </s-stack>
            </s-card>

            <s-card heading="Storefront API Credentials">
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontWeight: "600", fontSize: "14px" }}>Public Access Token</label>
                  <input
                    type="text"
                    readOnly
                    value="shpat_demo_access_token_cfp_widget_12345"
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontFamily: "monospace",
                      backgroundColor: "#f6f6f7",
                      color: "#6d7175"
                    }}
                  />
                  <s-text tone="subdued" variant="bodySm">
                    Use this token if you are writing custom headless frontends or connecting from other domains.
                  </s-text>
                </div>
              </s-stack>
            </s-card>
          </s-layout-section>

          <s-layout-section variant="secondary">
            <s-card heading="Danger Zone">
              <s-paragraph>
                Clearing or resetting local database copies does not affect your live products in Shopify.
              </s-paragraph>
              <div style={{ marginTop: "12px" }}>
                <button
                  onClick={() => alert("Local products database reset initiated.")}
                  style={{
                    background: "#d82c0d",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "10px 18px",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: "pointer"
                  }}
                >
                  Clear Cached Database
                </button>
              </div>
            </s-card>
          </s-layout-section>
        </s-layout>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
