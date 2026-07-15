import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function SearchRedirects() {
  const navigate = useNavigate();
  return (
    <s-page heading="Search Redirects">
      <ui-title-bar title="Search Redirects">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text>This page will allow you to redirect specific search terms to custom URLs.</s-text>
      </s-box>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
