import { useLocation, useNavigation } from "react-router";
import LoadingSpinner from "./LoadingSpinner";

export default function AdminLoadingBoundary({ children }) {
  const location = useLocation();
  const navigation = useNavigation();
  const changingPage = navigation.state === "loading" && Boolean(navigation.location) &&
    navigation.location.pathname !== location.pathname;

  return (
    <div style={{ position: "relative" }} aria-busy={changingPage}>
      {changingPage && (
        <div role="status" aria-live="polite" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", zIndex: 9999 }}>
          <LoadingSpinner text="Loading page..." size="50px" />
        </div>
      )}
      <div style={{ visibility: changingPage ? "hidden" : "visible" }} inert={changingPage ? "" : undefined}>
        {children}
      </div>
    </div>
  );
}
