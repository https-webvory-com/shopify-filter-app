import React from "react";

export function Button({ 
  children, 
  variant = "default", // primary, default, light, split 
  onClick, 
  icon, 
  rightIcon,
  style = {},
  disabled = false,
  ...props 
}) {
  let bg = "#fff";
  let color = "#202223";
  let border = "1px solid #c9cccf";

  if (variant === "primary") {
    bg = "#007bff"; // Blue from reference
    color = "#fff";
    border = "1px solid #007bff";
  } else if (variant === "light") {
    bg = "#f0f4f9"; // Light blue from reference
    color = "#0066cc";
    border = "1px solid transparent";
  } else if (variant === "split-primary") {
    bg = "#007bff";
    color = "#fff";
    border = "1px solid #007bff";
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: variant.includes("split") ? "8px 12px" : "8px 16px",
        borderRadius: "20px", // Rounded corners from reference
        background: bg,
        color: color,
        border: border,
        fontSize: "14px",
        fontWeight: "600",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.2s ease",
        ...style
      }}
      {...props}
    >
      {icon && <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>}
      {children}
      {rightIcon && <span style={{ display: "flex", alignItems: "center" }}>{rightIcon}</span>}
    </button>
  );
}

export function SplitButton({ children, onClickMain, onClickDropdown, dropdownIcon }) {
  return (
    <div style={{ display: "inline-flex", borderRadius: "20px", overflow: "hidden" }}>
      <button
        onClick={onClickMain}
        style={{
          background: "#007bff",
          color: "#fff",
          border: "none",
          padding: "8px 16px",
          fontSize: "14px",
          fontWeight: "600",
          cursor: "pointer",
        }}
      >
        {children}
      </button>
      <div style={{ width: "1px", background: "rgba(255,255,255,0.3)" }} />
      <button
        onClick={onClickDropdown}
        style={{
          background: "#007bff",
          color: "#fff",
          border: "none",
          padding: "8px 10px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {dropdownIcon || (
          <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" }}>
            <path d="M5 7l5 5 5-5" />
          </svg>
        )}
      </button>
    </div>
  );
}
