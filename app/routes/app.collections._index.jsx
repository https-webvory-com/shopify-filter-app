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
    id: "merchandising",
    title: "Merchandising",
    tag: "Smart Rules",
    tagColor: BRAND,
    description:
      "Create collection rules to automatically promote, hide, or sort products.",
    path: "/app/collections/merchandising",
    icon: (
      <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    iconBg: BRAND,
    accentColor: BRAND,
  },
  {
    id: "pinning",
    title: "Product Pinning",
    tag: "Manual Pin",
    tagColor: BRAND,
    description:
      "Pin specific products to the top or specific positions in your collections.",
    path: "/app/collections/pinning",
    icon: (
      <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
    iconBg: BRAND,
    accentColor: BRAND,
  },
];

export default function CollectionsOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Collections">
      <ui-title-bar title="Collections"></ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .cov-wrapper {
            padding: 4px 0 32px 0;
          }

          .cov-subtitle {
            font-size: 13.5px;
            color: #9ca3af;
            margin: 0 0 22px 0;
            font-weight: 400;
            line-height: 1.6;
          }

          .cov-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
          }

          @media (max-width: 700px) {
            .cov-grid { grid-template-columns: 1fr; }
          }

          .cov-card {
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

          .cov-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(91,33,182,0.10),
                        0 1px 4px rgba(0,0,0,0.04);
            border-color: #a5b4fc;
          }

          .cov-panel {
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

          .cov-panel::before {
            content: '';
            position: absolute;
            top: -30%;
            left: -30%;
            width: 160%;
            height: 160%;
            background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 65%);
            pointer-events: none;
          }

          .cov-card:hover .cov-panel {
            width: 78px;
          }

          .cov-panel svg {
            position: relative;
            z-index: 1;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1);
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
          }

          .cov-card:hover .cov-panel svg {
            transform: scale(1.15);
          }

          .cov-body {
            flex: 1;
            padding: 15px 16px 13px 16px;
            display: flex;
            flex-direction: column;
            min-width: 0;
          }

          .cov-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
          }

          .cov-title {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            margin: 0;
            letter-spacing: -0.1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .cov-tag {
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

          .cov-desc {
            font-size: 12px;
            color: #9ca3af;
            line-height: 1.6;
            margin: 0 0 10px 0;
            flex: 1;
          }

          .cov-btn {
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

          .cov-card:hover .cov-btn {
            background: #5B21B6;
            border-color: #5B21B6;
            color: #ffffff;
            gap: 8px;
            padding-right: 10px;
          }

          .cov-btn svg {
            transition: transform 0.22s ease;
          }

          .cov-card:hover .cov-btn svg {
            transform: translateX(2px);
          }

          @keyframes covFadeUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          .cov-card:nth-child(1) { animation: covFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) 0.00s both; }
          .cov-card:nth-child(2) { animation: covFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) 0.07s both; }
        `,
        }}
      />

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Collections">
          <div className="cov-wrapper">
            <p className="cov-subtitle">
              Choose a feature below to configure how products are displayed and sorted in your collections.
            </p>

            <div className="cov-grid">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="cov-card"
                  onClick={() => navigate(card.path)}
                >
                  <div className="cov-panel">
                    {card.icon}
                  </div>

                  <div className="cov-body">
                    <div className="cov-top-row">
                      <h3 className="cov-title">{card.title}</h3>
                      <span className="cov-tag">{card.tag}</span>
                    </div>

                    <p className="cov-desc">{card.description}</p>

                    <button className="cov-btn">
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
