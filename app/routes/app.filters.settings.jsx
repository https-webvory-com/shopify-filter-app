import { useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getFilterGlobalSettings, updateFilterGlobalSettings } from "../services/filterSettings.server";
import { invalidateShop } from "../services/shopCache.server";

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
  // Clear cache so storefront gets fresh settings immediately
  invalidateShop(session.shop);
  return { success: true };
};

// â”€â”€ Toggle Row Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingToggle({ label, description, value, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-text-col">
        <p className="settings-label">{label}</p>
        <p className="settings-desc">{description}</p>
      </div>
      {/* Toggle switch */}
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-slider">
          <span className="toggle-knob" />
        </span>
      </label>
    </div>
  );
}

// â”€â”€ Select Row Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingSelect({ label, description, value, onChange, options }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedLabel = options.find((o) => o.value === value)?.label || value;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="settings-row">
      <div className="settings-text-col">
        <p className="settings-label">{label}</p>
        <p className="settings-desc">{description}</p>
      </div>
      <div style={{ flexShrink: 0, width: "200px", position: "relative" }} ref={dropdownRef}>
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: "100%",
            padding: "11px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(30, 27, 75, 0.12)",
            background: "#ffffff",
            color: "#1E1B4B",
            fontSize: "13.5px",
            fontWeight: "600",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
            transition: "all 0.2s ease",
            boxSizing: "border-box",
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = "#5B21B6"}
          onMouseLeave={(e) => !isOpen && (e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)")}
        >
          {selectedLabel}
          <svg
            viewBox="0 0 20 20"
            style={{
              width: "12px",
              height: "12px",
              fill: "#1e1b4b",
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "0.2s",
            }}
          >
            <path d="M10 13a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 10 13z" />
          </svg>
        </div>

        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: "8px",
              background: "#fff",
              borderRadius: "10px",
              boxShadow: "0 10px 30px rgba(30, 27, 75, 0.08)",
              border: "1px solid rgba(30, 27, 75, 0.08)",
              zIndex: 1000,
              padding: "6px 0",
              boxSizing: "border-box",
            }}
          >
            {options.map((opt) => (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  color: value === opt.value ? "#5B21B6" : "#1e1b4b",
                  background: value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                  e.currentTarget.style.color = "#5B21B6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent";
                  e.currentTarget.style.color = value === opt.value ? "#5B21B6" : "#1e1b4b";
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€ Section Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingsSection({ title, children }) {
  return (
    <div className="settings-card">
      {title && (
        <div className="settings-card-header">
          <svg
            viewBox="0 0 20 20"
            style={{ width: "16px", height: "16px", fill: "#5B21B6" }}
          >
            <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.75-11.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5zm0 4.5a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5z" />
          </svg>
          <h3 className="settings-card-title">{title}</h3>
        </div>
      )}
      <div className="settings-card-body">
        {children}
      </div>
    </div>
  );
}

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    <div className="settings-page">
      <style dangerouslySetInnerHTML={{ __html: `
        .settings-page {
          background: #f8f9fc !important;
          min-height: calc(100vh - 56px) !important;
          display: flex !important;
          flex-direction: column !important;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          box-sizing: border-box !important;
        }
        .settings-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          padding: 20px 32px !important;
          background: #ffffff !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          box-shadow: 0 2px 8px rgba(30, 27, 75, 0.02) !important;
        }
        .btn-settings-back {
          background: none !important;
          border: none !important;
          cursor: pointer !important;
          padding: 8px !important;
          border-radius: 8px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease !important;
        }
        .btn-settings-back:hover {
          background: rgba(30, 27, 75, 0.05) !important;
        }
        .settings-title-text {
          font-size: 15px !important;
          color: #5B21B6 !important;
          font-weight: 700 !important;
          background: rgba(91, 33, 182, 0.06) !important;
          padding: 12px 20px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .settings-container {
          flex: 1 !important;
          padding: 32px !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .settings-card {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: visible !important;
          margin-bottom: 28px !important;
        }
        .settings-card-header {
          padding: 18px 24px !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
        }
        .settings-card-title {
          font-size: 16px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
          margin: 0 !important;
        }
        .settings-card-body {
          padding: 8px 24px !important;
        }
        .settings-row {
          display: flex !important;
          justify-content: space-between !important;
          align-items: flex-start !important;
          padding: 24px 0 !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          gap: 40px !important;
        }
        .settings-row:last-child {
          border-bottom: none !important;
        }
        .settings-text-col {
          flex: 1 !important;
        }
        .settings-label {
          margin: 0 0 6px 0 !important;
          font-size: 14.5px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
        }
        .settings-desc {
          margin: 0 !important;
          font-size: 13.5px !important;
          color: #4b5563 !important;
          line-height: 1.6 !important;
        }

        /* Luxury custom Toggle slider */
        .toggle-switch {
          position: relative !important;
          display: inline-block !important;
          width: 48px !important;
          height: 26px !important;
          flex-shrink: 0 !important;
          cursor: pointer !important;
        }
        .toggle-switch input {
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
        }
        .toggle-slider {
          position: absolute !important;
          inset: 0 !important;
          background-color: rgba(30, 27, 75, 0.12) !important;
          border-radius: 34px !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .toggle-switch input:checked + .toggle-slider {
          background-color: #10B981 !important;
        }
        .toggle-knob {
          position: absolute !important;
          height: 20px !important;
          width: 20px !important;
          left: 3px !important;
          bottom: 3px !important;
          background-color: #fff !important;
          border-radius: 50% !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.1) !important;
        }
        .toggle-switch input:checked + .toggle-slider .toggle-knob {
          left: 25px !important;
        }
      ` }} />

      {/* Premium Header */}
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => navigate("/app/filters")}
            className="btn-settings-back"
            title="Back to Filters"
          >
            <svg
              viewBox="0 0 20 20"
              style={{ width: "20px", height: "20px", fill: "#1E1B4B" }}
            >
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="settings-title-text">
            Filter Settings
          </span>
        </div>
      </div>

      <div className="settings-container">
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
        </SettingsSection>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
