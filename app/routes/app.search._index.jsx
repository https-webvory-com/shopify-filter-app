import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const cards = [
  {
    id: "pinning",
    title: "Pinning",
    description: "Pin specific products to the top or specific positions in your search results.",
    path: "/app/search/pinning",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
      </svg>
    ),
  },
  {
    id: "merchandising",
    title: "Merchandising rules",
    description: "Create search rules to automatically promote, hide, or sort products based on queries.",
    path: "/app/search/merchandising",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
      </svg>
    ),
  },
  {
    id: "blacklist",
    title: "Blacklist suggestions",
    description: "Hide specific terms or products from search auto-suggestions.",
    path: "/app/search/blacklist",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
      </svg>
    ),
  },
  {
    id: "synonyms",
    title: "Synonyms",
    description: "Link similar search terms so customers can find products using different keywords.",
    path: "/app/search/synonyms",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
      </svg>
    ),
  },
  {
    id: "banners",
    title: "Banners",
    description: "Display promotional banners on specific search query result pages.",
    path: "/app/search/banners",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
      </svg>
    ),
  },
  {
    id: "redirects",
    title: "Page redirects",
    description: "Redirect specific search terms to custom pages or URLs automatically.",
    path: "/app/search/redirects",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
      </svg>
    ),
  },
  {
    id: "settings",
    title: "Search settings",
    description: "Configure general search behavior, layout, and advanced options.",
    path: "/app/search/settings",
    icon: (
      <svg style={{ width: "20px", height: "20px", color: "#5c5f62" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      </svg>
    ),
  },
];

export default function SearchOverview() {
  const navigate = useNavigate();

  return (
    <s-page heading="Search Configuration">
      <ui-title-bar title="Search Configuration"></ui-title-bar>

      <s-stack direction="block" gap="base">
        <s-section heading="Manage Search Features">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {cards.map((card) => (
              <s-box
                key={card.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
                style={{
                  backgroundColor: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <div style={{ flex: 1 }}>
                  <s-stack direction="inline" gap="base" blockAlign="center">
                    {card.icon}
                    <s-text variant="headingSm" fontWeight="semibold">
                      {card.title}
                    </s-text>
                  </s-stack>
                  <div
                    style={{
                      marginTop: "12px",
                      color: "#6d7175",
                      fontSize: "14px",
                      lineHeight: "20px",
                    }}
                  >
                    {card.description}
                  </div>
                </div>
                <div style={{ marginTop: "20px" }}>
                  <s-button
                    onClick={() => navigate(card.path)}
                    variant={card.id === "merchandising" ? "primary" : "secondary"}
                  >
                    Manage {card.title}
                  </s-button>
                </div>
              </s-box>
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
