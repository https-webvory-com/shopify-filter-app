import React from "react";

export function IconButton({ icon, onClick, style = {}, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px",
        color: "#007bff",
        borderRadius: "4px",
        transition: "background-color 0.2s",
        ...style
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(0, 123, 255, 0.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {icon}
    </button>
  );
}
