export function SampleCsvDownload({ href, children }) {
  return (
    <div style={{ marginBottom: "20px", fontSize: "13px", color: "#5c5f62" }}>
      <a href={href} download style={{ color: "#5B21B6", fontWeight: 600 }}>
        Download sample CSV
      </a>
      <p style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
        {children} Replace the test rows with your values, keep the column headers,
        and save as CSV before uploading.
      </p>
    </div>
  );
}
