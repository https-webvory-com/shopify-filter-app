import React, { useRef, useState, useEffect } from "react";
import Papa from "papaparse";
import { Modal } from "./Modal";

export function ImportFilterItemsModal({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedFilters, setParsedFilters] = useState([]);
  const fileInputRef = useRef(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedFile(null);
      setParsedFilters([]);
    }
  }, [isOpen]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "text/csv" || file.name.endsWith(".csv")) {
        setSelectedFile(file);
      } else {
        if (window.shopify && window.shopify.toast) {
          window.shopify.toast.show("Please upload a CSV file", { isError: true });
        }
      }
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setSelectedFile(null);
    setParsedFilters([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const mapSoboosterToOurFormat = (row) => {
    // Our CSV headers: Identifier, Filter name, Display mode, Active, Ordinal, Label, etc.
    // Sobooster CSV headers: FacetName, Id, DisplayMode, Active, Ordinal, Label, etc.
    let filterType = "unknown";
    let filterKey = null;

    let facetName = row["Identifier"] || row.FacetName || "";
    if (facetName) {
      if (facetName.startsWith("option:")) {
        filterType = "option";
        filterKey = facetName.replace("option:", "");
      } else if (facetName === "tags") {
        filterType = "tag";
      } else if (facetName === "productType" || facetName === "product_type") {
        filterType = "product_type";
      } else if (facetName === "collections" || facetName === "collection") {
        filterType = "collection";
      } else {
        filterType = facetName;
      }
    }

    let displayMode = "list";
    let rawDisplayMode = (row["Display mode"] || row.DisplayMode || "").toString().toLowerCase();
    
    if (rawDisplayMode === "1" || rawDisplayMode === "box") displayMode = "box";
    else if (rawDisplayMode === "2" || rawDisplayMode === "range") displayMode = "range";
    else if (rawDisplayMode === "3" || rawDisplayMode === "swatch") displayMode = "swatch";
    else if (rawDisplayMode === "list" || rawDisplayMode === "0") displayMode = "list";

    let parsedLabel = row.Label || "Imported Filter";
    if (parsedLabel.startsWith("{") && parsedLabel.endsWith("}")) {
      try {
        const localized = JSON.parse(parsedLabel);
        parsedLabel = localized["en"] || Object.values(localized)[0] || parsedLabel;
      } catch (e) {
        // Ignore error and keep raw string if it fails
      }
    }

    let config = null;
    if (row.LabelPrefix) {
      config = { prefix: row.LabelPrefix };
    }

    return {
      id: row["Filter name"] || row.Id || null,
      filterType,
      filterKey,
      label: parsedLabel,
      displayMode,
      isEnabled: (row.Active || row.active)?.toString().trim().toUpperCase() !== "FALSE",
      order: parseInt(row.Ordinal, 10) || 0,
      config,
    };
  };

  const handleNext = () => {
    if (!selectedFile) return;

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        if (results.data && results.data.length > 0) {
          const mapped = results.data.map(mapSoboosterToOurFormat);
          setParsedFilters(mapped);
          setStep(2);
        } else {
          if (window.shopify && window.shopify.toast) {
            window.shopify.toast.show("No valid data found in CSV", { isError: true });
          }
        }
      },
      error: function (error) {
        if (window.shopify && window.shopify.toast) {
          window.shopify.toast.show("Failed to parse CSV", { isError: true });
        }
      }
    });
  };

  const handleImport = () => {
    if (onSubmit) {
      onSubmit(parsedFilters);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "16px"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "450px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0,0,0,0.1)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid #e1e3e5",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#1E1B4B" }}>
            Import filters
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: "none",
              border: "none",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6d7175"
            }}
          >
            <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "currentColor" }}>
              <path d="M11.414 10l4.293-4.293a.999.999 0 1 0-1.414-1.414L10 8.586 5.707 4.293a.999.999 0 1 0-1.414 1.414L8.586 10l-4.293 4.293a.999.999 0 1 0 1.414 1.414L10 11.414l4.293 4.293a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414L11.414 10z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "24px" }}>
          {step === 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
                Upload a CSV file containing your filter options.
              </p>
              
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? "#5B21B6" : "#c9cccf"}`,
                  borderRadius: "8px",
                  padding: "32px 16px",
                  textAlign: "center",
                  backgroundColor: isDragging ? "#f5f3ff" : "#f9fafb",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                
                {selectedFile ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <svg viewBox="0 0 20 20" style={{ width: "32px", height: "32px", fill: "#10B981" }}>
                      <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm4.707 6.707l-5 5a1 1 0 0 1-1.414 0l-2.5-2.5a1 1 0 1 1 1.414-1.414l1.793 1.793 4.293-4.293a1 1 0 0 1 1.414 1.414z" />
                    </svg>
                    <span style={{ fontSize: "14px", fontWeight: "600", color: "#202223" }}>
                      {selectedFile.name}
                    </span>
                    <button
                      onClick={handleRemoveFile}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#d82c0d",
                        fontSize: "13px",
                        cursor: "pointer",
                        textDecoration: "underline"
                      }}
                    >
                      Remove file
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                    <svg viewBox="0 0 20 20" style={{ width: "32px", height: "32px", fill: "#8c9196" }}>
                      <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 14a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-9a1 1 0 0 0-1 1v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V8a1 1 0 0 0-1-1z" />
                    </svg>
                    <span style={{ fontSize: "14px", color: "#6d7175" }}>
                      <strong>Click to upload</strong> or drag and drop<br />
                      CSV file only
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", background: "#f0fdf4", padding: "16px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                <svg viewBox="0 0 20 20" style={{ width: "24px", height: "24px", fill: "#16a34a", flexShrink: 0, marginTop: "2px" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div style={{ color: "#1E1B4B", fontSize: "14px" }}>
                  Successfully parsed <strong>{parsedFilters.length}</strong> {parsedFilters.length === 1 ? "filter" : "filters"} from your CSV.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #e1e3e5",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            background: "#f9fafb"
          }}
        >
          <button
            onClick={() => {
              setSelectedFile(null);
              onClose();
            }}
            disabled={isSubmitting}
            style={{
              padding: "8px 16px",
              background: "#fff",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              fontSize: "14px",
              color: "#202223",
              fontWeight: "500"
            }}
          >
            Cancel
          </button>
          
          {step === 1 ? (
            <button
              onClick={handleNext}
              disabled={!selectedFile || isSubmitting}
              style={{
                padding: "8px 16px",
                background: !selectedFile ? "#f1f2f4" : "#5B21B6",
                border: "1px solid transparent",
                borderRadius: "4px",
                cursor: !selectedFile || isSubmitting ? "not-allowed" : "pointer",
                fontSize: "14px",
                color: !selectedFile ? "#8c9196" : "#fff",
                fontWeight: "500"
              }}
            >
              Next
            </button>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                disabled={isSubmitting}
                style={{
                  padding: "8px 16px",
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  color: "#202223",
                  fontWeight: "500"
                }}
              >
                Prev
              </button>
              <button
                onClick={handleImport}
                disabled={isSubmitting}
                style={{
                  padding: "8px 16px",
                  background: "#5B21B6",
                  border: "1px solid transparent",
                  borderRadius: "4px",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  color: "#fff",
                  fontWeight: "500"
                }}
              >
                {isSubmitting ? "Importing..." : "Import"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
