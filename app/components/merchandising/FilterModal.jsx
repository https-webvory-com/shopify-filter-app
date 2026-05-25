import { useState, useEffect } from "react";

export default function FilterModal({ isOpen, onClose, onApply, currentMatchType = "all", currentFilters = [] }) {
  const [matchType, setMatchType] = useState(currentMatchType);
  const [filters, setFilters] = useState(currentFilters);

  useEffect(() => {
    if (isOpen) {
      setMatchType(currentMatchType);
      setFilters(currentFilters);
    }
  }, [isOpen, currentMatchType, currentFilters]);

  const fieldOptions = [
    { label: "Collections", value: "Collections" },
    { label: "Active", value: "Active" },
    { label: "Item name", value: "Item name" }
  ];

  const getOperatorOptions = (field) => {
    if (field === "Active") {
      return [
        { label: "equals", value: "equals" },
        { label: "does not equal", value: "does not equal" }
      ];
    }
    return [
      { label: "contains", value: "contains" },
      { label: "does not contains", value: "does not contains" },
      { label: "equals", value: "equals" },
      { label: "does not equal", value: "does not equal" },
      { label: "starts with", value: "starts with" },
      { label: "ends with", value: "ends with" }
    ];
  };

  const addFilter = () => {
    setFilters([...filters, { field: "Collections", operator: "contains", value: "" }]);
  };

  const updateFilter = (index, key, value) => {
    const newFilters = [...filters];
    newFilters[index][key] = value;
    
    if (key === "field") {
      if (value === "Active") {
        newFilters[index].operator = "equals";
        newFilters[index].value = true;
      } else {
        newFilters[index].operator = "contains";
        newFilters[index].value = "";
      }
    }
    
    setFilters(newFilters);
  };

  const removeFilter = (index) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", width: "700px", borderRadius: "8px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)", display: "flex", flexDirection: "column" }}>
        
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px", borderBottom: "1px solid transparent" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#334155" }}>Filter</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "20px" }}>
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "0 24px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#334155" }}>
              Show results matching 
              <select 
                value={matchType}
                onChange={e => setMatchType(e.target.value)}
                style={{ appearance: "none", background: "#eff6ff", color: "#007bff", border: "none", padding: "4px 24px 4px 12px", borderRadius: "16px", fontSize: "14px", fontWeight: "500", outline: "none", cursor: "pointer" }}
              >
                <option value="all">all</option>
                <option value="any">any</option>
              </select>
              of the following conditions
            </div>

            {filters.length > 0 && (
              <button onClick={() => setFilters([])} style={{ background: "#fff", border: "1px solid #007bff", color: "#007bff", padding: "6px 16px", borderRadius: "20px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                CLEAR ALL
              </button>
            )}
          </div>

          {/* Filters List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
            {filters.map((filter, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Field Dropdown */}
                <div style={{ position: "relative", flex: 1 }}>
                  <select 
                    value={filter.field}
                    onChange={e => updateFilter(index, "field", e.target.value)}
                    style={{ width: "100%", appearance: "none", background: "#f8fafc", color: "#007bff", border: "none", padding: "10px 16px", borderRadius: "20px", fontSize: "14px", fontWeight: "500", outline: "none", cursor: "pointer" }}
                  >
                    {fieldOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Operator Dropdown */}
                <div style={{ position: "relative", flex: 1 }}>
                  <select 
                    value={filter.operator}
                    onChange={e => updateFilter(index, "operator", e.target.value)}
                    style={{ width: "100%", appearance: "none", background: "#f8fafc", color: "#007bff", border: "none", padding: "10px 16px", borderRadius: "20px", fontSize: "14px", fontWeight: "500", outline: "none", cursor: "pointer" }}
                  >
                    {getOperatorOptions(filter.field).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Value Input or Toggle */}
                <div style={{ flex: 1 }}>
                  {filter.field === "Active" ? (
                    <div style={{ display: "flex", alignItems: "center", paddingLeft: "16px" }}>
                      <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <div style={{ position: "relative" }}>
                          <input 
                            type="checkbox" 
                            checked={filter.value} 
                            onChange={e => updateFilter(index, "value", e.target.checked)} 
                            style={{ srOnly: true, opacity: 0, position: "absolute" }} 
                          />
                          <div style={{ width: "36px", height: "20px", background: filter.value ? "#007bff" : "#cbd5e1", borderRadius: "10px", transition: "all 0.3s" }}>
                            <div style={{ position: "absolute", top: "2px", left: filter.value ? "18px" : "2px", width: "16px", height: "16px", background: "#fff", borderRadius: "50%", transition: "all 0.3s" }}></div>
                          </div>
                        </div>
                      </label>
                    </div>
                  ) : (
                    <input 
                      type="text" 
                      value={filter.value}
                      onChange={e => updateFilter(index, "value", e.target.value)}
                      placeholder="Enter value"
                      style={{ width: "100%", background: "#f8fafc", color: "#007bff", border: "none", padding: "10px 16px", borderRadius: "20px", fontSize: "14px", outline: "none" }}
                    />
                  )}
                </div>

                {/* Delete button */}
                <button onClick={() => removeFilter(index)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "8px" }}>
                  <svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add Filter Button */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
            <button 
              onClick={addFilter}
              style={{ background: "#007bff", color: "#fff", border: "none", padding: "10px 32px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", width: filters.length === 0 ? "50%" : "100%", justifyContent: "center" }}
            >
              <span style={{ fontSize: "18px", lineHeight: 1 }}>+</span> Add filter
            </button>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "32px" }}>
            <button 
              onClick={onClose}
              style={{ background: "#fff", color: "#94a3b8", border: "1px solid #cbd5e1", padding: "10px 24px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
            >
              CANCEL
            </button>
            <button 
              onClick={() => onApply(matchType, filters)}
              style={{ background: "#007bff", color: "#fff", border: "none", padding: "10px 32px", borderRadius: "24px", fontSize: "14px", fontWeight: "600", cursor: "pointer", opacity: filters.length > 0 && filters.some(f => f.field !== 'Active' && f.value === "") ? 0.7 : 1 }}
              disabled={filters.length > 0 && filters.some(f => f.field !== 'Active' && f.value === "")}
            >
              OK
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
