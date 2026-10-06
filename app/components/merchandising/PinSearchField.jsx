export default function PinSearchField({ value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", fontSize: "13px", color: "#334155" }}>
      Search by
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", color: "#1E1B4B" }}
      >
        <option value="title">Product title</option>
        <option value="tags">Product tags</option>
      </select>
    </label>
  );
}
