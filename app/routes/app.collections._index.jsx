import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function CollectionsOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Collections">
      <ui-title-bar title="Collections"></ui-title-bar>

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Collections">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {/* Merchandising */}
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
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Merchandising
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
                  Create collection rules to automatically promote, hide, or
                  sort products.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button
                  onClick={() => navigate("/app/collections/merchandising")}
                  variant="primary"
                >
                  Manage Merchandising
                </s-button>
              </div>
            </s-box>

            {/* Product Pinning */}
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
                      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                    ></path>
                  </svg>
                  <s-text variant="headingSm" fontWeight="semibold">
                    Product Pinning
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
                  Pin specific products to the top or specific positions in your
                  collections.
                </div>
              </div>
              <div style={{ marginTop: "20px" }}>
                <s-button onClick={() => navigate("/app/collections/pinning")}>
                  Manage Pinning
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
