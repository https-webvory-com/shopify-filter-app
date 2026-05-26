import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function SettingsOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Settings">
      <ui-title-bar title="Settings"></ui-title-bar>

      <s-stack direction="block" gap="base">
        <s-section heading="Set up guide">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {/* General Settings */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div style={{ flex: 1 }}>
                <s-stack direction="inline" gap="base" blockAlign="center">
                  <svg
                    style={{ width: "20px", height: "20px", color: "#5c5f62" }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    ></path>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    General Settings
                  </s-text>
                </s-stack>
                <div
                  style={{
                    marginTop: "12px",
                    color: "#6d7175",
                    fontSize: "14px",
                    lineHeight: "20px",
                  }}
                >
                  Configure automatic sync frequency, manage Storefront API
                  credentials, and control product statuses included in sync.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button
                  onClick={() => navigate("/app/settings/general")}
                  variant="primary"
                >
                  Configure
                </s-button>
              </div>
            </s-box>

            {/* Customization */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div style={{ flex: 1 }}>
                <s-stack direction="inline" gap="base" blockAlign="center">
                  <svg
                    style={{ width: "20px", height: "20px", color: "#5c5f62" }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Customization
                  </s-text>
                </s-stack>
                <div
                  style={{
                    marginTop: "12px",
                    color: "#6d7175",
                    fontSize: "14px",
                    lineHeight: "20px",
                  }}
                >
                  Customize the widget styling, add custom color swatches, or
                  write custom CSS and Javascript.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button
                  onClick={() => navigate("/app/settings/customization")}
                >
                  Customize layout
                </s-button>
              </div>
            </s-box>

            {/* Integrations */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div style={{ flex: 1 }}>
                <s-stack direction="inline" gap="base" blockAlign="center">
                  <svg
                    style={{ width: "20px", height: "20px", color: "#5c5f62" }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Integrations
                  </s-text>
                </s-stack>
                <div
                  style={{
                    marginTop: "12px",
                    color: "#6d7175",
                    fontSize: "14px",
                    lineHeight: "20px",
                  }}
                >
                  Connect Collection Filter Pro with your favorite Shopify apps
                  like product reviews, translation, and currencies.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button
                  onClick={() => navigate("/app/settings/integrations")}
                >
                  Manage integrations
                </s-button>
              </div>
            </s-box>

            {/* Theme Setup */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div style={{ flex: 1 }}>
                <s-stack direction="inline" gap="base" blockAlign="center">
                  <svg
                    style={{ width: "20px", height: "20px", color: "#5c5f62" }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Theme Setup
                  </s-text>
                </s-stack>
                <div
                  style={{
                    marginTop: "12px",
                    color: "#6d7175",
                    fontSize: "14px",
                    lineHeight: "20px",
                  }}
                >
                  Automatically set up Filter + Search widget on a specific
                  theme. Enable app blocks easily via Theme Editor.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button onClick={() => navigate("/app/settings/theme-setup")}>
                  Setup theme
                </s-button>
              </div>
            </s-box>
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
