import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { GET_THEME, GET_THEME_SETTINGS } from "../graphql/queries";
import { useLoaderData, useNavigate } from "react-router";



export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(GET_THEME);
  const themeJson = await response.json();
  const themeEdges = themeJson?.data?.themes?.edges || [];

  const themes = await Promise.all(
    themeEdges.map(async ({ node }) => {
      const settingsResponse = await admin.graphql(GET_THEME_SETTINGS, {
        variables: { themeId: node.id },
      });
      const settingsJson = await settingsResponse.json();
      const assetContent =
        settingsJson?.data?.theme?.files?.nodes?.[0]?.body?.content || "";
      let canPreview = false;
      const EXT_UID = "65b30aae-2fc0-9b48-3e28-e6bf3e801b92f9c75ad7";

      const findAppEmbeds = (obj) => {
        if (!obj || typeof obj !== "object") return false;
        
        if (obj.type && typeof obj.type === "string" && obj.type.includes("shopify://apps/")) {
          console.log("FOUND APP EMBED:", obj.type, "DISABLED:", obj.disabled);
          
          const isOurBlock = obj.type.includes("collection_filter_pro") || 
                             obj.type.includes("collection-filter-pro") || 
                             obj.type.includes("instant_search") ||
                             obj.type.includes("instant-search") ||
                             obj.type.includes("al-smart-search-filter") ||
                             obj.type.includes(EXT_UID);
                             
          if (isOurBlock) {
             if (obj.disabled === false || obj.disabled === undefined) {
               return true;
             }
          }
        }
        
        for (const key of Object.keys(obj)) {
          if (findAppEmbeds(obj[key])) {
            return true;
          }
        }
        
        return false;
      };

      try {
        if (assetContent) {
          const cleanJson = assetContent.replace(/\/\*[\s\S]*?\*\//g, '').trim();
          const parsed = JSON.parse(cleanJson);
          canPreview = findAppEmbeds(parsed);
        }
      } catch (error) {
        console.error("Error parsing settings_data.json", error);
      }

      const themeId = node.id
        ? typeof node.id === "string"
          ? node.id.split("/").pop()
          : String(node.id)
        : null;
      return {
        id: node.id,
        themeId: themeId != null ? String(themeId) : null,
        name: node.name,
        role: node.role,
        updatedAt: node.updatedAt,
        canPreview,
        rawAssetContent: assetContent,
      };
    }),
  );

  return {
    themes,
    shop: session.shop,
  };
};
export default function ThemeSetup() {
  const { themes, shop } = useLoaderData();
  const navigate = useNavigate();
  // console.log("Fetched themes from loader (Check rawAssetContent inside):", themes);
  
  // Normalize Shopify data → UI format
  const mappedThemes = themes.map((theme) => ({
    id: theme.id,
    themeId: theme.themeId != null ? String(theme.themeId) : null,
    name: theme.name,
    role: theme.role,
    date: theme.updatedAt?.split("T")[0],
    status: theme.canPreview ? "Installed" : "Not Installed",
    canPreview: theme.canPreview,
  }));

  const allThemes = mappedThemes;

  const [themeState, setThemeState] = useState(allThemes);
  const [selectedTheme, setSelectedTheme] = useState(
    allThemes[0]?.themeId != null ? String(allThemes[0].themeId) : "",
  );

  const openCustomization = (themeId = selectedTheme) => {
    if (
      typeof themeId === "object" &&
      themeId !== null &&
      themeId.nativeEvent
    ) {
      themeId = selectedTheme;
    }

    console.log("Received theme ID for customization:", selectedTheme);
    console.log("Attempting to open theme editor for theme ID:", themeId);
    const cleanedThemeId = themeId != null ? String(themeId).trim() : "";
    if (!cleanedThemeId) return;

    console.log("Opening theme editor for theme ID:", cleanedThemeId);
    const shopDomain = shop?.includes(".myshopify.com")
      ? shop
      : `${shop}.myshopify.com`;
    const customizationUrl = `https://${shopDomain}/admin/themes/${cleanedThemeId}/editor?context=apps`;
    window.open(customizationUrl, "_blank");
  };

  const handleInstall = (themeId) => {
    setThemeState((prev) =>
      prev.map((t) =>
        t.themeId === themeId
          ? {
              ...t,
              status: "Installed",
              date: new Date().toISOString().split("T")[0],
            }
          : t,
      ),
    );
  };

  const handleRevert = (themeId) => {
    setThemeState((prev) =>
      prev.map((t) =>
        t.themeId === themeId
          ? { ...t, status: "Not Installed", date: "-" }
          : t,
      ),
    );
  };

  return (
    <s-page heading="Theme Setup">
      <ui-title-bar title="Theme Setup">
        <button variant="breadcrumb" onClick={() => navigate("/app/settings")}>
          Settings
        </button>
      </ui-title-bar>

      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "20px 0 60px 0", fontFamily: '"Inter", sans-serif' }}>
        
        {/* Back Link */}
        <a
          href="/app/settings"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/settings");
          }}
          style={{
            color: "#5B21B6",
            textDecoration: "none",
            fontWeight: "600",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "24px",
            fontSize: "14px",
            padding: "8px 16px",
            background: "rgba(91, 33, 182, 0.08)",
            borderRadius: "20px",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(91, 33, 182, 0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(91, 33, 182, 0.08)";
          }}
        >
          <svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
          </svg>
          Back to Settings
        </a>

        {/* Banner Informational block */}
        <div style={{
          background: "linear-gradient(135deg, rgba(91, 33, 182, 0.05) 0%, rgba(124, 58, 237, 0.02) 100%)",
          border: "1px solid rgba(91, 33, 182, 0.1)",
          borderRadius: "16px",
          padding: "24px",
          marginBottom: "32px",
          display: "flex",
          gap: "20px",
          alignItems: "flex-start"
        }}>
          <div style={{
            background: "#5B21B6",
            color: "white",
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}>
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E1B4B", margin: "0 0 8px 0" }}>About Theme Setup</h2>
            <p style={{ color: "#64748b", margin: "0 0 8px 0", fontSize: "14px", lineHeight: "1.6" }}>
              The Automatic Installation inserts some needed files to your theme to show the Filter + Search widget. The Javascript and CSS files are lightweight and optimized to make your page load as fast as possible.
            </p>
            <p style={{ color: "#64748b", margin: 0, fontSize: "14px", lineHeight: "1.6" }}>
              In case you want to undo the changes made by the Automatic Installation, click on "Revert" next to the theme.
            </p>
          </div>
        </div>

        {/* Enable App Embed Card */}
        <div style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
          border: "1px solid #f1f5f9",
          padding: "32px",
          marginBottom: "32px"
        }}>
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1E1B4B", margin: "0 0 12px 0" }}>Enable App Embed</h2>
          <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 8px 0" }}>
            Turn on the app embed in your Shopify Theme Editor to activate the app's core snippet on your theme.
          </p>
          <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 24px 0" }}>
            Or you can contact our support team to help you add the search and filter widget to your theme for free.
          </p>

          <div style={{ marginBottom: "24px", maxWidth: "400px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#1E1B4B", marginBottom: "8px" }}>
              Select theme
            </label>
            <select
              value={selectedTheme}
              onChange={(e) => setSelectedTheme(String(e.target.value))}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                fontSize: "14px",
                color: "#1E1B4B",
                outline: "none",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
              onFocus={(e) => e.target.style.borderColor = "#5B21B6"}
              onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
            >
              {allThemes.map((theme) => (
                <option key={theme.id} value={String(theme.themeId)}>
                  {theme.name} ({theme.status})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => openCustomization()}
            style={{
              background: "#5B21B6",
              color: "#ffffff",
              border: "none",
              padding: "12px 24px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(91, 33, 182, 0.2)",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#4c1d95"}
            onMouseLeave={(e) => e.currentTarget.style.background = "#5B21B6"}
          >
            Go to theme editor
          </button>
        </div>

        {/* Installed Themes list table */}
        <div style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
          border: "1px solid #f1f5f9",
          overflow: "hidden"
        }}>
          <div style={{ padding: "24px 32px", borderBottom: "1px solid #f1f5f9" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E1B4B", margin: 0 }}>
              List of themes set up with Collection Filter Pro Widget
            </h2>
          </div>
          
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                  <th style={{ padding: "16px 32px", fontWeight: "600", borderBottom: "1px solid #e2e8f0" }}>Theme Name</th>
                  <th style={{ padding: "16px 32px", fontWeight: "600", borderBottom: "1px solid #e2e8f0" }}>Status</th>
                  <th style={{ padding: "16px 32px", fontWeight: "600", borderBottom: "1px solid #e2e8f0" }}>Setup Date</th>
                  <th style={{ padding: "16px 32px", fontWeight: "600", borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {themeState
                  .filter((theme) => theme.canPreview)
                  .map((theme) => (
                    <tr 
                      key={theme.id} 
                      style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.2s ease" }} 
                      onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"} 
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "16px 32px", color: "#1E1B4B", fontWeight: "500" }}>{theme.name}</td>
                      <td style={{ padding: "16px 32px" }}>
                        <span style={{
                          background: theme.status === "Installed" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                          color: theme.status === "Installed" ? "#059669" : "#dc2626",
                          padding: "6px 12px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          fontWeight: "600"
                        }}>
                          {theme.status}
                        </span>
                      </td>
                      <td style={{ padding: "16px 32px", color: "#64748b" }}>{theme.date || "-"}</td>
                      <td style={{ padding: "16px 32px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          {theme.status === "Installed" ? (
                            <>
                              {theme.canPreview && (
                                <button
                                  onClick={() => openCustomization(theme.themeId)}
                                  style={{
                                    background: "#ffffff",
                                    border: "1px solid #e2e8f0",
                                    color: "#5B21B6",
                                    padding: "6px 16px",
                                    borderRadius: "8px",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease"
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f3e8ff"; e.currentTarget.style.borderColor = "#d8b4fe"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
                                >
                                  Preview
                                </button>
                              )}
                              <button
                                onClick={() => openCustomization(theme.themeId)}
                                style={{
                                  background: "#ffffff",
                                  border: "1px solid #e2e8f0",
                                  color: "#dc2626",
                                  padding: "6px 16px",
                                  borderRadius: "8px",
                                  fontSize: "13px",
                                  fontWeight: "600",
                                  cursor: "pointer",
                                  transition: "all 0.2s ease"
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.borderColor = "#fca5a5"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
                              >
                                Revert
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleInstall(theme.themeId)}
                              style={{
                                background: "#5B21B6",
                                border: "none",
                                color: "#ffffff",
                                padding: "6px 16px",
                                borderRadius: "8px",
                                fontSize: "13px",
                                fontWeight: "600",
                                cursor: "pointer",
                                transition: "all 0.2s ease"
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = "#4c1d95"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "#5B21B6"}
                            >
                              Install
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
