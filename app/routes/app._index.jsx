import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useRevalidator, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProducts } from "../services/sync.server";
import { syncHistoricalOrders } from "../services/orders.server";
import { productSyncQueue } from "../services/productSyncQueue.server.js";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import { syncErrorMessage, syncIssueForJob, productSyncJobWhere, isCompletedSyncTransition } from "../utils/syncError.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const scope = productSyncJobWhere(shop);
  const syncedProductsCount = await prisma.product.count({ where: { shop } });
  let latestJob = await prisma.syncJob.findFirst({ where: scope, orderBy: { createdAt: "desc" } });

  // Legacy completion flags were written before all final steps finished.
  if (latestJob?.status === "COMPLETED" && !latestJob.completedAt) {
    latestJob = await prisma.syncJob.update({ where: { id: latestJob.id }, data: {
      status: "FAILED", kind: "PRODUCTS",
      lastError: "This earlier sync was not verified as complete. Resume it from the saved position.",
    } });
  }
  let syncQueueState = null;
  if (latestJob?.status === "IN_PROGRESS" || latestJob?.status === "FAILED") {
    try {
      const queued = await productSyncQueue.getJob(latestJob.id);
      syncQueueState = queued ? await queued.getState() : "missing";
      const pending = ["waiting", "delayed", "active", "prioritized", "waiting-children"].includes(syncQueueState);
      if (pending && latestJob.status === "FAILED") {
        // The dashboard previously mistook a waiting job for a stopped worker.
        latestJob = await prisma.syncJob.update({ where: { id: latestJob.id }, data: {
          status: "IN_PROGRESS", lastError: null,
        } });
      } else if (!pending && latestJob.status === "IN_PROGRESS") {
        const stale = Date.now() - new Date(latestJob.updatedAt).getTime() > 5 * 60 * 1000;
        if (syncQueueState === "failed" || stale) {
          latestJob = await prisma.syncJob.update({ where: { id: latestJob.id }, data: {
            status: "FAILED", lastError: queued?.failedReason ? syncErrorMessage(new Error(queued.failedReason)) :
              "No running or queued sync was found. Resume it from the saved position.",
          } });
        }
      }
    } catch (error) {
      // A Redis outage is not evidence that the saved sync itself has failed.
      console.error("CFP: Unable to read sync queue status:", error.message);
      syncQueueState = "unavailable";
    }
  }
  const lastCompletedJob = await prisma.syncJob.findFirst({
    where: { ...scope, status: "COMPLETED", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  const active = latestJob?.status === "IN_PROGRESS";
  const failed = latestJob?.status === "FAILED";
  const progress = latestJob ? {
    processed: latestJob.productsProcessed ?? 0,
    total: latestJob.totalProducts || null,
  } : null;
  return {
    syncQueueState,
    syncedProductsCount,
    isSyncingBackground: active,
    lastSyncedAt: lastCompletedJob?.completedAt ?? null,
    syncIssue: syncIssueForJob(latestJob),
    latestSyncId: latestJob?.id ?? null,
    latestSyncStatus: latestJob?.status ?? "IDLE",
    syncProgress: progress,
    resumableJob: failed ? progress : null,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "sync" || actionType === "force_sync") {
    try {
      const forceFresh = actionType === "force_sync";
      const result = await syncProducts(session.shop, admin, session, forceFresh);
      return { success: true, message: result.message, type: "sync" };
    } catch (e) {
      console.error("Sync error:", e);
      return { error: syncErrorMessage(e), type: "sync" };
    }
  }

  if (actionType === "sync_orders") {
    try {
      // Run orders sync in background (don't await fully)
      syncHistoricalOrders(session.shop).then(() => {
        console.log("Orders sync completed for", session.shop);
      }).catch(err => {
        console.error("Orders sync failed:", err);
      });
      return { success: true, message: "Orders sync started in background! This may take a few minutes.", type: "sync_orders" };
    } catch (e) {
      console.error("Orders sync error:", e);
      return { error: e.message, type: "sync_orders" };
    }
  }

  return null;
};

export default function Index() {
  const { syncQueueState, syncedProductsCount, isSyncingBackground, lastSyncedAt, syncIssue, syncProgress, resumableJob, latestSyncStatus, latestSyncId } = useLoaderData();
  const syncFetcher = useFetcher();
  const statsFetcher = useFetcher();
  const ordersSyncStatusFetcher = useFetcher();
  const shopify = useAppBridge();
  const { revalidate } = useRevalidator();

  const navigate = useNavigate();

  useEffect(() => {
    if (statsFetcher.state === "idle" && !statsFetcher.data) {
      statsFetcher.load("/app/api/stats");
    }
  }, [statsFetcher]);

  const shopifyStats = statsFetcher.data || null;
  const shopifyActiveCount = shopifyStats?.activeProducts ?? null;
  const shopifyPublishedCount = shopifyStats?.publishedProducts ?? null;
  const shopifyUnpublishedCount = shopifyStats?.unpublishedProducts ?? null;

  const isSyncing =
    (["loading", "submitting"].includes(syncFetcher.state) &&
      syncFetcher.formData?.get("actionType") === "sync") ||
    isSyncingBackground;

  // Orders sync status from polling
  const ordersSyncStatus = ordersSyncStatusFetcher.data?.status || "IDLE";
  const ordersProcessed = ordersSyncStatusFetcher.data?.ordersProcessed || 0;
  const isOrdersSyncing = ordersSyncStatus === "IN_PROGRESS" ||
    (["loading", "submitting"].includes(syncFetcher.state) &&
      syncFetcher.formData?.get("actionType") === "sync_orders");

  // Poll orders sync status every 3 seconds while syncing
  useEffect(() => {
    // Load initial status
    if (ordersSyncStatusFetcher.state === "idle" && !ordersSyncStatusFetcher.data) {
      ordersSyncStatusFetcher.load("/app/api/orders-sync-status");
    }

    if (isOrdersSyncing || ordersSyncStatus === "IN_PROGRESS") {
      const interval = setInterval(() => {
        ordersSyncStatusFetcher.load("/app/api/orders-sync-status");
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isOrdersSyncing, ordersSyncStatus, ordersSyncStatusFetcher]);

  // Toast when orders sync completes
  const wasOrdersSyncingRef = useRef(false);
  useEffect(() => {
    if (wasOrdersSyncingRef.current === true && ordersSyncStatus === "COMPLETED") {
      shopify.toast.show("✅ Sales data synced! Best Selling scores updated for all products.", { duration: 6000 });
    }
    if (wasOrdersSyncingRef.current === true && ordersSyncStatus === "FAILED") {
      shopify.toast.show("❌ Sales data sync failed. Please try again.", { isError: true, duration: 5000 });
    }
    wasOrdersSyncingRef.current = ordersSyncStatus === "IN_PROGRESS";
  }, [ordersSyncStatus, shopify]);

  useEffect(() => {
    if (syncFetcher.data?.success && (syncFetcher.data?.type === "sync" || syncFetcher.data?.type === "sync_orders")) {
      shopify.toast.show(syncFetcher.data.message || "Sync started in background!", { duration: 6000 });
      // Start polling immediately when sync_orders is triggered
      if (syncFetcher.data?.type === "sync_orders") {
        setTimeout(() => ordersSyncStatusFetcher.load("/app/api/orders-sync-status"), 1000);
      }
    } else if (syncFetcher.data?.error) {
      shopify.toast.show(`Sync failed: ${syncFetcher.data.error}`, {
        isError: true,
      });
    }
  }, [syncFetcher.data, shopify]);

  // Only the same attempt changing from running to verified completion can succeed.
  const previousSyncRef = useRef(null);
  useEffect(() => {
    const previous = previousSyncRef.current;
    if (isCompletedSyncTransition(previous, { id: latestSyncId, status: latestSyncStatus })) {
      shopify.toast.show("Sync complete! Published products are ready for filtering.", { duration: 5000 });
      statsFetcher.load("/app/api/stats");
    }
    previousSyncRef.current = { id: latestSyncId, status: latestSyncStatus };
  }, [latestSyncId, latestSyncStatus, shopify]);

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

  const triggerForceSync = () =>
    syncFetcher.submit({ actionType: "force_sync" }, { method: "POST" });

  // Since sync is now background, we just show the initial loader count
  const currentCount = syncedProductsCount;

  return (
    <s-page heading="AI Search & Filter Dashboard">
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

          /* âœ¨ Active Card âœ¨ */
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

          /* âœ¨ Coming Soon Card âœ¨ */
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
        {/* ———————————————————————————————————————————————— */}
        {!shopifyStats && (
          <div style={{ minHeight: "200px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LoadingSpinner text="Fetching store overview..." />
          </div>
        )}
        {shopifyStats && (
          <>
            <h2 className="dash-section-title" style={{ marginTop: "0" }}>Store Overview</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>

              {[
                { label: "Total Products",      value: shopifyStats.totalProducts,      dot: "#1E1B4B", icon: "📦" },
                { label: "Active",              value: shopifyStats.activeProducts,     dot: "#16a34a", icon: "●" },
                { label: "Draft",               value: shopifyStats.draftProducts,      dot: "#d97706", icon: "●" },
                { label: "Archived",            value: shopifyStats.archivedProducts,   dot: "#94a3b8", icon: "●" },
                { label: "Total Collections",   value: shopifyStats.allCollections,     dot: "#7c3aed", icon: "📁" },
                { label: "Published",           value: shopifyStats.publishedCollections, dot: "#2563eb", icon: "●" },
                { label: "Smart Collections",   value: shopifyStats.smartCollections,   dot: "#e11d48", icon: "⚡" },
                { label: "Synced to DB",        value: syncedProductsCount,             dot: "#5B21B6", icon: "✓",  highlight: true },
              ].map(({ label, value, dot, icon, highlight }) => (
                <div
                  key={label}
                  style={{
                    background: highlight ? "rgba(91,33,182,0.04)" : "#ffffff",
                    border: highlight ? "1px solid rgba(91,33,182,0.2)" : "1px solid #e8edf2",
                    borderRadius: "14px",
                    padding: "20px 20px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {/* Top row: icon dot + label */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "10px", color: dot, lineHeight: 1 }}>{icon === "●" ? "●" : icon === "✓" ? "✓" : icon}</span>
                    <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>{label}</span>
                  </div>
                  {/* Big number */}
                  <div style={{ fontSize: "30px", fontWeight: "800", color: highlight ? "#5B21B6" : "#1E1B4B", letterSpacing: "-0.5px", lineHeight: 1 }}>
                    {value.toLocaleString()}
                  </div>
                </div>
              ))}

            </div>
          </>
        )}

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
          <div style={{ flex: 1 }}>
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

            {isSyncingBackground && ["waiting", "delayed", "prioritized", "waiting-children"].includes(syncQueueState) && (
              <p role="status">Sync is queued. It will continue automatically from the saved position when the worker is available.</p>
            )}
            {isSyncingBackground && syncQueueState === "unavailable" && (
              <p role="status">Sync queue status is temporarily unavailable. Saved progress is preserved.</p>
            )}
            {/* Synced vs Total */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "14px", color: "#64748b" }}>
                {/* During active sync — show live processed count */}
                {syncProgress ? (
                  <>
                    <strong style={{ color: "#7c3aed", fontSize: "16px" }}>
                      {syncProgress.processed.toLocaleString()}
                    </strong>
                    {syncProgress.total
                      ? <span> / {syncProgress.total.toLocaleString()} {latestSyncStatus === "COMPLETED" ? "processed" : latestSyncStatus === "FAILED" ? "sync stopped" : "syncing..."}</span>
                      : <span> products processed{latestSyncStatus === "FAILED" ? " before sync stopped" : ""}</span>}
                  </>
                ) : shopifyActiveCount ? (
                  <>
                    <strong style={{ color: "#1E1B4B", fontSize: "16px" }}>
                      {Math.min(currentCount, shopifyActiveCount).toLocaleString()}
                    </strong>
                    <span> / {shopifyActiveCount.toLocaleString()} active products synced</span>
                  </>
                ) : (
                  <>
                    <strong style={{ color: "#1E1B4B", fontSize: "16px" }}>{currentCount.toLocaleString()}</strong>
                    <span> products synced</span>
                  </>
                )}
              </span>

              {/* Fully synced */}
              {!isSyncing && latestSyncStatus === "COMPLETED" && !syncIssue && (
                <span style={{ background: "#dcfce7", color: "#16a34a", fontSize: "12px", fontWeight: "600", padding: "2px 10px", borderRadius: "20px" }}>
                  ✅ Fully Synced
                </span>
              )}
              {shopifyUnpublishedCount > 0 && (
                <span style={{ background: "#f1f5f9", color: "#475569", fontSize: "12px", padding: "2px 10px", borderRadius: "20px" }}>
                  {shopifyUnpublishedCount.toLocaleString()} unpublished products excluded from listings
                </span>
              )}
              {shopifyPublishedCount !== null && (
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  {currentCount.toLocaleString()} products in database / {shopifyPublishedCount.toLocaleString()} published products
                </span>
              )}
            </div>

            {/* Progress bar — live during sync OR static DB progress */}
            {(() => {
              const total = syncProgress ? syncProgress.total : shopifyActiveCount;
              const done  = syncProgress ? syncProgress.processed : currentCount;
              if (!total || total === 0) return null;
              const pct = Math.min(100, Math.round((done / total) * 100));
              const color = latestSyncStatus === "COMPLETED" ? "#16a34a" : latestSyncStatus === "FAILED" ? "#dc2626" : "#7c3aed";
              return (
                <div style={{ marginBottom: "6px" }}>
                  <div style={{ background: "#e2e8f0", borderRadius: "999px", height: "8px", width: "100%", maxWidth: "340px" }}>
                    <div style={{ background: color, borderRadius: "999px", height: "8px", width: `${pct}%`, transition: "width 0.6s ease" }} />
                  </div>
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px" }}>
                    {pct}% — {done.toLocaleString()} / {total.toLocaleString()}
                  </div>
                </div>
              );
            })()}

            {lastSyncedAt && !isSyncing && (
              <p style={{ color: "#94a3b8", margin: 0, fontSize: "12px" }}>
                Last completed sync: {new Date(lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={triggerSync}
              disabled={isSyncing}
              style={{
                background: isSyncing ? "#9333ea" : "#ffffff",
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
                <>
                  <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
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
                </>
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
              {isSyncing ? "Syncing..." : resumableJob ? "▶ Resume Sync" : "Sync Products from Shopify"}
            </button>

            {resumableJob && !isSyncing && (
              <button
                onClick={triggerForceSync}
                style={{
                  background: "#7c3aed",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Start a fresh sync from product 1 (recommended after best-selling rank updates)"
              >
                🔄 Restart Full Sync
              </button>
            )}

            {/* Sync Sales Data Button */}
            <button
              onClick={() => syncFetcher.submit({ actionType: "sync_orders" }, { method: "POST" })}
              disabled={isSyncing}
              style={{
                background: "#059669",
                color: "#ffffff",
                border: "none",
                padding: "10px 16px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: isSyncing ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                opacity: isSyncing ? 0.6 : 1,
              }}
              title="Sync ALL-TIME sales data from Shopify Orders to calculate accurate Best Selling scores (may take 5-15 mins)"
            >
              📊 Sync Sales Data (Best Selling)
            </button>
          </div>
        </div>

        {/* Orders Sync Progress Card */}
        {(isOrdersSyncing || ordersSyncStatus === "COMPLETED" || ordersSyncStatus === "FAILED") && (
          <div style={{
            background: isOrdersSyncing ? "linear-gradient(135deg, #ecfdf5, #d1fae5)" :
                        ordersSyncStatus === "COMPLETED" ? "linear-gradient(135deg, #ecfdf5, #d1fae5)" :
                        "linear-gradient(135deg, #fef2f2, #fee2e2)",
            border: `1px solid ${isOrdersSyncing ? "#6ee7b7" : ordersSyncStatus === "COMPLETED" ? "#10b981" : "#fca5a5"}`,
            borderRadius: "16px",
            padding: "20px 24px",
            marginTop: "16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              {isOrdersSyncing ? (
                <div style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  border: "3px solid #10b981", borderTopColor: "transparent",
                  animation: "spin 1s linear infinite",
                  flexShrink: 0,
                }} />
              ) : ordersSyncStatus === "COMPLETED" ? (
                <span style={{ fontSize: "28px" }}>✅</span>
              ) : (
                <span style={{ fontSize: "28px" }}>❌</span>
              )}
              <div>
                <div style={{ fontWeight: "700", fontSize: "15px", color: "#065f46" }}>
                  {isOrdersSyncing ? "Syncing Sales Data..." : ordersSyncStatus === "COMPLETED" ? "Sales Data Synced!" : "Sync Failed"}
                </div>
                <div style={{ fontSize: "13px", color: "#047857", marginTop: "2px" }}>
                  {isOrdersSyncing
                    ? `📦 ${ordersProcessed.toLocaleString()} orders processed so far... Please wait`
                    : ordersSyncStatus === "COMPLETED"
                    ? `✓ ${ordersProcessed.toLocaleString()} orders processed — Best Selling scores updated!`
                    : "Something went wrong. Please try again."}
                </div>
              </div>
            </div>

            {/* Animated progress bar */}
            {isOrdersSyncing && (
              <div style={{ background: "#a7f3d0", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  borderRadius: "999px",
                  background: "linear-gradient(90deg, #10b981, #059669)",
                  width: "100%",
                  animation: "ordersSyncPulse 2s ease-in-out infinite",
                }} />
              </div>
            )}

            {/* Progress: completed bar */}
            {ordersSyncStatus === "COMPLETED" && (
              <div style={{ background: "#a7f3d0", borderRadius: "999px", height: "8px" }}>
                <div style={{ height: "100%", borderRadius: "999px", background: "#10b981", width: "100%" }} />
              </div>
            )}

            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes spin { to { transform: rotate(360deg); } }
              @keyframes ordersSyncPulse {
                0%, 100% { opacity: 0.6; transform: scaleX(0.7); transform-origin: left; }
                50% { opacity: 1; transform: scaleX(1); transform-origin: left; }
              }
            `}} />
          </div>
        )}

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

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status < 500) return boundary.error(error);
  return (
    <s-page heading="Sync status unavailable">
      <div role="alert" style={{ padding: "20px", background: "#fef2f2", borderRadius: "8px", color: "#991b1b" }}>
        <h2>We could not load the sync status</h2>
        <p>The app or its connection is unavailable. This does not mean the sync completed.</p>
        <p>Refresh to check whether the background sync is running or needs attention.</p>
        <button type="button" onClick={() => window.location.reload()}>Retry</button>
      </div>
    </s-page>
  );
}
