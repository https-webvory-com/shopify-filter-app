import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function FiltersOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Filters">
      <ui-title-bar title="Filters"></ui-title-bar>

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Filters">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {/* Filter Groups */}
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
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Filter Groups
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
                  Create and manage groups of filters for your search and
                  collection pages.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button
                  onClick={() => navigate("/app/filters/groups")}
                  variant="primary"
                >
                  Manage Groups
                </s-button>
              </div>
            </s-box>

            {/* Merged Values */}
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
                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Merged Values
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
                  Combine multiple similar option values (e.g. Navy, Sky Blue)
                  into a single unified filter option (Blue).
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button onClick={() => navigate("/app/filters/merged-value")}>
                  Manage Merged Values
                </s-button>
              </div>
            </s-box>

            {/* Filter Settings */}
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
                      d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Filter Settings
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
                  Configure advanced filter settings like horizontal layout,
                  product count, and display preferences.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button onClick={() => navigate("/app/filters/settings")}>
                  Configure Settings
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
