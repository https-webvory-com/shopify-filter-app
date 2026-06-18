import React from "react";

export function Modal({ isOpen, onClose, title, children, footer, width = "600px", padding }) {
  if (!isOpen) return null;

  const headerPadding = padding ? `${padding} ${padding} 12px` : "24px 32px 16px";
  const bodyPadding = padding ? `12px ${padding}` : "16px 32px";
  const footerPadding = padding ? `12px ${padding} ${padding}` : "16px 32px 24px";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          width: width,
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          position: "relative",
        }}
      >
        {/* Header */}
        <div style={{ padding: headerPadding, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600, color: "#202223" }}>{title}</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#5c5f62" }}
          >
            <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "currentColor" }}>
              <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: bodyPadding, overflowY: "auto", flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{ padding: footerPadding, display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
