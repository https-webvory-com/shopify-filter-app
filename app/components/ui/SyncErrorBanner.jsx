export default function SyncErrorBanner({ issue }) {
  if (!issue) return null;
  return (
    <div role="alert" style={{ background: issue.retrying ? "#fffbeb" : "#fef2f2", border: "1px solid " + (issue.retrying ? "#fcd34d" : "#fca5a5"), borderRadius: "8px", padding: "12px", marginBottom: "12px", color: issue.retrying ? "#92400e" : "#991b1b", fontSize: "13px" }}>
      <strong>{issue.retrying ? "Sync is recovering automatically" : "Sync did not complete"}</strong>
      <p style={{ margin: "6px 0" }}>{issue.message}</p>
      <span>{(issue.processed || 0).toLocaleString()} products processed. </span>
      {issue.retrying ? <span>Retrying automatically after attempt {issue.retryCount} of 10. No action is needed yet.</span> : <span>Click Resume Sync to continue from the saved position.</span>}
    </div>
  );
}
