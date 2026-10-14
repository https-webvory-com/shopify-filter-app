import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({ content, children, width = 280 }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const anchorRef = useRef(null);
  const popupRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open || !content) return;
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const popup = popupRef.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      const below = anchor.top < popup.height + 16;
      setPosition({
        left: Math.max(8, Math.min(anchor.left + anchor.width / 2 - popup.width / 2, window.innerWidth - popup.width - 8)),
        top: Math.max(8, Math.min(below ? anchor.bottom + 8 : anchor.top - popup.height - 8, window.innerHeight - popup.height - 8)),
      });
    };
    const dismiss = (event) => { if (event.key === "Escape") setOpen(false); };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    document.addEventListener("keydown", dismiss);
    const observer = new ResizeObserver(update);
    observer.observe(popupRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open, content]);

  const show = () => { setPosition(null); setOpen(true); };
  return (
    <span
      ref={anchorRef}
      style={{ display: "inline-flex", alignItems: "center" }}
      tabIndex={content ? 0 : undefined}
      aria-describedby={open && content ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content && createPortal(
        <div ref={popupRef} id={id} role="tooltip" style={{
          position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0,
          visibility: position ? "visible" : "hidden", zIndex: 1000000,
          boxSizing: "border-box", width, maxWidth: "calc(100vw - 16px)",
          maxHeight: "calc(100vh - 16px)", overflowY: "auto",
          background: "#313745", color: "#fff", padding: "12px",
          borderRadius: "6px", fontSize: "13px", fontWeight: 400,
          fontFamily: "inherit", lineHeight: 1.5, letterSpacing: "normal",
          textTransform: "none", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          textAlign: "left", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>{content}</div>, document.body
      )}
    </span>
  );
}
