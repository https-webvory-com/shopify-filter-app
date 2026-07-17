import React, { useState } from "react";
import Papa from "papaparse";

export default function ExportMerchandisingRulesModal({ isOpen, onClose, selectedRuleIds, allRules }) {
  const disabledFields = [
    "Identifier",
    "Item name",
    "Ordinal",
    "Rule conditions",
    "Site identifier"
  ];
  const toggleableFields = [
    "Active",
    "Collection titles",
    "Collections",
    "Customer tags",
    "End Date",
    "For collection pages",
    "Locales",
    "Locations",
    "Search queries",
    "Start Date"
  ];

  const [selectedFields, setSelectedFields] = useState([...disabledFields, ...toggleableFields]);

  if (!isOpen) return null;

  const handleExport = () => {
    const rulesToExport = allRules.filter(r => selectedRuleIds.includes(r.id));
    
    const exportData = rulesToExport.map(rule => {
      const row = {};
      
      if (selectedFields.includes("Identifier")) row["Id"] = rule.id;
      if (selectedFields.includes("Item name")) row["Name"] = rule.name;
      if (selectedFields.includes("Ordinal")) row["Ordinal"] = 0;
      
      if (selectedFields.includes("Rule conditions")) {
        const conditions = (rule.conditions || []).map(c => {
          let field = c.field;
          if (field.endsWith(" (product option)")) {
            field = `option:${field.replace(" (product option)", "")}`;
          } else if (field === "Tags") {
            field = "tags";
          }
          
          let val = c.value;
          if (val && val.includes(",")) {
            val = val.split(",").map(s => s.trim());
          } else if (val) {
            val = [val];
          } else {
            val = [];
          }

          return {
            Type: c.action,
            Field: field,
            Value: val,
            Operator: c.operator || "contains"
          };
        });
        row["Conditions"] = JSON.stringify(conditions);
      }

      if (selectedFields.includes("Site identifier")) row["SiteId"] = rule.shop;
      if (selectedFields.includes("Active")) row["Active"] = rule.status ? "TRUE" : "FALSE";
      
      if (selectedFields.includes("Collection titles")) {
        row["CollectionTitles"] = JSON.stringify(rule.collections || []);
      }
      
      if (selectedFields.includes("Collections")) {
        row["Collections"] = "[]"; // We don't have collection IDs currently
      }
      
      if (selectedFields.includes("Customer tags")) {
        const tags = (rule.customerTags || "").split(",").map(t => t.trim()).filter(Boolean);
        row["CustomerTags"] = tags.length > 0 ? JSON.stringify(tags) : "";
      }
      
      if (selectedFields.includes("End Date")) row["EndDate"] = rule.endDate ? new Date(rule.endDate).toISOString() : "";
      if (selectedFields.includes("Start Date")) row["StartDate"] = rule.startDate ? new Date(rule.startDate).toISOString() : "";
      
      if (selectedFields.includes("For collection pages")) row["ForCollect"] = "TRUE";
      if (selectedFields.includes("Locales")) row["Locales"] = rule.locales || "";
      if (selectedFields.includes("Locations")) row["Locations"] = "";
      if (selectedFields.includes("Search queries")) row["SearchQueries"] = rule.searchQueries && rule.searchQueries.length > 0 ? JSON.stringify(rule.searchQueries) : "";

      return row;
    });

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Export_MerchandisingRule.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onClose();
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: "12px", width: "500px", maxWidth: "90%", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", color: "#1e293b" }}>Export items</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
            <svg style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "0 24px 24px 24px" }}>
          <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            Fields to export
            <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#e2e8f0", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px" }}>?</div>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
            {[...disabledFields, ...toggleableFields].sort().map(field => {
              const isDisabled = disabledFields.includes(field);
              const isChecked = selectedFields.includes(field);
              
              return (
                <label key={field} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: isDisabled ? "not-allowed" : "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={(e) => {
                      if (!isDisabled) {
                        if (e.target.checked) {
                          setSelectedFields([...selectedFields, field]);
                        } else {
                          setSelectedFields(selectedFields.filter(f => f !== field));
                        }
                      }
                    }}
                    style={{ cursor: isDisabled ? "not-allowed" : "pointer", accentColor: "#5B21B6" }}
                  />
                  <span style={{ fontSize: "14px", color: isDisabled ? "#a78bfa" : "#5B21B6", fontWeight: "600" }}>{field}</span>
                  <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#e2e8f0", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px" }}>?</div>
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
              Export format
              <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#e2e8f0", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px" }}>?</div>
            </div>
            <div style={{ padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", color: "#5B21B6", fontWeight: "600", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
              CSV
              <svg style={{ width: "16px", height: "16px", color: "#a78bfa" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", padding: "16px 24px", borderTop: "1px solid #e2e8f0" }}>
          <button 
            onClick={onClose}
            style={{ padding: "8px 24px", borderRadius: "24px", border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
          >
            CANCEL
          </button>
          <button 
            onClick={handleExport}
            style={{ padding: "8px 24px", borderRadius: "24px", border: "none", background: "#5B21B6", color: "#fff", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
