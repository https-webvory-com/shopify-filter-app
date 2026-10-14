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
    id: "pinning",
    title: "Product Pinning",
    tag: "Manual Pin",
    description:
      "Pin specific products to the top or specific positions in your search results.",
    path: "/app/search/pinning",
    comingSoon: false,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
        />
      </svg>
    ),
  },
  {
    id: "merchandising",
    title: "Merchandising Rules",
    tag: "Smart Rules",
    description:
      "Create search rules to automatically promote, hide, or sort products based on queries.",
    path: "/app/search/merchandising",
    comingSoon: false,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
        />
      </svg>
    ),
  },
  {
    id: "blacklist",
    title: "Blacklist Suggestions",
    tag: "Filters",
    description:
      "Hide matching phrases from autocomplete suggestions using Contains or Exact match.",
    path: "/app/search/blacklist",
    comingSoon: false,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
        />
      </svg>
    ),
  },
  {
    id: "synonyms",
    title: "Synonyms",
    tag: "Smart Link",
    description:
      "Link similar search terms so customers can find products using different keywords.",
    path: "/app/search/synonyms",
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    ),
  },
  {
    id: "banners",
    title: "Banners",
    tag: "Promo Ads",
    description:
      "Display promotional banners on specific search query result pages.",
    path: "/app/search/banners",
    comingSoon: true,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "redirects",
    title: "Page Redirects",
    tag: "Navigation",
    description:
      "Redirect specific search terms to custom pages or URLs automatically.",
    path: "/app/search/redirects",
    comingSoon: false,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    ),
  },
  {
    id: "settings",
    title: "Search Settings",
    tag: "Advanced",
    description:
      "Configure general search behavior, layout, and advanced options.",
    path: "/app/search/settings",
    comingSoon: true,
    icon: (
      <svg
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

export default function SearchOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Search Configuration">
      <ui-title-bar title="Search Configuration"></ui-title-bar>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .sov-wrapper {
            padding: 4px 0 32px 0;
          }

          .sov-subtitle {
            font-size: 13.5px;
            color: #9ca3af;
            margin: 0 0 28px 0;
            font-weight: 400;
            line-height: 1.6;
          }

          /* Grid */
          .sov-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 32px;
          }

          @media (max-width: 700px) {
            .sov-grid { grid-template-columns: 1fr; }
          }

          /* ── Active Card ── */
          .sov-card {
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

          .sov-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(91,33,182,0.10),
                        0 1px 4px rgba(0,0,0,0.04);
            border-color: #a5b4fc;
          }

          /* ── Coming Soon Card ── */
          .sov-card-soon {
            background: #fafafa;
            border-radius: 16px;
            border: 1.5px dashed #d8b4fe;
            display: flex;
            overflow: hidden;
            cursor: not-allowed;
            position: relative;
            box-shadow: none;
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
            text-transform: uppercase;
            padding: 4px 28px;
            transform: rotate(35deg);
            z-index: 10;
            box-shadow: 0 2px 6px rgba(91,33,182,0.3);
          }

          /* Mute the coming soon card content */
          .sov-card-soon .sov-panel {
            background: linear-gradient(160deg, #a78bfa 0%, #c4b5fd 100%);
            opacity: 0.7;
          }

          .sov-card-soon .sov-title {
            color: #9ca3af;
          }

          .sov-card-soon .sov-tag {
            background: #f3f4f6;
            color: #9ca3af;
            border-color: #e5e7eb;
          }

          .sov-card-soon .sov-desc {
            color: #c4b5fd;
          }

          /* ── Gradient Panel (shared) ── */
          .sov-panel {
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

          .sov-panel::before {
            content: '';
            position: absolute;
            top: -30%; left: -30%;
            width: 160%; height: 160%;
            background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 65%);
            pointer-events: none;
          }

          .sov-card:hover .sov-panel {
            width: 78px;
          }

          .sov-panel svg {
            position: relative;
            z-index: 1;
            transition: transform 0.28s cubic-bezier(0.16,1,0.3,1);
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
          }

          .sov-card:hover .sov-panel svg {
            transform: scale(1.15);
          }

          /* ── Body ── */
          .sov-body {
            flex: 1;
            padding: 20px 22px 18px 22px;
            display: flex;
            flex-direction: column;
            min-width: 0;
          }

          .sov-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
          }

          .sov-title {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            margin: 0;
            letter-spacing: -0.1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .sov-tag {
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
            border: 1px solid #ddd6fe;
          }

          .sov-desc {
            font-size: 12px;
            color: #9ca3af;
            line-height: 1.6;
            margin: 0 0 12px 0;
            flex: 1;
          }

          /* Active CTA button */
          .sov-btn {
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

          .sov-card:hover .sov-btn {
            background: #5B21B6;
            border-color: #5B21B6;
            color: #ffffff;
            gap: 8px;
            padding-right: 10px;
          }

          .sov-btn svg {
            transition: transform 0.22s ease;
          }

          .sov-card:hover .sov-btn svg {
            transform: translateX(2px);
          }

          /* Coming Soon badge */
          .sov-soon-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 11px;
            border-radius: 20px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            font-size: 11px;
            font-weight: 600;
            color: #9ca3af;
            align-self: flex-start;
            letter-spacing: 0.02em;
          }

          /* Coming soon bottom bar */
          .sov-soon-bar {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 8px;
            background: linear-gradient(90deg, #f5f3ff, #ede9fe);
            border: 1px solid #ddd6fe;
            font-size: 11px;
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

          /* Staggered entry */
          @keyframes sovFadeUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          ${cards
            .map(
              (c, i) => `
            .sov-card-wrap:nth-child(${i + 1}) {
              animation: sovFadeUp 0.45s cubic-bezier(0.16,1,0.3,1) ${i * 0.07}s both;
            }
          `,
            )
            .join("")}
        `,
        }}
      />

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Search Features">
          <div className="sov-wrapper">
            <p className="sov-subtitle">
              Choose a feature below to configure how your store's search works
              for customers.
            </p>

            <div className="sov-grid">
              {cards.map((card) => (
                <div key={card.id} className="sov-card-wrap">
                  <div
                    className={card.comingSoon ? "sov-card-soon" : "sov-card"}
                    onClick={() => !card.comingSoon && navigate(card.path)}
                  >
                    {/* Gradient panel */}
                    <div className="sov-panel">{card.icon}</div>

                    {/* Content */}
                    <div className="sov-body">
                      <div className="sov-top-row">
                        <h3 className="sov-title">{card.title}</h3>
                        <span className="sov-tag">{card.tag}</span>
                      </div>

                      <p className="sov-desc">{card.description}</p>

                      {card.comingSoon ? (
                        <div className="sov-soon-bar">
                          <svg
                            className="sov-soon-icon"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Coming Soon
                        </div>
                      ) : (
                        <button className="sov-btn">
                          Open
                          <svg
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.5"
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Corner ribbon for coming soon */}
                    {card.comingSoon && (
                      <div className="sov-soon-ribbon">Upcoming</div>
                    )}
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
