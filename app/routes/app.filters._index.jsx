import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app/filters/groups");
};

export default function FiltersIndex() {
  return null;
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
