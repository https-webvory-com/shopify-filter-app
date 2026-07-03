import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
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

  const activeSyncJob = await prisma.syncJob.findFirst({
    where: { shop: session.shop, status: "IN_PROGRESS" },
  });

  return { 
    syncedProductsCount, 
    isSyncingBackground: !!activeSyncJob 
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "sync") {
    try {
      const result = await syncProducts(session.shop, admin);
      return { success: true, message: result.message, type: "sync" };
    } catch (e) {
      console.error("Sync error:", e);
      return { error: e.message, type: "sync" };
    }
  }

  return null;
};

export default function Index() {
  const { syncedProductsCount, isSyncingBackground } = useLoaderData();
  const syncFetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const isSyncing =
    (["loading", "submitting"].includes(syncFetcher.state) &&
      syncFetcher.formData?.get("actionType") === "sync") ||
    isSyncingBackground;

  useEffect(() => {
    if (syncFetcher.data?.success && syncFetcher.data?.type === "sync") {
      shopify.toast.show(syncFetcher.data.message || "Sync started in background!");
    } else if (syncFetcher.data?.error) {
      shopify.toast.show(`Sync failed: ${syncFetcher.data.error}`, {
        isError: true,
      });
    }
  }, [syncFetcher.data, shopify]);

  // Poll for sync completion if running in background
  useEffect(() => {
    if (isSyncingBackground) {
      const interval = setInterval(() => {
        revalidate();
      }, 3000); // Check every 3 seconds
      return () => clearInterval(interval);
    }
  }, [isSyncingBackground, revalidate]);

  const triggerSync = () =>
    syncFetcher.submit({ actionType: "sync" }, { method: "POST" });

  // Since sync is now background, we just show the initial loader count
  const currentCount = syncedProductsCount;

  return (
    <s-page heading="Collection Filter Pro Dashboard">
      <ui-title-bar title="Dashboard"></ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .dash-section-title {
            font-size: 18px;
            font-weight: 700;
            color: #1E1B4B;
            margin: 32px 0 16px 0;
            font-family: "Inter", sans-serif;
          }

          .sov-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            margin-bottom: 24px;
          }

          @media (max-width: 900px) {
            .sov-grid { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 600px) {
            .sov-grid { grid-template-columns: 1fr; }
          }

          /* ✨ Active Card ✨ */
          .sov-card {
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #ede9fe;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1),
                        box-shadow 0.28s cubic-bezier(0.16,1,0.3,1),
                        border-color 0.28s ease;
            box-shadow: 0 1px 3px rgba(91,33,182,0.06),
                        0 1px 8px rgba(0,0,0,0.04);
            min-height: 200px;
            position: relative;
          }

          .sov-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(91,33,182,0.10),
                        0 1px 4px rgba(0,0,0,0.04);
            border-color: #a5b4fc;
          }

          /* ✨ Coming Soon Card ✨ */
          .sov-card-soon {
            background: #fafafa;
            border-radius: 16px;
            border: 1.5px dashed #d8b4fe;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            cursor: not-allowed;
            position: relative;
            box-shadow: none;
            min-height: 200px;
          }

          /* Corner ribbon */
          .sov-soon-ribbon {
            position: absolute;
            top: 11px;
            right: -22px;
            background: linear-gradient(90deg, #7C3AED, #5B21B6);
            color: #ffffff;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.8px;
            z-index: 10;
            box-shadow: 0 2px 6px rgba(91,33,182,0.3);
            transform: rotate(45deg);
            padding: 4px 30px;
            text-align: center;
          }

          /* Muted coming soon text */
          .sov-card-soon .sov-card-title {
            color: #9ca3af;
          }
          .sov-card-soon .sov-card-desc {
            color: #c4b5fd;
          }

          .sov-card-soon .sov-card-icon {
            background: #f3f4f6;
            color: #d1d5db;
          }

          /* Coming soon bottom bar */
          .sov-soon-bar {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 8px;
            background: linear-gradient(90deg, #f5f3ff, #ede9fe);
            border: 1px solid #ddd6fe;
            font-size: 12px;
            font-weight: 700;
            color: #7C3AED;
            letter-spacing: 0.4px;
            align-self: flex-start;
          }

          .sov-soon-icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
          }

          .sov-card-body {
            padding: 24px;
            flex: 1;
            display: flex;
            flex-direction: column;
          }

          .sov-card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
          }

          .sov-card-icon {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #5B21B6;
            flex-shrink: 0;
            transition: all 0.3s ease;
          }

          .sov-card:hover .sov-card-icon {
            background: #5B21B6;
            color: #ffffff;
            transform: scale(1.05);
          }

          .sov-card-title {
            font-size: 15px;
            font-weight: 700;
            color: #1e1b4b;
            margin: 0;
            line-height: 1.3;
          }

          .sov-card-desc {
            font-size: 13.5px;
            color: #64748b;
            line-height: 1.6;
            margin: 0 0 20px 0;
            flex: 1;
          }

          /* Active CTA button */
          .sov-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #5B21B6;
            font-size: 13px;
            font-weight: 600;
            padding: 8px 16px;
            border-radius: 20px;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            align-self: flex-start;
          }

          .sov-card:hover .sov-btn {
            background: #f3e8ff;
            border-color: #d8b4fe;
            color: #4c1d95;
          }

          /* Text link CTA */
          .sov-link-btn {
            background: none;
            border: none;
            color: #5B21B6;
            font-size: 13px;
            font-weight: 600;
            padding: 0;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            align-self: flex-start;
          }

          .sov-card:hover .sov-link-btn {
            color: #7C3AED;
            gap: 8px;
          }
        `,
        }}
      />

      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          paddingBottom: "60px",
          fontFamily: '"Inter", sans-serif',
        }}
      >
        {/* Sync Controls Banner */}
        <div
          style={{
            background:
              "linear-gradient(135deg, rgba(91, 33, 182, 0.05) 0%, rgba(124, 58, 237, 0.02) 100%)",
            border: "1px solid rgba(91, 33, 182, 0.1)",
            borderRadius: "16px",
            padding: "24px 32px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "20px",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#1E1B4B",
                margin: "0 0 8px 0",
              }}
            >
              Database Synchronization
            </h2>
            <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
              <strong style={{ color: "#1E1B4B" }}>Status:</strong>{" "}
              {currentCount} products successfully synced and ready for
              filtering.
            </p>
          </div>
          <button
            onClick={triggerSync}
            disabled={isSyncing}
            style={{
              background: isSyncing ? "#9ca3af" : "#ffffff",
              color: isSyncing ? "#ffffff" : "#5B21B6",
              border: isSyncing ? "none" : "1px solid #d8b4fe",
              padding: "10px 20px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: "600",
              cursor: isSyncing ? "not-allowed" : "pointer",
              boxShadow: isSyncing
                ? "none"
                : "0 2px 8px rgba(91, 33, 182, 0.08)",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
            onMouseEnter={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.background = "#f3e8ff";
                e.currentTarget.style.borderColor = "#c084fc";
              }
            }}
            onMouseLeave={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.borderColor = "#d8b4fe";
              }
            }}
          >
            {isSyncing ? (
              <svg
                style={{
                  animation: "spin 1s linear infinite",
                  width: "18px",
                  height: "18px",
                }}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeOpacity="0.3"
                ></circle>
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                ></path>
              </svg>
            )}
            {isSyncing ? "Syncing..." : "Sync Products from Shopify"}
          </button>
        </div>

        {/* Set Up Guide */}
        <h2 className="dash-section-title">Set up guide</h2>
        <div className="sov-grid">
          {/* Card 1: Theme Setup */}
          <div
            className="sov-card"
            onClick={() => navigate("/app/settings/theme-setup")}
          >
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
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
                </div>
                <h3 className="sov-card-title">Theme Setup</h3>
              </div>
              <p className="sov-card-desc">
                Automatically set up Filter + Search widget on a specific theme.
                You can duplicate a theme and set it up on an unpublished theme
                for testing.
              </p>
              <button className="sov-btn">Setup theme</button>
            </div>
          </div>

          {/* Card 2: Configure Search Settings */}
          <div className="sov-card" onClick={() => navigate("/app/search")}>
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    ></path>
                  </svg>
                </div>
                <h3 className="sov-card-title">Search Settings</h3>
              </div>
              <p className="sov-card-desc">
                Set meaningful searchable attributes, customize search logic,
                and index specific fields to improve product discoverability.
              </p>
              <button className="sov-btn">Configure</button>
            </div>
          </div>

          {/* Card 3: Set Up Product Filters */}
          <div
            className="sov-card"
            onClick={() => navigate("/app/filters/groups")}
          >
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    ></path>
                  </svg>
                </div>
                <h3 className="sov-card-title">Product Filters</h3>
              </div>
              <p className="sov-card-desc">
                Set up or edit Smart product filters, custom option values, and
                tags on your store to help customers narrow down their choices.
              </p>
              <button className="sov-btn">Setup filters</button>
            </div>
          </div>
        </div>

        {/* Improve Sales and Conversion */}
        <h2 className="dash-section-title">Improve sales and conversion</h2>
        <div className="sov-grid">
          {/* Box 1: Collection Merchandising */}
          <div
            className="sov-card"
            onClick={() => navigate("/app/collections/merchandising")}
          >
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    ></path>
                  </svg>
                </div>
                <h3 className="sov-card-title">Collection Merchandising</h3>
              </div>
              <p className="sov-card-desc">
                Customize product ranking and order in collection pages to
                promote featured products.
              </p>
              <button className="sov-link-btn">
                Manage merchandising
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  ></path>
                </svg>
              </button>
            </div>
          </div>

          {/* Box 2: Search Merchandising */}
          <div
            className="sov-card"
            onClick={() => navigate("/app/search/merchandising")}
          >
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    ></path>
                  </svg>
                </div>
                <h3 className="sov-card-title">Search Merchandising</h3>
              </div>
              <p className="sov-card-desc">
                Promote high-converting items at the top of search result
                listings dynamically.
              </p>
              <button className="sov-link-btn">
                Manage search ranking
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  ></path>
                </svg>
              </button>
            </div>
          </div>

          {/* Box 3: Search Synonym */}
          <div className="sov-card">
            <div className="sov-card-body">
              <div className="sov-card-header">
                <div className="sov-card-icon">
                  <svg
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    ></path>
                  </svg>
                </div>
                <h3 className="sov-card-title">Search Synonym</h3>
              </div>
              <p className="sov-card-desc">
                Create synonyms to help users find matching products with
                alternative search terms.
              </p>
              <button
                className="sov-link-btn"
                onClick={() => navigate("/app/search/synonyms")}
              >
                Manage synonyms
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  ></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
