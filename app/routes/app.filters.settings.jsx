import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNavigate, useLoaderData, useSubmit, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getFilterGlobalSettings, updateFilterGlobalSettings } from "../services/filterSettings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getFilterGlobalSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const payload = {
    horizontalFilters: formData.get("horizontalFilters") === "true",
    mobileFilterLayout: formData.get("mobileFilterLayout") || "off-canvas",
    showAttributeBasedBreadcrumb: formData.get("showAttributeBasedBreadcrumb") === "true",
    showFilterOptionsWithOneItem: formData.get("showFilterOptionsWithOneItem") === "true",
    showProductCount: formData.get("showProductCount") === "true",
    scrollUpOnFilterValuesChange: formData.get("scrollUpOnFilterValuesChange") === "true",
    hideUnavailableVariantsWhenSelected: formData.get("hideUnavailableVariantsWhenSelected") === "true",
    desktopLikeOnMobile: formData.get("desktopLikeOnMobile") === "true",
    darkMode: formData.get("darkMode") === "true",
  };

  await updateFilterGlobalSettings(session.shop, payload);
  return { success: true };
};

// ── Toggle Row Component ──────────────────────────────────────────────
function SettingToggle({ label, description, value, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "20px 0",
        borderBottom: "1px solid #e1e3e5",
        gap: "40px",
      }}
    >
      <div style={{ flex: 1 }}>
        <p
          style={{
            margin: "0 0 4px",
            fontSize: "14px",
            fontWeight: "600",
            color: "#202223",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            color: "#6d7175",
            lineHeight: "1.5",
          }}
        >
          {description}
        </p>
      </div>
      {/* Toggle switch */}
      <label
        style={{
          position: "relative",
          display: "inline-block",
          width: "44px",
          height: "24px",
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: value ? "#008060" : "#8c9196",
            borderRadius: "34px",
            transition: "background-color 0.2s",
          }}
        >
          <span
            style={{
              position: "absolute",
              height: "18px",
              width: "18px",
              left: value ? "23px" : "3px",
              bottom: "3px",
              backgroundColor: "#fff",
              borderRadius: "50%",
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
          />
        </span>
      </label>
    </div>
  );
}

// ── Select Row Component ──────────────────────────────────────────────
function SettingSelect({ label, description, value, onChange, options }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "20px 0",
        borderBottom: "1px solid #e1e3e5",
        gap: "40px",
      }}
    >
      <div style={{ flex: 1 }}>
        <p
          style={{
            margin: "0 0 4px",
            fontSize: "14px",
            fontWeight: "600",
            color: "#202223",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            color: "#6d7175",
            lineHeight: "1.5",
          }}
        >
          {description}
        </p>
      </div>
      <div style={{ flexShrink: 0, width: "200px" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 32px 8px 12px",
            borderRadius: "8px",
            border: "1px solid #c9cccf",
            fontSize: "14px",
            color: "#202223",
            background: "#fff",
            cursor: "pointer",
            appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236d7175' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Section Component ─────────────────────────────────────────────────
function SettingsSection({ title, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        padding: "0 24px",
        marginBottom: "20px",
      }}
    >
      {title && (
        <div
          style={{
            padding: "16px 0",
            borderBottom: "1px solid #e1e3e5",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "15px",
              fontWeight: "700",
              color: "#202223",
            }}
          >
            {title}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
export default function FilterSettings() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();

  const [horizontalFilters, setHorizontalFilters] = useState(settings?.horizontalFilters || false);
  const [mobileLayout, setMobileLayout] = useState(settings?.mobileFilterLayout || "off-canvas");

  const [showBreadcrumb, setShowBreadcrumb] = useState(settings?.showAttributeBasedBreadcrumb ?? true);
  const [showSingleItem, setShowSingleItem] = useState(settings?.showFilterOptionsWithOneItem || false);
  const [showProductCount, setShowProductCount] = useState(settings?.showProductCount ?? true);
  const [scrollOnChange, setScrollOnChange] = useState(settings?.scrollUpOnFilterValuesChange || false);

  const [hideUnavailableVariants, setHideUnavailableVariants] = useState(settings?.hideUnavailableVariantsWhenSelected || false);
  const [desktopLikeOnMobile, setDesktopLikeOnMobile] = useState(settings?.desktopLikeOnMobile || false);
  const [darkMode, setDarkMode] = useState(settings?.darkMode || false);

  const isSaving = nav.state === "submitting";

  const handleSettingChange = (key, value) => {
    if (key === "horizontalFilters") setHorizontalFilters(value);
    else if (key === "mobileFilterLayout") setMobileLayout(value);
    else if (key === "showAttributeBasedBreadcrumb") setShowBreadcrumb(value);
    else if (key === "showFilterOptionsWithOneItem") setShowSingleItem(value);
    else if (key === "showProductCount") setShowProductCount(value);
    else if (key === "scrollUpOnFilterValuesChange") setScrollOnChange(value);
    else if (key === "hideUnavailableVariantsWhenSelected") setHideUnavailableVariants(value);
    else if (key === "desktopLikeOnMobile") setDesktopLikeOnMobile(value);
    else if (key === "darkMode") setDarkMode(value);

    const formData = new FormData();
    formData.append("horizontalFilters", (key === "horizontalFilters" ? value : horizontalFilters).toString());
    formData.append("mobileFilterLayout", key === "mobileFilterLayout" ? value : mobileLayout);
    formData.append("showAttributeBasedBreadcrumb", (key === "showAttributeBasedBreadcrumb" ? value : showBreadcrumb).toString());
    formData.append("showFilterOptionsWithOneItem", (key === "showFilterOptionsWithOneItem" ? value : showSingleItem).toString());
    formData.append("showProductCount", (key === "showProductCount" ? value : showProductCount).toString());
    formData.append("scrollUpOnFilterValuesChange", (key === "scrollUpOnFilterValuesChange" ? value : scrollOnChange).toString());
    formData.append("hideUnavailableVariantsWhenSelected", (key === "hideUnavailableVariantsWhenSelected" ? value : hideUnavailableVariants).toString());
    formData.append("desktopLikeOnMobile", (key === "desktopLikeOnMobile" ? value : desktopLikeOnMobile).toString());
    formData.append("darkMode", (key === "darkMode" ? value : darkMode).toString());

    submit(formData, { method: "post" });
    shopify.toast.show("Filter settings saved");
  };

  return (
    <s-page heading="Filter Settings">
      <ui-title-bar title="Filter Settings">
        <button variant="breadcrumb" onClick={() => navigate("/app/filters")}>
          Filters
        </button>
      </ui-title-bar>

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
          href="/app/filters"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/filters");
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
          Back to Filters
        </a>
      </div>

      <SettingsSection title="Filters Settings">
        <SettingToggle
          label="Horizontal filters"
          description="Indicates whether to show the filters on the top or left side."
          value={horizontalFilters}
          onChange={(val) => handleSettingChange("horizontalFilters", val)}
        />
        <SettingSelect
          label="Mobile filter layout"
          description="Choose the display layout for filters on mobile."
          value={mobileLayout}
          onChange={(val) => handleSettingChange("mobileFilterLayout", val)}
          options={[
            { value: "off-canvas", label: "Off-canvas" },
            { value: "horizontal-scrolling", label: "Horizontal scrolling" },
          ]}
        />
        <SettingToggle
          label="Show attribute based breadcrumb"
          description="When enabled, the attribute based breadcrumb showing the active filters is displayed."
          value={showBreadcrumb}
          onChange={(val) => handleSettingChange("showAttributeBasedBreadcrumb", val)}
        />
        <SettingToggle
          label="Show filter options even if they have only one item"
          description="When enabled, a filter with only one filter value and its product count equals to the number of showing products are still shown. By default this option is turned off because the collection page is the same with or without the filter value selected."
          value={showSingleItem}
          onChange={(val) => handleSettingChange("showFilterOptionsWithOneItem", val)}
        />
        <SettingToggle
          label="Show product count"
          description="When enabled, the number of products are shown on the right on filter options."
          value={showProductCount}
          onChange={(val) => handleSettingChange("showProductCount", val)}
        />
        <SettingToggle
          label="Scroll up on filter values change"
          description="When enabled, the widget scrolls up the browser view to the top when a user clicks on a filter option. This is for the vertical filter view only."
          value={scrollOnChange}
          onChange={(val) => handleSettingChange("scrollUpOnFilterValuesChange", val)}
        />
        <SettingToggle
          label="Hide unavailable variants if a filter value is selected"
          description="When enabled, the app hides unavailable variants if a filter value is selected."
          value={hideUnavailableVariants}
          onChange={(val) => handleSettingChange("hideUnavailableVariantsWhenSelected", val)}
        />
        <SettingToggle
          label="Desktop-like filters on mobile"
          description="When enabled, the desktop filter style is used on mobile."
          value={desktopLikeOnMobile}
          onChange={(val) => handleSettingChange("desktopLikeOnMobile", val)}
        />
        <SettingToggle
          label="Dark mode"
          description="When enabled, storefront UI uses the dark color scheme."
          value={darkMode}
          onChange={(val) => handleSettingChange("darkMode", val)}
        />
        <div style={{ padding: "20px 0" }} />
      </SettingsSection>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
