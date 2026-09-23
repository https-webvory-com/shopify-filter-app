import { useState } from "react";

export function todayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function DateRangePicker({
  startDate = "",
  endDate = "",
  onSelect,
  onCancel,
}) {
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const invalid = !start || !end || start > end;
  return (
    <div
      role="dialog"
      aria-label="Select date range"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: "8px",
        padding: "20px",
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
        zIndex: 30,
        width: "340px",
        maxWidth: "calc(100vw - 64px)",
      }}
    >
      <div style={{ display: "flex", gap: "12px" }}>
        <label>
          Start date
          <input
            aria-label="Start date"
            type="date"
            value={start}
            max={end || undefined}
            onChange={(event) => setStart(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: "8px" }}
          />
        </label>
        <label>
          End date
          <input
            aria-label="End date"
            type="date"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: "8px" }}
          />
        </label>
      </div>
      {start && end && start > end && (
        <p role="alert">End date must be on or after start date.</p>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "12px",
          marginTop: "20px",
        }}
      >
        <button type="button" onClick={() => onSelect("", "")}>
          Clear
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={invalid}
          onClick={() => onSelect(start, end)}
        >
          Select
        </button>
      </div>
    </div>
  );
}
