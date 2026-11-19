import {useCompletedSubmission} from '../hooks/useCompletedSubmission';
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import PageWidthSettings from '../components/PageWidthSettings';
import {publishPageLayout} from '../services/pageLayoutPublication.server.js';
import {COLLECTION_SPACING_LIMITS,collectionLayoutSettings,isValidCollectionPageWidth,isValidCollectionSpacing} from '../utils/collectionLayoutSettings.js';
import prisma from "../db.server.js";
import { connectMarketAvailability } from "../services/marketAvailability.server.js";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import {
  getFilterGlobalSettings,
  updateFilterGlobalSettings,
} from "../services/filterSettings.server";

export const loader = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const settings = await getFilterGlobalSettings(session.shop);
    // Repairs older installations without changing their saved settings.
    await publishPageLayout(session.shop,settings,{admin}).catch(()=>console.warn('Initial page spacing publication unavailable'));
    const countryConnection = await prisma.marketStorefrontConnection.findUnique({where:{shop:session.shop},select:{countries:true}});
    return Response.json({ settings, countryConnection });
  } catch (error) {
    console.error("LOADER ERROR:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get('intent') === 'connect-country') {
    try { return {success:true,...await connectMarketAvailability(session.shop,admin)}; }
    catch (error) {
      const safe=/^(Approve the Storefront|Unable to create the Storefront|Unable to verify enabled|The Storefront connection cannot see|Shopify country availability)/.test(error.message);
      return Response.json({error:safe?error.message:'Unable to connect country availability. Please retry.'},{status:400});
    }
  }

  const payload = {};
  if(formData.has('collectionPageWidth')){
    const value=formData.get('collectionPageWidth');
    if(!isValidCollectionPageWidth(value))return Response.json({success:false,error:'Choose theme width or custom side spacing.'},{status:400});
    payload.collectionPageWidth=value;
  }
  for(const [key,limits] of Object.entries(COLLECTION_SPACING_LIMITS))if(formData.has(key)){
    const value=formData.get(key);
    if(!isValidCollectionSpacing(key,value))return Response.json({success:false,error:`Enter whole-number spacing from ${limits.min} to ${limits.max} px.`},{status:400});
    payload[key]=Number(value);
  }
  for (const key of ['showOnlyInStock','secondImageOnHover','showQuickViewInstantSearch','showQuickViewCollection','showQuickViewCollectionMobile','showQuickViewInstantSearchMobile','showQuickViewSizeChart','showQuickViewInstantSearchSizeChart','isWholesale']) {
    if (!formData.has(key)) continue;
    const value = formData.get(key);
    if (value !== 'true' && value !== 'false') return Response.json({ success:false, error:'Invalid display setting.' },{status:400});
    payload[key] = value === 'true';
  }
  for (const key of ['quickViewStyle','quickViewInstantSearchStyle']) if (formData.has(key)) payload[key] = formData.get(key) === 'theme' ? 'theme' : 'app';
  if (!Object.keys(payload).length) return Response.json({success:false,error:'No display settings supplied.'},{status:400});

  const saved=await updateFilterGlobalSettings(session.shop, payload);
  if(['collectionPageWidth',...Object.keys(COLLECTION_SPACING_LIMITS)].some(key=>key in payload)){
    try { await publishPageLayout(session.shop,saved,{admin,force:true}); }
    catch { return Response.json({success:false,error:'Page spacing was saved but could not be applied to new page loads. Save again to retry.'},{status:502}); }
  }
  return Response.json({ success: true });
};

export default function Settings() {
  const navigate = useNavigate();
  const { settings, countryConnection } = useLoaderData();
  const fetcher = useFetcher();
  const countryFetcher = useFetcher();
  const countryProgress = useFetcher();
  const appBridge = useAppBridge();
  const [countryBusy,setCountryBusy] = useState(false);
  const [countryError,setCountryError] = useState('');
  const connectingCountry = countryBusy || countryFetcher.state !== 'idle';
  useEffect(()=>{
    if(countryConnection)countryProgress.load('/app/api/country-availability');
  },[countryConnection]);
  useEffect(()=>{
    if(!countryConnection)return;
    const timer=setInterval(()=>{
      if(document.visibilityState==='visible'&&countryProgress.state==='idle')countryProgress.load('/app/api/country-availability');
    },10000);
    return ()=>clearInterval(timer);
  },[countryConnection,countryProgress.state]);
  const connectCountry = async () => {
    if (connectingCountry) return;
    setCountryBusy(true);setCountryError('');
    try {
      const result = await appBridge.scopes.request(['unauthenticated_read_product_listings']);
      if(result.result!=='granted-all'||!result.detail?.granted?.includes('unauthenticated_read_product_listings')) throw Error('Approve read-only product listings access to enable country stock.');
      countryFetcher.submit({intent:'connect-country'},{method:'POST'});
    } catch(error) { setCountryError(error.message); }
    finally { setCountryBusy(false); }
  };

  const showOnlyInStock = fetcher.formData?.has("showOnlyInStock")
    ? fetcher.formData.get("showOnlyInStock") === "true"
    : (settings?.showOnlyInStock ?? false);
  const secondImageOnHover = fetcher.formData?.has("secondImageOnHover")
    ? fetcher.formData.get("secondImageOnHover") === "true"
    : (settings?.secondImageOnHover ?? true);
  const showQuickViewInstantSearch = fetcher.formData?.has("showQuickViewInstantSearch")
    ? fetcher.formData.get("showQuickViewInstantSearch") === "true"
    : (settings?.showQuickViewInstantSearch ?? true);
  const showQuickViewCollection = fetcher.formData?.has("showQuickViewCollection")
    ? fetcher.formData.get("showQuickViewCollection") === "true"
    : (settings?.showQuickViewCollection ?? true);
  const isWholesale = fetcher.formData?.has("isWholesale")
    ? fetcher.formData.get("isWholesale") === "true"
    : (settings?.isWholesale ?? false);
  const showQuickViewSizeChart = fetcher.formData?.has("showQuickViewSizeChart")
    ? fetcher.formData.get("showQuickViewSizeChart") === "true"
    : (settings?.showQuickViewSizeChart ?? false);
  const quickViewStyle = (fetcher.formData?.get("quickViewStyle") ?? settings?.quickViewStyle) === "theme" ? "theme" : "app";
  const quickViewInstantSearchStyle = (
    fetcher.formData?.get("quickViewInstantSearchStyle") ??
    settings?.quickViewInstantSearchStyle ?? settings?.quickViewStyle
  ) === "theme" ? "theme" : "app";
  const showQuickViewInstantSearchSizeChart = fetcher.formData?.has("showQuickViewInstantSearchSizeChart")
    ? fetcher.formData.get("showQuickViewInstantSearchSizeChart") === "true"
    : (settings?.showQuickViewInstantSearchSizeChart ?? settings?.showQuickViewSizeChart ?? false);

  const toggleSetting = (key, currentValue) => {
    if (fetcher.state !== "idle") return;
    fetcher.submit({ [key]: key === 'quickViewStyle' || key === 'quickViewInstantSearchStyle' ? currentValue : String(!currentValue) }, { method:'POST' });
  };

  useCompletedSubmission(fetcher.data, fetcher.state, () => {
    if (fetcher.data?.success) {
      shopify.toast.show("Display settings updated");
    }
  });

  const renderQuickViewOptions = (instantSearch) => {
    const id = instantSearch ? "instant-quick-view" : "collection-quick-view";
    const style = instantSearch ? quickViewInstantSearchStyle : quickViewStyle;
    const sizeChart = instantSearch ? showQuickViewInstantSearchSizeChart : showQuickViewSizeChart;
    const desktopKey = instantSearch ? 'showQuickViewInstantSearch' : 'showQuickViewCollection';
    const showOnDesktop = instantSearch ? showQuickViewInstantSearch : showQuickViewCollection;
    const mobileKey = instantSearch ? 'showQuickViewInstantSearchMobile' : 'showQuickViewCollectionMobile';
    const showOnMobile = fetcher.formData?.has(mobileKey)
      ? fetcher.formData.get(mobileKey) === 'true'
      : (settings?.integrations?.[mobileKey] ?? settings?.[desktopKey]) !== false;
    return (
      <div className="quick-view-options">
        <div className="quick-view-field">
          <label className="quick-view-checkbox" htmlFor={`${id}-desktop`}>
            <input id={`${id}-desktop`} type="checkbox" checked={showOnDesktop}
              disabled={fetcher.state !== "idle"}
              onChange={() => {
                if (fetcher.state === 'idle') fetcher.submit({[desktopKey]: String(!showOnDesktop), [mobileKey]: String(showOnMobile)}, {method:'POST'});
              }} />
            Show on desktop
          </label>
        </div>
        <div className="quick-view-field">
          <label className="quick-view-checkbox" htmlFor={`${id}-mobile`}>
            <input id={`${id}-mobile`} type="checkbox" checked={showOnMobile}
              disabled={fetcher.state !== "idle"} aria-describedby={`${id}-mobile-help`}
              onChange={() => toggleSetting(mobileKey, showOnMobile)} />
            Show on small screens
          </label>
          <p className="int-desc" id={`${id}-mobile-help`}>Show Quick View on screens 768 px wide or smaller, independently of desktop.</p>
        </div>
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
      {fetcher.data?.error && <p role="alert" style={{color:'#b42318'}}>{fetcher.data.error}</p>}
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
          .country-progress-list {display:grid;gap:10px;max-height:300px;overflow:auto;margin:0;padding:0;list-style:none}
          .country-progress-row {display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #ede9fe;font-size:13px}
          .country-progress-row span {color:#6b7280}
          .country-progress-row small {display:block;flex-basis:100%;color:#6d28d9}
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
        <s-section heading="Page layout">
          <PageWidthSettings value={collectionLayoutSettings(settings)} disabled={fetcher.state!=='idle'} retry={!!fetcher.data?.error} onApply={values=>{
            if(fetcher.state!=='idle')return;
            fetcher.submit(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,String(value)])),{method:'POST'});
          }}/>
        </s-section>
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
              </div>
              <div>
                <h3 className="int-title">Quick View (Instant Search)</h3>
                <p className="int-desc">
                  Show a &quot;Quick View&quot; button on product cards inside the instant
                  search dropdown.
                </p>
              </div>
              {renderQuickViewOptions(true)}
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
              </div>
              <div>
                <h3 className="int-title">Quick View (Collection/Search)</h3>
                <p className="int-desc">
                  Show a &quot;Quick View&quot; button on product cards in search and
                  collection pages.
                </p>
              </div>
              {renderQuickViewOptions(false)}
            </div>
            {/* Card 5: Country availability */}
            <div className="int-card">
              <div className="int-header">
                <span className="int-tag int-tag-inventory">MARKETS</span>
                <span className="int-tag" style={{background:countryConnection?'#dcfce7':'#f3f4f6',color:countryConnection?'#166534':'#6b7280'}}>{countryConnection?'Connected':'Not connected'}</span>
              </div>
              <div>
                <h3 className="int-title">Country availability</h3>
                <p className="int-desc">Hide products unavailable in the shopper’s Shopify country, even when “Show only in-stock products” is off.</p>
              </div>
              <button className="quick-view-select" type="button" style={{width:'auto',alignSelf:'flex-start',padding:'10px 16px',color:'#6d28d9',fontWeight:600}} disabled={connectingCountry} aria-busy={connectingCountry} onClick={connectCountry}>{connectingCountry?'Connecting…':countryConnection?'Refresh connection and countries':'Connect country availability'}</button>
              <p className="int-desc">{countryConnection?`Connected for ${countryConnection.countries.length} countries: ${countryConnection.countries.join(', ')}.`:'Approve read-only product listings access in Shopify. No API key needed.'} Stock and collection pages refresh in the background; completed updates appear on reload or the next action.</p>
              {countryConnection&&<div className="quick-view-options">
                <h4 className="int-title">Country preparation</h4>
                {countryProgress.data?.error?<p className="int-desc" role="status">{countryProgress.data.error}</p>:!countryProgress.data?<p className="int-desc" role="status">Loading preparation status…</p>:<ul className="country-progress-list" aria-label="Country preparation status">
                  {countryProgress.data.countries?.map(row=><li className="country-progress-row" key={row.country}>
                    <strong>{new Intl.DisplayNames(['en'],{type:'region'}).of(row.country)} ({row.country})</strong>
                    <span>{row.stockStatus==='checked'?'Stock checked':row.stockStatus==='checking'?'Checking stock…':'Stock check pending'}</span>
                    {row.preparingCollections.map(collection=><small key={collection.id}>Preparing: {collection.title}</small>)}
                  </li>)}
                </ul>}
                <p className="int-desc">Updates every 10 seconds while this page is visible. “Stock checked” confirms country availability only. Collection names appear while the worker prepares them; other collections may still be waiting.</p>
              </div>}
              {(countryError||countryFetcher.data?.error)&&<p className="int-desc" style={{color:'#b42318'}} role="alert">{countryError||countryFetcher.data.error}</p>}
              {!countryError&&!countryFetcher.data?.error&&countryFetcher.data?.success&&<p className="int-desc" style={{color:'#166534'}} role="status">Connected. Preparing availability for {countryFetcher.data.countries} countries.</p>}
            </div>
            {/* Card 6: Wholesale Mode */}
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
