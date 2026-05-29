import { useState, useEffect } from "react";

export default function CustomizeColumnsModal({ isOpen, onClose, currentColumns, onApply }) {
  const [columns, setColumns] = useState([...currentColumns]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      setColumns([...currentColumns]);
      setSearchQuery("");
    }
  }, [isOpen, currentColumns]);

  if (!isOpen) return null;

  const filteredColumns = columns.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase()));
  const selectedCount = columns.filter(c => c.visible).length;
  
  const allVisible = columns.every(c => c.visible);

  const toggleAll = () => {
    const newVis = !allVisible;
    setColumns(columns.map(c => ({ ...c, visible: newVis })));
  };

  const clearAll = () => {
    setColumns(columns.map(c => ({ ...c, visible: false })));
  };

  const toggleColumn = (id) => {
    setColumns(columns.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  };

  const removeColumn = (id) => {
    setColumns(columns.map(c => c.id === id ? { ...c, visible: false } : c));
  };

  const moveColumn = (index, direction) => {
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === columns.length - 1) return;
    const newCols = [...columns];
    const temp = newCols[index];
    newCols[index] = newCols[index + direction];
    newCols[index + direction] = temp;
    setColumns(newCols);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "800px", borderRadius: "8px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)", display: "flex", flexDirection: "column" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px", borderBottom: "1px solid transparent" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#334155" }}>Customize Columns</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "20px" }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "0 24px 24px", display: "flex", gap: "40px" }}>
          
          {/* Left Side: Select Columns */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", padding: "8px 16px", borderRadius: "20px", width: "100%", border: "1px solid #e2e8f0" }}>
                <svg style={{ width: "16px", height: "16px", color: "#64748b", marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input 
                  type="text" 
                  placeholder="Search" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#333", width: "100%" }} 
                />
              </div>
              <button onClick={toggleAll} style={{ background: "none", border: "none", color: "#007bff", fontSize: "13px", fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap" }}>
                {allVisible ? "deselect all" : "select all"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px", maxHeight: "300px", overflowY: "auto" }}>
              {filteredColumns.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", color: "#007bff", fontSize: "14px", fontWeight: "500" }}>
                  <div style={{ position: "relative", width: "18px", height: "18px" }}>
                    <input 
                      type="checkbox" 
                      checked={c.visible}
                      onChange={() => toggleColumn(c.id)}
                      style={{ srOnly: true, position: "absolute", opacity: 0 }}
                    />
                    <div style={{ width: "16px", height: "16px", border: c.visible ? "none" : "1px solid #cbd5e1", borderRadius: "4px", background: c.visible ? "#007bff" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {c.visible && <svg style={{ width: "12px", height: "12px", color: "#fff" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>}
                    </div>
                  </div>
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          {/* Right Side: Reorder Columns */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
              <span style={{ fontSize: "14px", color: "#64748b", fontWeight: "500" }}>{selectedCount} columns selected</span>
              <button onClick={clearAll} style={{ background: "none", border: "none", color: "#007bff", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                clear all
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
              {columns.filter(c => c.visible).map((c, i, arr) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", cursor: "pointer" }}>
                      <svg onClick={() => moveColumn(columns.findIndex(col => col.id === c.id), -1)} style={{ width: "12px", height: "12px", color: i === 0 ? "#cbd5e1" : "#64748b" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                      <svg onClick={() => moveColumn(columns.findIndex(col => col.id === c.id), 1)} style={{ width: "12px", height: "12px", color: i === arr.length - 1 ? "#cbd5e1" : "#64748b" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                    <span style={{ fontSize: "14px", color: "#334155" }}>{c.label}</span>
                  </div>
                  <button onClick={() => removeColumn(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
                    <svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", padding: "20px 24px", borderTop: "1px solid #e2e8f0" }}>
          <button 
            onClick={onClose}
            style={{ background: "#fff", color: "#94a3b8", border: "1px solid #cbd5e1", padding: "10px 24px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
          >
            CANCEL
          </button>
          <button 
            onClick={() => onApply(columns)}
            style={{ background: "#7cb3ff", color: "#fff", border: "none", padding: "10px 32px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
          >
            OK
          </button>
        </div>

      </div>
    </div>
  );
}
