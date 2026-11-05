import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const BRAND = "#5B21B6";

const cards = [
  {
    id: "groups",
    title: "Filter Groups",
    tag: "Core Tool",
    tagColor: BRAND,
    description:
      "Create and manage groups of filters for your search and collection pages.",
    path: "/app/filters/groups",
    icon: (
      <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    iconBg: BRAND,
    accentColor: BRAND,
  },
  {
    id: "merged",
    title: "Merged Values",
    tag: "Smart Merge",
    tagColor: BRAND,
    description:
      "Combine multiple similar option values (e.g. Navy, Sky Blue) into a single unified filter option (Blue).",
    path: "/app/filters/merged-value",
    icon: (
      <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
    iconBg: BRAND,
    accentColor: BRAND,
  },
  {
    id: "settings",
    title: "Filter Settings",
    tag: "Advanced",
    tagColor: BRAND,
    description:
      "Configure advanced filter settings like horizontal layout, product count, and display preferences.",
    path: "/app/filters/settings",
    icon: (
      <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
    iconBg: BRAND,
    accentColor: BRAND,
  },
];

export default function FiltersOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Filters">
      <ui-title-bar title="Filters"></ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .fov-wrapper {
            padding: 4px 0 32px 0;
          }

          .fov-subtitle {
            font-size: 13.5px;
            color: #9ca3af;
            margin: 0 0 22px 0;
            font-weight: 400;
            line-height: 1.6;
          }

          .fov-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
          }

          @media (max-width: 700px) {
            .fov-grid { grid-template-columns: 1fr; }
          }

          .fov-card {
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #ede9fe;
            display: flex;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1),
                        box-shadow 0.28s cubic-bezier(0.16,1,0.3,1),
                        border-color 0.28s ease;
            box-shadow: 0 1px 3px rgba(91,33,182,0.06),
                        0 1px 8px rgba(0,0,0,0.04);
          }

          .fov-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(91,33,182,0.10),
                        0 1px 4px rgba(0,0,0,0.04);
            border-color: #a5b4fc;
          }

          .fov-panel {
            width: 72px;
            flex-shrink: 0;
            background: linear-gradient(160deg, #5B21B6 0%, #7C3AED 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            position: relative;
            overflow: hidden;
            transition: width 0.28s cubic-bezier(0.16,1,0.3,1);
          }

          .fov-panel::before {
            content: '';
            position: absolute;
            top: -30%;
            left: -30%;
            width: 160%;
            height: 160%;
            background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 65%);
            pointer-events: none;
          }

          .fov-card:hover .fov-panel {
            width: 78px;
          }

          .fov-panel svg {
            position: relative;
            z-index: 1;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1);
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
          }

          .fov-card:hover .fov-panel svg {
            transform: scale(1.15);
          }

          .fov-body {
            flex: 1;
            padding: 15px 16px 13px 16px;
            display: flex;
            flex-direction: column;
            min-width: 0;
          }

          .fov-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
          }

          .fov-title {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            margin: 0;
            letter-spacing: -0.1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .fov-tag {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.7px;
            padding: 3px 8px;
            border-radius: 20px;
            background: #ede9fe;
            color: #5B21B6;
            white-space: nowrap;
            flex-shrink: 0;
            border: 1px solid #e0e7ff;
          }

          .fov-desc {
            font-size: 12px;
            color: #9ca3af;
            line-height: 1.6;
            margin: 0 0 10px 0;
            flex: 1;
          }

          .fov-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 13px;
            border-radius: 20px;
            background: #f5f3ff;
            border: 1px solid #ddd6fe;
            font-size: 11.5px;
            font-weight: 600;
            color: #5B21B6;
            cursor: pointer;
            transition: all 0.22s cubic-bezier(0.16,1,0.3,1);
            align-self: flex-start;
          }

          .fov-card:hover .fov-btn {
            background: #5B21B6;
            border-color: #5B21B6;
            color: #ffffff;
            gap: 8px;
            padding-right: 10px;
          }

          .fov-btn svg {
            transition: transform 0.22s ease;
          }

          .fov-card:hover .fov-btn svg {
            transform: translateX(2px);
          }

          @keyframes fovFadeUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          .fov-card:nth-child(1) { animation: fovFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) 0.00s both; }
          .fov-card:nth-child(2) { animation: fovFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) 0.07s both; }
          .fov-card:nth-child(3) { animation: fovFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) 0.14s both; }
        `,
        }}
      />

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Filters">
          <div className="fov-wrapper">
            <p className="fov-subtitle">
              Choose a feature below to configure how filters appear and behave on your store.
            </p>

            <div className="fov-grid">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="fov-card"
                  onClick={() => navigate(card.path)}
                >
                  <div className="fov-panel">
                    {card.icon}
                  </div>

                  <div className="fov-body">
                    <div className="fov-top-row">
                      <h3 className="fov-title">{card.title}</h3>
                      <span className="fov-tag">{card.tag}</span>
                    </div>

                    <p className="fov-desc">{card.description}</p>

                    <button className="fov-btn">
                      Open
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
