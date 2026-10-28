import { useFetchers, useLocation, useNavigation } from "react-router";
import LoadingSpinner from "./LoadingSpinner";

const isMutation = request => request.state !== "idle" &&
  request.formMethod && request.formMethod.toUpperCase() !== "GET" &&
  !["search", "lookup", "preview"].includes(String(request.formData?.get("intent") || "").toLowerCase());

function mutationLabel(request) {
  const intent = String(request.formData?.get("intent") || request.formData?.get("actionType") || "").toLowerCase();
  if (intent.includes("delete") || intent.includes("remove")) return "Deleting rule...";
  if (intent.includes("duplicate")) return "Duplicating rule...";
  return "Saving changes...";
}

export default function AdminLoadingBoundary({ children }) {
  const location = useLocation();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const changingPage = navigation.state === "loading" && Boolean(navigation.location) &&
    navigation.location.pathname !== location.pathname;
  const mutation = [navigation, ...fetchers].find(isMutation);
  const busy = changingPage || Boolean(mutation);

  return (
    <div style={{ position: "relative" }} aria-busy={busy}>
      {busy && (
        <div role="status" aria-live="polite" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: changingPage ? "#fff" : "rgba(255,255,255,0.82)", zIndex: 9999 }}>
          <LoadingSpinner text={changingPage ? "Loading page..." : mutationLabel(mutation)} size="50px" />
        </div>
      )}
      <div style={{ visibility: changingPage ? "hidden" : "visible" }} inert={changingPage ? "" : undefined}>
        {children}
      </div>
    </div>
  );
}
