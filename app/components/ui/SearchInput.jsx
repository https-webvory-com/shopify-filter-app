import React from "react";

export function SearchInput({ value, onChange, placeholder = "Search", style = {} }) {
  return (
    <div style={{ position: "relative", width: "200px", ...style }}>
      <svg 
        viewBox="0 0 20 20" 
        style={{ 
          width: "16px", 
          height: "16px", 
          fill: "none", 
          stroke: "#007bff", 
          strokeWidth: "2", 
          position: "absolute", 
          left: "12px", 
          top: "50%", 
          transform: "translateY(-50%)" 
        }}
      >
        <circle cx="9" cy="9" r="5" />
        <path d="M13 13l4 4" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{
          width: "100%",
          padding: "8px 12px 8px 36px",
          borderRadius: "20px",
          border: "none",
          backgroundColor: "#f0f4f9",
          fontSize: "14px",
          color: "#007bff",
          outline: "none",
          fontWeight: "500",
          boxSizing: "border-box",
        }}
      />
      <style>{`
        input::placeholder {
          color: #007bff;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
