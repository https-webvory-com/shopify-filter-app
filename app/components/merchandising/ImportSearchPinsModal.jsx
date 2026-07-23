import React, { useRef, useState, useEffect } from "react";
import Papa from "papaparse";

export default function ImportSearchPinsModal({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedRules, setParsedRules] = useState([]);
  const fileInputRef = useRef(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedFile(null);
      setParsedRules([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file) => {
    setSelectedFile(file);
    if (window.shopify && window.shopify.toast) {
      window.shopify.toast.show("File selected: " + file.name);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setSelectedFile(null);
    setParsedRules([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const mapToOurFormat = (row) => {
    let products = [];
    try {
      if (row["Products"]) {
        const parsedProds = JSON.parse(row["Products"]);
        if (Array.isArray(parsedProds)) {
          products = parsedProds.map(p => {
            const pid = p.id || p.Id;
            const fullId = pid ? (String(pid).includes('gid://') ? String(pid) : `gid://shopify/Product/${pid}`) : undefined;
            return {
              ...p,
              id: fullId
            };
          });
        }
      }
    } catch (e) {}

    const searchQuery = row["SearchQuery"] || row.searchQuery || "";
    const searchQueries = searchQuery ? [searchQuery] : [];

    const isInstant = (row.AppliedToInstantSearch || "").toString().trim().toUpperCase() === "TRUE";
    const isSearch = (row.AppliedToSearch || "").toString().trim().toUpperCase() === "TRUE";
    
    let applyToSearchType = "both";
    if (isInstant && !isSearch) applyToSearchType = "instant";
    if (!isInstant && isSearch) applyToSearchType = "search";
    if (!isInstant && !isSearch) applyToSearchType = "none";

    return {
      name: searchQuery || "Imported Search Pin",
      status: (row.Status || row.Active || row.status || "True").toString().trim().toUpperCase() !== "FALSE",
      applyToAll: false,
      collections: [],
      products,
      ruleType: "search",
      applyToSearchType,
      searchQueries,
      rawRow: row
    };
  };

  const handleNext = () => {
    if (!selectedFile) return;

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        if (results.data && results.data.length > 0) {
          const fields = results.meta.fields || Object.keys(results.data[0] || {});
          const hasSearchQuery = fields.some(f => f.toLowerCase() === 'searchquery');
          
          if (!hasSearchQuery) {
            if (window.shopify && window.shopify.toast) {
              window.shopify.toast.show("Invalid CSV format: Missing 'SearchQuery' column", { isError: true });
            }
            return;
          }

          const mapped = results.data.map(mapToOurFormat);
          setParsedRules(mapped);
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
      onSubmit(parsedRules);
    }
  };

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
          padding: "32px",
          width: "550px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <svg
            viewBox="0 0 20 20"
            style={{ width: "20px", height: "20px", fill: "#5c5f62" }}
          >
            <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
          </svg>
        </button>

        <h2
          style={{
            margin: "0 0 24px",
            fontSize: "18px",
            fontWeight: 700,
            color: "#202223",
          }}
        >
          {step === 1 ? "Step 1 of 2: Select a source file" : "Step 2 of 2: Import Details"}
        </h2>

        {step === 1 ? (
          <>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${isDragging ? "#5B21B6" : "#c9cccf"}`,
                borderRadius: "8px",
                padding: selectedFile ? "40px 20px" : "50px 20px",
                textAlign: "center",
                backgroundColor: isDragging ? "rgba(91, 33, 182, 0.04)" : "#fff",
                transition: "all 0.2s ease",
                marginBottom: "24px",
                cursor: selectedFile ? "default" : "pointer",
              }}
              onClick={() => {
                if (!selectedFile && fileInputRef.current) {
                  fileInputRef.current.click();
                }
              }}
            >
              {selectedFile ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <svg viewBox="0 0 24 24" style={{ width: "40px", height: "40px", fill: "none", stroke: "#1E1B4B" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <div style={{ color: "#1E1B4B", fontSize: "16px", fontWeight: "600", wordBreak: "break-all" }}>
                    {selectedFile.name}
                  </div>
                  <div style={{ color: "#5c5f62", fontSize: "13px" }}>
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </div>
                  <button
                    onClick={handleRemoveFile}
                    style={{
                      marginTop: "8px",
                      background: "rgba(216, 44, 13, 0.08)",
                      color: "#d82c0d",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(216, 44, 13, 0.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(216, 44, 13, 0.08)")}
                  >
                    Remove file
                  </button>
                </div>
              ) : (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    style={{ width: "48px", height: "48px", fill: "none", margin: "0 auto 16px" }}
                  >
                    <path
                      d="M17.5 19H6.5C4.01472 19 2 16.9853 2 14.5C2 12.3025 3.56708 10.4687 5.61746 10.0784C6.39867 7.20235 9.00693 5.09998 12.0625 5.09998C15.2281 5.09998 17.9048 7.35928 18.5284 10.3752C20.4746 10.7416 22 12.4497 22 14.5C22 16.9853 19.9853 19 17.5 19Z"
                      stroke="#5c5f62"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 15V10M12 10L9.5 12.5M12 10L14.5 12.5"
                      stroke="#5c5f62"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div style={{ color: "#202223", fontSize: "14px", marginBottom: "16px" }}>
                    Drag and drop your files anywhere or
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{
                      background: "#fff",
                      color: "#005bd3",
                      border: "1px solid #005bd3",
                      borderRadius: "6px",
                      padding: "6px 16px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Upload a file
                  </button>
                </>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: "none" }}
                accept=".json,.csv"
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
                marginTop: "8px",
              }}
            >
              <button
                onClick={() => {
                  setSelectedFile(null);
                  onClose();
                }}
                style={{
                  padding: "8px 16px",
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "#202223",
                  fontWeight: "500"
                }}
              >
                Cancel
              </button>
              <button disabled style={{ padding: "8px 16px", background: "#f1f2f4", border: "1px solid transparent", borderRadius: "4px", cursor: "not-allowed", fontSize: "14px", color: "#8c9196", fontWeight: "500" }}>Prev</button>
              <button
                disabled={!selectedFile}
                onClick={handleNext}
                style={{
                  padding: "8px 16px",
                  background: !selectedFile ? "#f1f2f4" : "#5B21B6",
                  border: "1px solid transparent",
                  borderRadius: "4px",
                  cursor: !selectedFile ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  color: !selectedFile ? "#8c9196" : "#fff",
                  fontWeight: "500"
                }}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: "24px" }}>
              <div style={{ 
                background: "rgba(91, 33, 182, 0.04)", 
                border: "1px solid rgba(91, 33, 182, 0.1)",
                borderRadius: "8px", 
                padding: "16px",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "12px"
              }}>
                <svg viewBox="0 0 24 24" style={{ width: "24px", height: "24px", fill: "none", stroke: "#5B21B6", strokeWidth: "2" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div style={{ color: "#1E1B4B", fontSize: "14px" }}>
                  Successfully parsed <strong>{parsedRules.length}</strong> {parsedRules.length === 1 ? "pin" : "pins"} from your CSV.
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
                marginTop: "8px",
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
              <button onClick={() => setStep(1)} disabled={isSubmitting} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #c9cccf", borderRadius: "4px", cursor: isSubmitting ? "not-allowed" : "pointer", fontSize: "14px", color: "#202223", fontWeight: "500" }}>Prev</button>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
