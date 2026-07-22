import { Outlet, useLoaderData, useRouteError, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import LoadingSpinner from "../components/ui/LoadingSpinner";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const navigation = useNavigation();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/filters">Filters</s-link>
        <s-link href="/app/search">Search</s-link>
        <s-link href="/app/collections">Collections</s-link>
        <s-link href="/app/settings">Settings</s-link>
        {/* <s-link href="/app/upgrade">Upgrade</s-link> */}
      </s-app-nav>
      {navigation.state === "loading" ? (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255, 255, 255, 0.6)", zIndex: 9999 }}>
          <LoadingSpinner text="Loading page..." size="50px" />
        </div>
      ) : null}
      <div style={{ opacity: navigation.state === "loading" ? 0.3 : 1, transition: "opacity 0.2s" }}>
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
