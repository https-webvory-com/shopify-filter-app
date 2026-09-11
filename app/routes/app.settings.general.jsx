import { useNavigate } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import {
  getFilterGlobalSettings,
  updateFilterGlobalSettings,
} from "../services/filterSettings.server";

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const settings = await getFilterGlobalSettings(session.shop);
    return Response.json({ settings });
  } catch (error) {
    console.error("LOADER ERROR:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const payload = {
    showOnlyInStock: formData.get("showOnlyInStock") === "true",
    secondImageOnHover: formData.get("secondImageOnHover") === "true",
    showQuickViewInstantSearch:
      formData.get("showQuickViewInstantSearch") === "true",
    showQuickViewCollection: formData.get("showQuickViewCollection") === "true",
    ...(formData.has("quickViewStyle")
      ? { quickViewStyle: formData.get("quickViewStyle") === "theme" ? "theme" : "app" }
      : {}),
    ...(formData.has("showQuickViewSizeChart")
      ? { showQuickViewSizeChart: formData.get("showQuickViewSizeChart") === "true" }
      : {}),
    ...(formData.has("quickViewInstantSearchStyle")
      ? { quickViewInstantSearchStyle: formData.get("quickViewInstantSearchStyle") === "theme" ? "theme" : "app" }
      : {}),
    ...(formData.has("showQuickViewInstantSearchSizeChart")
      ? { showQuickViewInstantSearchSizeChart: formData.get("showQuickViewInstantSearchSizeChart") === "true" }
      : {}),
    isWholesale: formData.get("isWholesale") === "true",
  };

  await updateFilterGlobalSettings(session.shop, payload);
  return Response.json({ success: true });
};

export default function Settings() {
  const navigate = useNavigate();
  const { settings } = useLoaderData();
  const fetcher = useFetcher();

  const showOnlyInStock = fetcher.formData
    ? fetcher.formData.get("showOnlyInStock") === "true"
    : (settings?.showOnlyInStock ?? false);
  const secondImageOnHover = fetcher.formData
    ? fetcher.formData.get("secondImageOnHover") === "true"
    : (settings?.secondImageOnHover ?? true);
  const showQuickViewInstantSearch = fetcher.formData
    ? fetcher.formData.get("showQuickViewInstantSearch") === "true"
    : (settings?.showQuickViewInstantSearch ?? true);
  const showQuickViewCollection = fetcher.formData
    ? fetcher.formData.get("showQuickViewCollection") === "true"
    : (settings?.showQuickViewCollection ?? true);
  const isWholesale = fetcher.formData
    ? fetcher.formData.get("isWholesale") === "true"
    : (settings?.isWholesale ?? false);
  const showQuickViewSizeChart = fetcher.formData
    ? fetcher.formData.get("showQuickViewSizeChart") === "true"
    : (settings?.showQuickViewSizeChart ?? false);
  const quickViewStyle = (fetcher.formData?.get("quickViewStyle") ?? settings?.quickViewStyle) === "theme" ? "theme" : "app";
  const quickViewInstantSearchStyle = (
    fetcher.formData?.get("quickViewInstantSearchStyle") ??
    settings?.quickViewInstantSearchStyle ?? settings?.quickViewStyle
  ) === "theme" ? "theme" : "app";
  const showQuickViewInstantSearchSizeChart = fetcher.formData
    ? fetcher.formData.get("showQuickViewInstantSearchSizeChart") === "true"
    : (settings?.showQuickViewInstantSearchSizeChart ?? settings?.showQuickViewSizeChart ?? false);

  const toggleSetting = (key, currentValue) => {
    fetcher.submit(
      {
        quickViewStyle: key === "quickViewStyle" ? currentValue : quickViewStyle,
        quickViewInstantSearchStyle:
          key === "quickViewInstantSearchStyle" ? currentValue : quickViewInstantSearchStyle,
        showQuickViewInstantSearchSizeChart:
          key === "showQuickViewInstantSearchSizeChart"
            ? String(!currentValue)
            : String(showQuickViewInstantSearchSizeChart),
        showQuickViewSizeChart:
          key === "showQuickViewSizeChart"
            ? String(!currentValue)
            : String(showQuickViewSizeChart),
        showOnlyInStock:
          key === "showOnlyInStock"
            ? String(!currentValue)
            : String(showOnlyInStock),
        secondImageOnHover:
          key === "secondImageOnHover"
            ? String(!currentValue)
            : String(secondImageOnHover),
        showQuickViewInstantSearch:
          key === "showQuickViewInstantSearch"
            ? String(!currentValue)
            : String(showQuickViewInstantSearch),
        showQuickViewCollection:
          key === "showQuickViewCollection"
            ? String(!currentValue)
            : String(showQuickViewCollection),
        isWholesale:
          key === "isWholesale"
            ? String(!currentValue)
            : String(isWholesale),
      },
      { method: "POST" },
    );
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Display settings updated");
    }
  }, [fetcher.data]);

  const renderQuickViewOptions = (instantSearch) => {
    const id = instantSearch ? "instant-quick-view" : "collection-quick-view";
    const style = instantSearch ? quickViewInstantSearchStyle : quickViewStyle;
    const sizeChart = instantSearch ? showQuickViewInstantSearchSizeChart : showQuickViewSizeChart;
    return (
      <div className="quick-view-options">
        <div className="quick-view-field">
          <label className="quick-view-label" htmlFor={`${id}-style`}>Quick View style</label>
          <div className="quick-view-select-wrap">
            <select
              className="quick-view-select"
              id={`${id}-style`}
              value={style}
              disabled={fetcher.state !== "idle"}
              onChange={(event) => toggleSetting(instantSearch ? "quickViewInstantSearchStyle" : "quickViewStyle", event.target.value)}
              aria-describedby={`${id}-style-help`}
            >
              <option value="app">App default</option>
              <option value="theme">Theme Quick View when available</option>
            </select>
            <svg className="quick-view-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="int-desc" id={`${id}-style-help`}>
            {style === "theme"
              ? "Uses your theme’s Quick View when supported; otherwise, uses App default."
              : "Uses the app’s Quick View for a consistent product preview."}
            {" "}{instantSearch ? "Applies only to instant search." : "Applies only to collection and search results."}
          </p>
        </div>
        <div className="quick-view-field">
          <label className="quick-view-checkbox" htmlFor={`${id}-size-chart`}>
            <input
              id={`${id}-size-chart`}
              type="checkbox"
              checked={sizeChart}
              disabled={fetcher.state !== "idle"}
              aria-describedby={`${id}-size-chart-help`}
              onChange={() => toggleSetting(instantSearch ? "showQuickViewInstantSearchSizeChart" : "showQuickViewSizeChart", sizeChart)}
            />
            Show size chart
          </label>
          <p className="int-desc" id={`${id}-size-chart-help`}>Show a size chart link in this Quick View. Requires a compatible theme size chart.</p>
        </div>
      </div>
    );
  };

  console.log("Settings rendering with settings data:", settings);
  console.log("Derived values:", {
    showOnlyInStock,
    secondImageOnHover,
    showQuickViewInstantSearch,
    showQuickViewCollection,
    isWholesale
  });

  return (
    <s-page heading="App Settings">
      <ui-title-bar title="App Settings">
        <button variant="breadcrumb" onClick={() => navigate("/app/settings")}>
          Settings
        </button>
      </ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .int-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 24px;
            margin-top: 24px;
          }
          @media (max-width: 700px) {
            .int-grid { grid-template-columns: 1fr; }
          }
          .int-card {
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #ede9fe;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1),
                        box-shadow 0.28s cubic-bezier(0.16,1,0.3,1),
                        border-color 0.28s ease;
            box-shadow: 0 1px 3px rgba(91,33,182,0.06), 0 1px 8px rgba(0,0,0,0.04);
          }
          .int-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(91,33,182,0.10), 0 1px 4px rgba(0,0,0,0.04);
            border-color: #a5b4fc;
          }
          .int-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .int-title {
            font-size: 15px;
            font-weight: 700;
            color: #1f2937;
            margin: 0;
            margin-bottom: 6px;
          }
          .int-desc {
            font-size: 13.5px;
            color: #6b7280;
            line-height: 1.5;
            margin: 0;
          }
          .int-tag {
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 4px 10px;
            border-radius: 12px;
          }
          .int-tag-inventory {
            color: #4338ca;
            background: #e0e7ff;
          }
          .int-toggle {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
          }
          .int-toggle input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .int-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #cbd5e1;
            transition: .3s;
            border-radius: 24px;
          }
          .int-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .3s;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          }
          .int-toggle input:checked + .int-slider {
            background: linear-gradient(160deg, #7C3AED 0%, #5B21B6 100%);
          }
          .int-toggle input:checked + .int-slider:before {
            transform: translateX(20px);
          }
          .int-toggle input:focus-visible + .int-slider {
            outline: 2px solid #7c3aed;
            outline-offset: 3px;
          }
          .int-toggle input:disabled + .int-slider {
            cursor: wait;
            opacity: 0.6;
          }
          .quick-view-options {
            display: grid;
            gap: 20px;
            border-top: 1px solid #ede9fe;
            padding-top: 20px;
          }
          .quick-view-field {
            display: grid;
            gap: 8px;
          }
          .quick-view-label, .quick-view-checkbox {
            font-size: 13.5px;
            font-weight: 600;
            color: #374151;
          }
          .quick-view-select-wrap {
            position: relative;
            min-width: 0;
          }
          .quick-view-select {
            appearance: none;
            box-sizing: border-box;
            width: 100%;
            min-height: 44px;
            padding: 11px 40px 11px 12px;
            border: 1px solid #cbd0d8;
            border-radius: 8px;
            background: #fff;
            color: #1f2937;
            font: inherit;
            font-size: 13.5px;
            line-height: 20px;
            text-overflow: ellipsis;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
            transition: border-color 150ms ease, box-shadow 150ms ease;
          }
          .quick-view-select:hover:not(:disabled) { border-color: #8b5cf6; }
          .quick-view-select:focus-visible {
            outline: 2px solid #7c3aed;
            outline-offset: 2px;
            border-color: #7c3aed;
          }
          .quick-view-select:disabled {
            background: #f3f4f6;
            color: #6b7280;
            cursor: wait;
          }
          .quick-view-chevron {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: #6b7280;
            pointer-events: none;
          }
          .quick-view-checkbox {
            display: flex;
            align-items: center;
            gap: 9px;
            min-height: 24px;
            cursor: pointer;
          }
          .quick-view-checkbox input {
            width: 16px;
            height: 16px;
            margin: 0;
            accent-color: #7c3aed;
          }
          .quick-view-checkbox input:focus-visible {
            outline: 2px solid #7c3aed;
            outline-offset: 3px;
          }
          `,
        }}
      />

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
        }}
      >
        <a
          href="/app/settings"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/settings");
          }}
          style={{
            color: "#006e52",
            textDecoration: "none",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <svg
            style={{ width: "16px", height: "16px" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            ></path>
          </svg>
          Back to Settings
        </a>
      </div>

      <s-stack direction="block" gap="base">
        <s-section heading="Product Display Settings">
          <s-paragraph>
            Manage exactly which products are visible to your customers across
            your store&apos;s search and filtering widgets.
          </s-paragraph>

          <div className="int-grid">
            {/* Card 1: Inventory */}
            <div className="int-card">
              <div className="int-header">
                <span className="int-tag int-tag-inventory">INVENTORY</span>
                <label className="int-toggle" aria-label="Toggle setting">
                  <input
                    type="checkbox"
                    aria-label="Show only in-stock products"
                    disabled={fetcher.state !== "idle"}
                    checked={showOnlyInStock}
                    onChange={() =>
                      toggleSetting("showOnlyInStock", showOnlyInStock)
                    }
                  />
                  <span className="int-slider"></span>
                </label>
              </div>
              <div>
                <h3 className="int-title">Show only in-stock products</h3>
                <p className="int-desc">
                  If enabled, out-of-stock products will be completely hidden
                  from the storefront search and filter results.
                </p>
              </div>
            </div>

            {/* Card 2: Hover Image */}
            <div className="int-card">
              <div className="int-header">
                <span
                  className="int-tag int-tag-inventory"
                  style={{ backgroundColor: "#fef3c7", color: "#b45309" }}
                >
                  DISPLAY
                </span>
                <label className="int-toggle" aria-label="Toggle setting">
                  <input
                    type="checkbox"
                    aria-label="Second image on hover"
                    disabled={fetcher.state !== "idle"}
                    checked={secondImageOnHover}
                    onChange={() =>
                      toggleSetting("secondImageOnHover", secondImageOnHover)
                    }
                  />
                  <span className="int-slider"></span>
                </label>
              </div>
              <div>
                <h3 className="int-title">2nd image on hover</h3>
                <p className="int-desc">
                  Display the second product image when a customer hovers over a
                  product card in the search and filter results.
                </p>
              </div>
            </div>

            {/* Card 3: Quick View (Instant Search) */}
            <div className="int-card">
              <div className="int-header">
                <span
                  className="int-tag int-tag-inventory"
                  style={{ backgroundColor: "#dbeafe", color: "#1e40af" }}
                >
                  FEATURES
                </span>
                <label className="int-toggle" aria-label="Toggle setting">
                  <input
                    type="checkbox"
                    aria-label="Quick View in instant search"
                    disabled={fetcher.state !== "idle"}
                    checked={showQuickViewInstantSearch}
                    onChange={() =>
                      toggleSetting(
                        "showQuickViewInstantSearch",
                        showQuickViewInstantSearch,
                      )
                    }
                  />
                  <span className="int-slider"></span>
                </label>
              </div>
              <div>
                <h3 className="int-title">Quick View (Instant Search)</h3>
                <p className="int-desc">
                  Show a &quot;Quick View&quot; button on product cards inside the instant
                  search dropdown.
                </p>
              </div>
              {showQuickViewInstantSearch && renderQuickViewOptions(true)}
            </div>

            {/* Card 4: Quick View (Collection & Search) */}
            <div className="int-card">
              <div className="int-header">
                <span
                  className="int-tag int-tag-inventory"
                  style={{ backgroundColor: "#dbeafe", color: "#1e40af" }}
                >
                  FEATURES
                </span>
                <label className="int-toggle" aria-label="Toggle setting">
                  <input
                    type="checkbox"
                    aria-label="Quick View in collections"
                    disabled={fetcher.state !== "idle"}
                    checked={showQuickViewCollection}
                    onChange={() =>
                      toggleSetting(
                        "showQuickViewCollection",
                        showQuickViewCollection,
                      )
                    }
                  />
                  <span className="int-slider"></span>
                </label>
              </div>
              <div>
                <h3 className="int-title">Quick View (Collection/Search)</h3>
                <p className="int-desc">
                  Show a &quot;Quick View&quot; button on product cards in search and
                  collection pages.
                </p>
              </div>
              {showQuickViewCollection && renderQuickViewOptions(false)}
            </div>
            {/* Card 5: Wholesale Mode */}
            <div className="int-card">
              <div className="int-header">
                <span
                  className="int-tag int-tag-inventory"
                  style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}
                >
                  ACCESS
                </span>
                <label className="int-toggle" aria-label="Toggle setting">
                  <input
                    type="checkbox"
                    aria-label="Wholesale mode"
                    disabled={fetcher.state !== "idle"}
                    checked={isWholesale}
                    onChange={() =>
                      toggleSetting("isWholesale", isWholesale)
                    }
                  />
                  <span className="int-slider"></span>
                </label>
              </div>
              <div>
                <h3 className="int-title">Wholesale Store (B2B)</h3>
                <p className="int-desc">
                  If enabled, customers must log in to view prices and add products to cart. Non-logged-in users will see a &quot;Login To Add to Cart&quot; button.
                </p>
              </div>
            </div>
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("General Settings ErrorBoundary caught:", error);
  
  return (
    <s-page heading="App Settings Error">
      <div style={{ padding: '20px', background: '#ffebee', color: '#c62828', borderRadius: '8px' }}>
        <h2>Something went wrong!</h2>
        <p><b>Message:</b> {error?.message || "Unknown error"}</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', marginTop: '10px' }}>
          {error?.stack}
        </pre>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
