import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { installAdminFetch } from "./utils/adminFetch.js";

installAdminFetch(window);
startTransition(() => {
  hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>);
});
