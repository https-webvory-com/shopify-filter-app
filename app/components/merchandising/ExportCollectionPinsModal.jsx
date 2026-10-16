import { sortPinningRules } from "../../utils/pinImportOrder.js";
import React, { useState } from "react";
import Papa from "papaparse";

export default function ExportCollectionPinsModal({ isOpen, onClose, selectedRuleIds, allRules }) {
  const fields = [
    "Active",
    "AppliedToInstantSearch",
    "AppliedToSearch",
    "Brief",
    "CollectionTitles",
    "Collections",
    "ForCollections",
    "Id",
    "Products",
    "SearchQuery",
    "SiteId"
  ];

  const [selectedFields, setSelectedFields] = useState(fields);

  if (!isOpen) return null;

  const extractNumericId = (gid) => {
    if (!gid) return "";
    const match = String(gid).match(/\/(\d+)$/);
    return match ? match[1] : String(gid);
  };

  const handleExport = () => {
    const rulesToExport = sortPinningRules(allRules.filter(r => selectedRuleIds.includes(r.id)));
    
    const exportData = rulesToExport.map(rule => {
      const row = {};
      
      if (selectedFields.includes("Active")) row["Active"] = rule.status ? "True" : "False";
      if (selectedFields.includes("AppliedToInstantSearch")) row["AppliedToInstantSearch"] = "True";
      if (selectedFields.includes("AppliedToSearch")) row["AppliedToSearch"] = "True";
      
      if (selectedFields.includes("Brief")) {
        const products = (rule.products || []).slice(0, 4).map(p => ({
          Id: extractNumericId(p.id),
          ImageUrl: p.imageUrl || p.image || p.src || ""
        }));
        row["Brief"] = JSON.stringify({ Total: (rule.products || []).length, Items: products });
      }
      
      if (selectedFields.includes("CollectionTitles")) row["CollectionTitles"] = JSON.stringify(rule.collections || []);
      if (selectedFields.includes("Collections")) row["Collections"] = rule.collectionSortKey || "[]";
      if (selectedFields.includes("ForCollections")) row["ForCollections"] = "True";
      if (selectedFields.includes("Id")) row["Id"] = rule.id;
      
      if (selectedFields.includes("Products")) {
        row["Products"] = JSON.stringify((rule.products || []).map(p => ({
          Id: extractNumericId(p.id),
          Title: p.title || "",
          ImageUrl: p.imageUrl || p.image || p.src || ""
        })));
      }
      
      if (selectedFields.includes("SearchQuery")) row["SearchQuery"] = (rule.searchQueries || [])[0] || "";
      if (selectedFields.includes("SiteId")) row["SiteId"] = rule.shop || "";
      
      return row;
    });


    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Export_CollectionPins.csv');
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
            {fields.map(field => {
              const isChecked = selectedFields.includes(field);
              
              return (
                <label key={field} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFields([...selectedFields, field]);
                      } else {
                        setSelectedFields(selectedFields.filter(f => f !== field));
                      }
                    }}
                    style={{ cursor: "pointer", accentColor: "#5B21B6" }}
                  />
                  <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "600" }}>{field}</span>
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
