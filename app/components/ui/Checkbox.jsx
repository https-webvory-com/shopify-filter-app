import React from "react";

export function Checkbox({ checked, onChange, style = {} }) {
  return (
    <label style={{ display: "inline-flex", position: "relative", cursor: "pointer", ...style }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          appearance: "none",
          width: "16px",
          height: "16px",
          border: `1.5px solid ${checked ? "#007bff" : "#c9cccf"}`,
          borderRadius: "4px",
          backgroundColor: checked ? "#007bff" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          cursor: "pointer",
          position: "relative"
        }}
      />
      {checked && (
        <svg 
          viewBox="0 0 14 14" 
          style={{ 
            position: "absolute",
            width: "10px", 
            height: "10px", 
            fill: "none", 
            stroke: "#fff", 
            strokeWidth: "2", 
            strokeLinecap: "round",
            strokeLinejoin: "round",
            pointerEvents: "none",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)"
          }}
        >
          <path d="M3 7l2.5 2.5L11 4" />
        </svg>
      )}
    </label>
  );
}
