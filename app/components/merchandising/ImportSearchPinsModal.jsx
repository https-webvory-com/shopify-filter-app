import React, { useRef, useState, useEffect } from "react";
import Papa from "papaparse";
import CsvImportReport from "./CsvImportReport";
import { csvRowMetadata, importSummary } from "../../utils/csvImportReport.js";
import { postPinImportBatch, unconfirmedPinRows } from "../../utils/pinImportBatch.js";
import { SampleCsvDownload } from "../ui/SampleCsvDownload";
import { searchPinScopeFromCsv } from "../../utils/searchPinCsv";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function tryParse(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

/**
 * Maps a raw CSV row to internal batch format.
 * Supports both the data1246.csv format and our own export format.
 */
function mapCsvRow(row) {
  return {
    externalId: row["Id"] || "",
    active: (row["Active"] || "True").toUpperCase().trim() !== "FALSE",
    collectionTitles: tryParse(row["CollectionTitles"], []),
    collectionIds: tryParse(row["Collections"], []),
    products: tryParse(row["Products"], []),
    ...searchPinScopeFromCsv(row),
  };
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value }) {
  return (
    <div style={{ width: "100%", height: "10px", background: "#ede9fe", borderRadius: "99px", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, value)}%`, background: "linear-gradient(90deg, #5B21B6, #7C3AED)", borderRadius: "99px", transition: "width 0.4s ease" }} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ImportSearchPinsModal({ isOpen, onClose, onImportComplete }) {
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [uploadState, setUploadState] = useState("idle");
  const [progress, setProgress] = useState({ processed: 0, total: 0, imported: 0, skipped: 0, errors: [] });

  const fileInputRef = useRef(null);
  const isUploadingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedFile(null);
      setParsedRows([]);
      setUploadState("idle");
      setProgress({ processed: 0, total: 0, imported: 0, skipped: 0, errors: [] });

      isUploadingRef.current = false;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelected = (file) => setSelectedFile(file);
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length > 0) { handleFileSelected(e.dataTransfer.files[0]); e.dataTransfer.clearData(); }
  };
  const handleFileChange = (e) => { if (e.target.files?.length > 0) handleFileSelected(e.target.files[0]); };
  const handleRemoveFile = (e) => {
    e.stopPropagation(); setSelectedFile(null); setParsedRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleNext = () => {
    if (!selectedFile) return;
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data?.length) { window.shopify?.toast?.show("No valid data found in CSV", { isError: true }); return; }
        const fields = results.meta.fields || [];
        const hasSearchQuery = fields.some((f) => ["searchquery", "searchqueries"].includes(f.toLowerCase()));
        if (!hasSearchQuery) { window.shopify?.toast?.show("Invalid CSV: Missing 'SearchQuery' column", { isError: true }); return; }
        setParsedRows(results.data.map((row, index) => ({ ...mapCsvRow(row), ...csvRowMetadata(row, index, "pinning", results.errors || []) })));
        setStep(2);
      },
      error: () => window.shopify?.toast?.show("Failed to parse CSV", { isError: true }),
    });
  };

  const handleStartImport = async () => {
    if (!parsedRows.length) return;
    setStep(3);
    setUploadState("uploading");
    isUploadingRef.current = true;

    const BATCH_SIZE = 50;
    const CONCURRENCY = 3;
    const batches = chunk(parsedRows, BATCH_SIZE);
    const total = parsedRows.length;
    setProgress({ processed: 0, total, imported: 0, skipped: 0, errors: [] });

    let totalImported = 0, totalSkipped = 0;
    let totalUnconfirmed = 0;
    const allWarnings = [];
    const allErrors = [];

    try {
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        if (!isUploadingRef.current) break;
        const group = batches.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(group.map(batch => postPinImportBatch(batch, "search")));
        let groupProcessed = 0;
        results.forEach((result, idx) => {
          groupProcessed += group[idx].length;
          if (result.status === "fulfilled") {
            totalImported += result.value.imported || 0;
            totalSkipped += result.value.skipped || 0;
            allErrors.push(...(result.value.errors || []));
            allWarnings.push(...(result.value.warnings || []));
          } else {
            totalUnconfirmed += group[idx].length;
            allErrors.push(...unconfirmedPinRows(group[idx], result.reason));
          }
        });
        setProgress((prev) => ({ processed: prev.processed + groupProcessed, total, imported: totalImported, skipped: totalSkipped, errors: [...allErrors], warnings: [...allWarnings], unconfirmed: totalUnconfirmed }));
      }
      window.shopify?.toast?.show(importSummary({ imported: totalImported, skipped: totalSkipped, unconfirmed: totalUnconfirmed, warnings: allWarnings }), { duration: 8000 });
      setUploadState("done");
      isUploadingRef.current = false;
      if (onImportComplete) onImportComplete();
    } catch (err) {
      setUploadState("error");
      isUploadingRef.current = false;
    }
  };

  const handleClose = () => {
    if (uploadState === "uploading") {
      window.shopify?.toast?.show("Import is in progress. Keep this window open until the report is ready.", { duration: 4000 });
      return;
    }
    onClose();
  };

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999 }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={{ background: "#fff", borderRadius: "12px", padding: "32px", width: "560px", maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", position: "relative" }}>

        <button onClick={handleClose} style={{ position: "absolute", top: "16px", right: "16px", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
            <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
          </svg>
        </button>

        <h2 style={{ margin: "0 0 24px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
          {step === 1 ? "Step 1 of 3: Select a source file" : step === 2 ? "Step 2 of 3: Preview" : "Step 3 of 3: Importing..."}
        </h2>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <>
            <SampleCsvDownload href="/samples/search-pins.csv">
              Examples show specific search queries and all searches. Replace the
              example product IDs with IDs from your store. Products and SearchQueries use JSON arrays.
            </SampleCsvDownload>
            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => { if (!selectedFile && fileInputRef.current) fileInputRef.current.click(); }}
              style={{ border: `2px dashed ${isDragging ? "#5B21B6" : "#c9cccf"}`, borderRadius: "8px", padding: selectedFile ? "40px 20px" : "50px 20px", textAlign: "center", backgroundColor: isDragging ? "rgba(91,33,182,0.04)" : "#fff", transition: "all 0.2s ease", marginBottom: "24px", cursor: selectedFile ? "default" : "pointer" }}>
              {selectedFile ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <svg viewBox="0 0 24 24" style={{ width: "40px", height: "40px", fill: "none", stroke: "#1E1B4B" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <div style={{ color: "#1E1B4B", fontSize: "16px", fontWeight: "600", wordBreak: "break-all" }}>{selectedFile.name}</div>
                  <div style={{ color: "#5c5f62", fontSize: "13px" }}>{(selectedFile.size / 1024).toFixed(2)} KB</div>
                  <button onClick={handleRemoveFile} style={{ marginTop: "8px", background: "rgba(216,44,13,0.08)", color: "#d82c0d", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(216,44,13,0.15)")} onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(216,44,13,0.08)")}>
                    Remove file
                  </button>
                </div>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" style={{ width: "48px", height: "48px", fill: "none", margin: "0 auto 16px" }}>
                    <path d="M17.5 19H6.5C4.01472 19 2 16.9853 2 14.5C2 12.3025 3.56708 10.4687 5.61746 10.0784C6.39867 7.20235 9.00693 5.09998 12.0625 5.09998C15.2281 5.09998 17.9048 7.35928 18.5284 10.3752C20.4746 10.7416 22 12.4497 22 14.5C22 16.9853 19.9853 19 17.5 19Z" stroke="#5c5f62" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 15V10M12 10L9.5 12.5M12 10L14.5 12.5" stroke="#5c5f62" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div style={{ color: "#202223", fontSize: "14px", marginBottom: "16px" }}>Drag and drop your CSV anywhere or</div>
                  <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} style={{ background: "#fff", color: "#005bd3", border: "1px solid #005bd3", borderRadius: "6px", padding: "6px 16px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>
                    Upload a file
                  </button>
                  <div style={{ color: "#6d7175", fontSize: "12px", marginTop: "12px" }}>Supports up to 1,500 rows · CSV format · SearchQuery column required</div>
                </>
              )}
              <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: "none" }} accept=".csv" />
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button onClick={() => { setSelectedFile(null); onClose(); }} style={btnSecondary}>Cancel</button>
              <button disabled style={btnDisabled}>Prev</button>
              <button disabled={!selectedFile} onClick={handleNext} style={!selectedFile ? btnDisabled : btnPrimary}>Next</button>
            </div>
          </>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <>
            <div style={{ background: "rgba(91,33,182,0.04)", border: "1px solid rgba(91,33,182,0.15)", borderRadius: "10px", padding: "20px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <svg viewBox="0 0 24 24" style={{ width: "24px", height: "24px", fill: "none", stroke: "#5B21B6", strokeWidth: "2", flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div style={{ color: "#1E1B4B", fontSize: "14px", fontWeight: "600" }}>
                  Ready to import <span style={{ color: "#5B21B6" }}>{parsedRows.length}</span> search pinning rules
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "8px" }}>Preview (first 5 rows):</div>
              <div style={{ overflowX: "auto", borderRadius: "6px", border: "1px solid #e4e5e7" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: "#f6f6f7" }}>
                      <th style={thStyle}>Rule ID</th>
                      <th style={thStyle}>Search Query</th>
                      <th style={thStyle}>Products</th>
                      <th style={thStyle}>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #e4e5e7" }}>
                        <td style={tdStyle}>{(row.externalId || "").substring(0, 12)}…</td>
                        <td style={tdStyle}>{row.searchQuery || "—"}</td>
                        <td style={tdStyle}>{(row.products || []).length} products</td>
                        <td style={tdStyle}><span style={{ color: row.active ? "#008060" : "#d82c0d", fontWeight: "600" }}>{row.active ? "Yes" : "No"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "8px" }}>+ {parsedRows.length - 5} more rows...</div>}
              <div style={{ marginTop: "12px", padding: "10px 12px", background: "rgba(0,128,96,0.06)", borderRadius: "6px", fontSize: "12px", color: "#008060" }}>
                💡 Re-uploading the same CSV will update existing rules (not create duplicates).
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button onClick={() => { setSelectedFile(null); onClose(); }} style={btnSecondary}>Cancel</button>
              <button onClick={() => setStep(1)} style={btnSecondary}>Prev</button>
              <button onClick={handleStartImport} style={btnPrimary}>Start Import</button>
            </div>
          </>
        )}

        {/* ── STEP 3: Progress ── */}
        {step === 3 && (
          <>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              {uploadState === "done" ? (
                <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "rgba(0,128,96,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <svg viewBox="0 0 24 24" style={{ width: "28px", height: "28px", fill: "none", stroke: "#008060", strokeWidth: "2.5" }}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
              ) : uploadState === "error" ? (
                <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "rgba(216,44,13,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <svg viewBox="0 0 24 24" style={{ width: "28px", height: "28px", fill: "none", stroke: "#d82c0d", strokeWidth: "2.5" }}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
              ) : (
                <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "rgba(91,33,182,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <svg viewBox="0 0 24 24" style={{ width: "28px", height: "28px", fill: "none", stroke: "#5B21B6", strokeWidth: "2" }}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </div>
              )}
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#202223" }}>
                {uploadState === "done" ? "Import Complete!" : uploadState === "error" ? "Import Failed" : "Importing search pins..."}
              </div>
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                {uploadState === "uploading" && "Please wait. You can close this modal — upload will continue."}
                {uploadState === "done" && `Successfully imported ${progress.imported} search pinning rules.`}
              </div>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <ProgressBar value={uploadState === "done" ? 100 : pct} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "13px", color: "#6d7175" }}>
                <span>Processed {progress.processed} / {progress.total} rows</span>
                <span style={{ fontWeight: "600", color: "#5B21B6" }}>{uploadState === "done" ? 100 : pct}%</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div style={{ padding: "14px", background: "rgba(0,128,96,0.06)", borderRadius: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "#008060" }}>{progress.imported}</div>
                <div style={{ fontSize: "12px", color: "#6d7175" }}>Imported</div>
              </div>
              <div style={{ padding: "14px", background: progress.skipped > 0 ? "rgba(216,44,13,0.06)" : "#f6f6f7", borderRadius: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: "700", color: progress.skipped > 0 ? "#d82c0d" : "#6d7175" }}>{progress.skipped}</div>
                <div style={{ fontSize: "12px", color: "#6d7175" }}>Skipped</div>
              </div>
            </div>
            <CsvImportReport report={progress} />

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              {uploadState === "done" || uploadState === "error" ? (
                <button onClick={onClose} style={btnPrimary}>Close</button>
              ) : (
                <button onClick={handleClose} style={btnSecondary}>Import in progress</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary = { padding: "8px 20px", background: "#5B21B6", border: "1px solid transparent", borderRadius: "4px", cursor: "pointer", fontSize: "14px", color: "#fff", fontWeight: "500" };
const btnSecondary = { padding: "8px 16px", background: "#fff", border: "1px solid #c9cccf", borderRadius: "4px", cursor: "pointer", fontSize: "14px", color: "#202223", fontWeight: "500" };
const btnDisabled = { padding: "8px 16px", background: "#f1f2f4", border: "1px solid transparent", borderRadius: "4px", cursor: "not-allowed", fontSize: "14px", color: "#8c9196", fontWeight: "500" };
const thStyle = { padding: "8px 10px", textAlign: "left", fontWeight: "600", color: "#6d7175", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" };
const tdStyle = { padding: "7px 10px", color: "#202223", verticalAlign: "middle", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
