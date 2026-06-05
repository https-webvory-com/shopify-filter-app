import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useNavigate } from "react-router";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function SearchSynonyms() {
  const navigate = useNavigate();
  return (
    <s-page heading="Search Synonyms">
      <ui-title-bar title="Search Synonyms">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text>This page will allow you to link similar search terms.</s-text>
      </s-box>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
