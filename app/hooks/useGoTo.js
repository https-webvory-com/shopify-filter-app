/**
 * useGoTo — Shopify embedded app safe navigation hook.
 *
 * Problem: In Shopify's iFrame, React Router's useNavigate() only updates
 * the URL bar inside the iFrame but does NOT trigger a full route change.
 * The result: URL changes visually but the page content stays the same.
 *
 * Fix: Use window.location.href to force a real navigation inside the iFrame.
 * This triggers the server loader and renders the new route correctly.
 */
export function useGoTo() {
  return (path) => {
    window.location.href = path;
  };
}
