import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

const fields = [
  { value: "title", label: "Title", operator: "contains", placeholder: "Enter product title" },
  { value: "tags", label: "Tag", operator: "is", placeholder: "Search or choose a tag" },
  { value: "id", label: "ID", operator: "is", placeholder: "Enter product ID" },
];

export default function PinSearchField({ value, onChange, query, onQueryChange }) {
  const fetcher = useFetcher();
  const submit = fetcher.submit;
  const [open, setOpen] = useState(null);
  const [highlighted, setHighlighted] = useState(0);
  const root = useRef(null);
  const input = useRef(null);
  const listId = useId();
  const field = fields.find(field => field.value === value) || fields[0];
  const tags = fetcher.data?.query === query && fetcher.state === "idle" ? fetcher.data.tags || [] : [];
  const options = open === "fields" ? fields : tags;

  useEffect(() => {
    if (value !== "tags") return;
    const timer = setTimeout(() => submit({ intent: "tagSuggestions", q: query }, { method: "post" }), 200);
    return () => clearTimeout(timer);
  }, [value, query, submit]);

  useEffect(() => {
    const close = event => { if (!root.current?.contains(event.target)) setOpen(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => setHighlighted(0), [open, query]);

  function choose(option) {
    input.current?.focus();
    if (open === "fields") {
      onChange(option.value);
      onQueryChange("");
      setOpen(option.value === "tags" ? "tags" : null);
    } else {
      onQueryChange(option);
      setOpen(null);
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(null); }
    if (!open || !options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[Math.min(highlighted, options.length - 1)]);
    }
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
    }} style={{ flex: 1, minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", minHeight: 42, boxSizing: "border-box" }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg>
        <button type="button" aria-label="Search field" aria-haspopup="listbox" aria-expanded={open === "fields"} onClick={() => setOpen(open === "fields" ? null : "fields")}
          style={{ border: 0, borderRadius: 4, padding: "4px 8px", background: "#f1f5f9", color: "#334155", whiteSpace: "nowrap", cursor: "pointer" }}>
          {field.label} {field.operator} ?
        </button>
        <input ref={input} type="text" role="combobox" aria-label={"Search products by " + field.label} aria-autocomplete={value === "tags" ? "list" : "none"}
          aria-expanded={!!open} aria-controls={open ? listId : undefined} aria-activedescendant={open && options.length ? listId + "-" + Math.min(highlighted, options.length - 1) : undefined}
          placeholder={field.placeholder} value={query} autoComplete="off"
          onFocus={() => { if (value === "tags") setOpen("tags"); }}
          onChange={event => { onQueryChange(event.target.value); setOpen(value === "tags" ? "tags" : null); }}
          style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: 14, color: "#334155" }} />
        {query && <button type="button" aria-label="Clear product search" onClick={() => { onQueryChange(""); input.current?.focus(); }} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#64748b" }}>?</button>}
      </div>
      {open && <div id={listId} role="listbox" aria-label={open === "fields" ? "Search fields" : "Matching tags"}
        style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 300, maxWidth: "100%", maxHeight: 280, overflowY: "auto", zIndex: 20, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 4, boxShadow: "0 8px 24px #0002" }}>
        {options.map((option, index) => <button key={open === "fields" ? option.value : option} id={listId + "-" + index} type="button" role="option" aria-selected={index === highlighted}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlighted(index)} onClick={() => choose(option)}
          style={{ display: "block", width: "100%", border: 0, textAlign: "left", padding: "9px 12px", borderRadius: 4, background: index === highlighted ? "#f1f5f9" : "#fff", color: "#334155", cursor: "pointer" }}>
          {open === "fields" ? option.label : option}
        </button>)}
        {open === "tags" && !tags.length && <div role="status" style={{ padding: "9px 12px", color: "#64748b", fontSize: 13 }}>{fetcher.state !== "idle" || fetcher.data?.query !== query ? "Loading tags?" : "No matching tags"}</div>}
      </div>}
    </div>
  );
}
