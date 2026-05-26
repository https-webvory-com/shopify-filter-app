import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { GET_THEME, GET_THEME_SETTINGS } from "../graphql/queries";
import { useLoaderData, useNavigate } from "react-router";

const hasDisabledFalse = (value) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return /"disabled"\s*:\s*false/.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasDisabledFalse);
  }

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "disabled")) {
      return value.disabled === false;
    }
    return Object.values(value).some(hasDisabledFalse);
  }

  return false;
};

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
      const rawHasDisabledFalse = /"disabled"\s*:\s*false/.test(assetContent);
      let canPreview = rawHasDisabledFalse;
      try {
        const parsed = JSON.parse(assetContent);
        canPreview = hasDisabledFalse(parsed) || rawHasDisabledFalse;
      } catch (error) {
        canPreview = rawHasDisabledFalse;
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
  console.log("Fetched themes:", themes);
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
        {/* Banner Informational block */}
        <s-box padding="base" background="info" borderRadius="base">
          <s-stack direction="inline" gap="base" blockAlign="center">
            <div style={{ flex: 1 }}>
              <s-text variant="headingMd" fontWeight="bold">
                About Theme Setup
              </s-text>
              <s-paragraph>
                The Automatic Installation inserts some needed files to your
                theme to show the Filter + Search widget. The Javascript and CSS
                files are lightweight and optimized to make your page load as
                fast as possible.
              </s-paragraph>
              <s-paragraph>
                In case you want to undo the changes made by the Automatic
                Installation, click on "Revert" next to the theme.
              </s-paragraph>
            </div>
          </s-stack>
        </s-box>

        {/* 2-column core settings */}
        <s-layout>
          <s-layout-section>
            <s-card heading="Enable App Embed">
              <s-paragraph>
                Turn on the app embed in your Shopify Theme Editor to activate
                the app's core snippet on your theme.
              </s-paragraph>
              <s-paragraph>
                Or you can contact our support team to help you add the search
                and filter widget to your theme for free.
              </s-paragraph>
              <div style={{ marginTop: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: "600",
                    marginBottom: "8px",
                    fontSize: "14px",
                  }}
                >
                  Select theme
                </label>
                <select
                  value={selectedTheme}
                  onChange={(e) => setSelectedTheme(String(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                  }}
                >
                  {allThemes.map((theme) => (
                    <option key={theme.id} value={String(theme.themeId)}>
                      {theme.name} ({theme.status})
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
                <s-button
                  onClick={() => openCustomization()}
                  target="_blank"
                  rel="noreferrer"
                  variant="primary"
                >
                  Go to theme editor
                </s-button>
              </div>
            </s-card>
          </s-layout-section>
        </s-layout>

        {/* Installed Themes list table */}
        <s-section heading="List of themes set up with Collection Filter Pro Widget">
          <div
            style={{
              border: "1px solid #e1e3e5",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                background: "#fff",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f6f6f7",
                    borderBottom: "1px solid #e1e3e5",
                  }}
                >
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "13px",
                    }}
                  >
                    Theme Name
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "13px",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "13px",
                    }}
                  >
                    Setup Date
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "13px",
                      textAlign: "right",
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {themeState
                  .filter((theme) => theme.canPreview)
                  .map((theme) => (
                    <tr key={theme.id}>
                      <td>{theme.name}</td>

                      <td>
                        <span
                          style={{
                            color:
                              theme.status === "Installed"
                                ? "green"
                                : "crimson",
                          }}
                        >
                          {theme.status}
                        </span>
                      </td>

                      <td>{theme.date || "-"}</td>

                      <td style={{ textAlign: "right" }}>
                        {theme.status === "Installed" ? (
                          <>
                            {theme.canPreview && (
                              <button
                                style={{ marginRight: 10 }}
                                onClick={() => openCustomization(theme.themeId)}
                              >
                                Preview
                              </button>
                            )}
                            <button
                              onClick={() => openCustomization(theme.themeId)}
                            >
                              Revert
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleInstall(theme.themeId)}>
                            Install
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
