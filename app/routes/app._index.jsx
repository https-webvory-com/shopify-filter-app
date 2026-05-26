import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProducts } from "../services/sync.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const syncedProductsCount = await prisma.product.count({
    where: { shop: session.shop },
  });

  return { syncedProductsCount };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "sync") {
    try {
      const count = await syncProducts(session.shop, admin);
      return { success: true, count, type: "sync" };
    } catch (e) {
      console.error("Sync error:", e);
      return { error: e.message, type: "sync" };
    }
  }

  return null;
};

export default function Index() {
  const { syncedProductsCount } = useLoaderData();
  const syncFetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const isSyncing =
    ["loading", "submitting"].includes(syncFetcher.state) &&
    syncFetcher.formData?.get("actionType") === "sync";

  useEffect(() => {
    if (syncFetcher.data?.success) {
      shopify.toast.show(
        `Successfully synced ${syncFetcher.data.count} products!`,
      );
    } else if (syncFetcher.data?.error) {
      shopify.toast.show(`Sync failed: ${syncFetcher.data.error}`, {
        isError: true,
      });
    }
  }, [syncFetcher.data, shopify]);

  const triggerSync = () =>
    syncFetcher.submit({ actionType: "sync" }, { method: "POST" });

  const currentCount = syncFetcher.data?.success
    ? syncFetcher.data.count
    : syncedProductsCount;

  return (
    <s-page heading="Collection Filter Pro Dashboard">
      <ui-title-bar title="Dashboard"></ui-title-bar>
      <s-stack direction="block" gap="base">
        {/* Sync Controls Banner */}
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          style={{ backgroundColor: "#f9fafb" }}
        >
          <s-stack
            direction="inline"
            align="space-between"
            blockAlign="center"
            gap="base"
          >
            <div>
              <s-text variant="headingMd" fontWeight="bold">
                Database Synchronization
              </s-text>
              <s-paragraph>
                <strong>Status:</strong> {currentCount} products currently
                indexed in PostgreSQL.
              </s-paragraph>
            </div>
            <s-button
              onClick={triggerSync}
              {...(isSyncing ? { loading: true } : {})}
            >
              Sync Products from Shopify
            </s-button>
          </s-stack>
        </s-box>

        {/* Set Up Guide */}
        <s-section heading="Set up guide">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "20px",
              marginTop: "12px",
            }}
          >
            {/* Card 1: Theme Setup */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "180px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path d="M16.5 2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H15v1.5a2.5 2.5 0 0 1-2.5 2.5H11v1.5a1.5 1.5 0 0 1-3 0V12H6.5A2.5 2.5 0 0 1 4 9.5V8H2.5A1.5 1.5 0 0 1 1 6.5v-3A1.5 1.5 0 0 1 2.5 2h14zM4.5 3.5h-2v3h2v-3zm11 0h-10v3h10v-3zm-1 5H4.5v1a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1z" />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Theme Setup
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Automatically set up Filter + Search widget on a specific
                  theme. You can duplicate a theme and set it up on an
                  unpublished theme for testing.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <s-button
                  variant="primary"
                  onClick={() => navigate("/app/theme-setup")}
                >
                  Setup theme
                </s-button>
              </div>
            </s-box>

            {/* Card 2: Configure Search Settings */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "180px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.186 13.522a6.5 6.5 0 1 1 1.336-1.336l3.784 3.783a.945.945 0 0 1-1.336 1.337l-3.784-3.784zm-5.686-.522a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"
                    />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Search Settings
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Set meaningful searchable attributes, customize search logic,
                  and index specific fields.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <s-button onClick={() => navigate("/app/customization")}>
                  Configure
                </s-button>
              </div>
            </s-box>

            {/* Card 3: Set Up Product Filters */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "180px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path d="M3 16h4v-2H3v2zm0-5h9V9H3v2zm0-5h14V4H3v2zm6 10h8v-2H9v2zm5-5h3V9h-3v2z" />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Product Filters
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Set up or edit Smart product filters, custom option values,
                  and tags on your store.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <s-button
                  variant="primary"
                  onClick={() => navigate("/app/filters/groups")}
                >
                  Setup filters
                </s-button>
              </div>
            </s-box>
          </div>
        </s-section>

        {/* Improve Sales and Conversion */}
        <s-section heading="Improve sales and conversion">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "20px",
              marginTop: "12px",
            }}
          >
            {/* Box 1: Collection Merchandising */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "160px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path d="M3 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zm4-3a3 3 0 0 1 6 0h-6zm1 2h4V3a1 1 0 0 0-2 0H8v2z" />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Collection Merchandising
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Customize product ranking and order in collection pages to
                  promote featured products.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <button
                  onClick={() => navigate("/app/merchandising")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#008060",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    padding: 0,
                  }}
                >
                  Manage merchandising →
                </button>
              </div>
            </s-box>

            {/* Box 2: Search Merchandising */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "160px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path d="M19 17a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v14h15a1 1 0 0 1 1 1zm-4-9.586-4 4-3.293-3.293a1 1 0 0 0-1.414 0l-4 4a1 1 0 1 0 1.414 1.414L7 10.414l3.293 3.293a1 1 0 0 0 1.414 0l4.707-4.707 1.293 1.293A1 1 0 0 0 19 9.586v-4a1 1 0 0 0-1-1h-4a1 1 0 0 0-.707 1.707l1.707 1.707z" />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Search Merchandising
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Promote high-converting items at the top of search result
                  listings dynamically.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <button
                  onClick={() =>
                    alert("Search Merchandising module coming soon!")
                  }
                  style={{
                    background: "none",
                    border: "none",
                    color: "#008060",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    padding: 0,
                  }}
                >
                  Manage search ranking →
                </button>
              </div>
            </s-box>

            {/* Box 3: Search Synonym */}
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              style={{
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "160px",
              }}
            >
              <div>
                <s-stack direction="inline" gap="small" blockAlign="center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
                  >
                    <path d="M17.707 9.293l-7-7A1 1 0 0 0 10 2H3a1 1 0 0 0-1 1v7a1 1 0 0 0 .293.707l7 7a1 1 0 0 0 1.414 0l7-7a1 1 0 0 0 0-1.414zM5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                  </svg>
                  <s-text variant="headingSm" fontWeight="bold">
                    Search Synonym
                  </s-text>
                </s-stack>
                <s-paragraph
                  style={{
                    fontSize: "13px",
                    color: "#6d7175",
                    marginTop: "8px",
                  }}
                >
                  Create synonyms to help users find matching products with
                  alternative search terms.
                </s-paragraph>
              </div>
              <div style={{ marginTop: "16px" }}>
                <button
                  onClick={() =>
                    alert("Search Synonym configuration coming soon!")
                  }
                  style={{
                    background: "none",
                    border: "none",
                    color: "#008060",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    padding: 0,
                  }}
                >
                  Configure synonyms →
                </button>
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
