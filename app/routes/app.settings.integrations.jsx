import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { useState, useEffect } from "react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.filterGlobalSetting.findUnique({
    where: { shop: session.shop },
    select: { integrations: true }
  });
  
  const integrationsSettings = settings?.integrations || {};

  return { integrationsSettings };
};

import { invalidateShop } from "../services/shopCache.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const data = Object.fromEntries(formData);
  
  let integrations = {};
  if (data.integrations) {
    try {
      integrations = JSON.parse(data.integrations);
    } catch(e) {}
  }

  await prisma.filterGlobalSetting.upsert({
    where: { shop: session.shop },
    update: { integrations },
    create: { shop: session.shop, integrations }
  });
  
  invalidateShop(session.shop);
  
  return { success: true };
};

export default function Integrations() {
  const { integrationsSettings } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      shopify.toast.show("Integration settings updated");
    }
  }, [fetcher.state, fetcher.data]);

  const [integrations, setIntegrations] = useState([
    {
      id: "wishlist",
      name: "Wishlist Growth",
      category: "Wishlist",
      desc: "Allow customers to save their favorite products directly from the search and filter results.",
      enabled: integrationsSettings.wishlist || false,
      url: "https://apps.shopify.com/wishlist-growth-new"
    }
  ]);

  const handleToggle = (id) => {
    const updated = integrations.map((item) =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    );
    setIntegrations(updated);

    const integrationMap = {};
    updated.forEach(item => {
      integrationMap[item.id] = item.enabled;
    });

    fetcher.submit(
      { integrations: JSON.stringify(integrationMap) },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Integrations">
      <ui-title-bar title="Integrations">
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

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .int-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
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
          .int-tag-reviews {
            color: #4338ca;
            background: #e0e7ff;
          }
          .int-tag-currency {
            color: #b45309;
            background: #fef3c7;
          }
          .int-tag-translation {
            color: #047857;
            background: #d1fae5;
          }
          .int-tag-wishlist {
            color: #be185d;
            background: #fce7f3;
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
          `
        }}
      />

      <s-stack direction="block" gap="base">
        <s-section heading="Connect Third-Party Apps">
          <s-paragraph>
            Integrate AI Search & Filter with your favorite Shopify apps to
            add rating stars, currency conversion, and translation options to
            your search and filtering widget.
          </s-paragraph>

          <div className="int-grid">
            {integrations.map((item) => (
              <div key={item.id} className="int-card">
                <div className="int-header">
                  <span className={`int-tag int-tag-${item.category.toLowerCase()}`}>
                    {item.category}
                  </span>
                  <label className="int-toggle">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={() => handleToggle(item.id)}
                    />
                    <span className="int-slider"></span>
                  </label>
                </div>
                <div>
                  <h3 className="int-title">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer" style={{color: "inherit", textDecoration: "underline"}}>
                        {item.name} ↗
                      </a>
                    ) : (
                      item.name
                    )}
                  </h3>
                  <p className="int-desc">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
