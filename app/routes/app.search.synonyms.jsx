import {useCompletedSubmission} from '../hooks/useCompletedSubmission';
import AdminNoSearchResults from '../components/ui/AdminNoSearchResults';
import { useNavigate } from "react-router";
import { useLoaderData, useFetcher, useNavigation, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useCallback, useMemo, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { queueSynonymActivation, getSynonymActivationStatus } from "../services/synonymActivation.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const synonyms = await prisma.synonym.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  let activation;
  try { activation = await getSynonymActivationStatus(shop, synonyms); }
  catch { activation = {phase: 'unavailable'}; }
  return { synonyms, activation };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    let message = "Action completed successfully";
    
    if (intent === 'retryActivation') {
      try { await queueSynonymActivation(shop); }
      catch { return {saved: true, error: 'Synonyms are saved, but search activation could not be queued. Retry activation.', status: 503}; }
      return {success: true, message: 'Applying saved synonyms to search…'};
    }
    if (intent === "add" || intent === "update") {
      const word = formData.get("word")?.toString().trim().toLowerCase();
      const synonymsInput = formData.get("synonyms")?.toString();

      if (!word || !synonymsInput) {
        return { error: "Word and Synonyms are required", status: 400 };
      }

      if (intent === "update") {
        const id = formData.get("id");
        const newList = Array.from(new Set(synonymsInput.split(",").map((s) => s.trim()))).join(", ");
        await prisma.synonym.update({
          where: { id, shop },
          data: { word, synonyms: newList }
        });
        message = "Synonym updated successfully";
      } else {
        const existing = await prisma.synonym.findFirst({ where: { shop, word } });
        if (existing) {
          const currentList = existing.synonyms.split(",").map((s) => s.trim());
          const newList = synonymsInput.split(",").map((s) => s.trim());
          const combined = Array.from(new Set([...currentList, ...newList])).join(", ");
          
          await prisma.synonym.update({
            where: { id: existing.id },
            data: { synonyms: combined }
          });
        } else {
          await prisma.synonym.create({
            data: { shop, word, synonyms: synonymsInput }
          });
        }
        message = "Synonym added successfully";
      }

    } else if (intent === "delete") {
      const id = formData.get("id");
      await prisma.synonym.delete({ where: { id, shop } });
      message = "Synonym deleted successfully";
    } else if (intent === "toggleStatus") {
      const id = formData.get("id");
      const isActive = formData.get("isActive") === "true";
      await prisma.synonym.update({
        where: { id, shop },
        data: { isActive }
      });
      message = isActive ? "Synonym enabled" : "Synonym disabled";
    } else {
      return {error: 'Unknown synonym action', status: 400};
    }
    try { await queueSynonymActivation(shop); }
    catch (error) {
      console.error('CFP Synonym enqueue failed:', error.name);
      return {saved: true, error: 'Synonyms saved, but search activation could not be queued. Retry activation.', status: 503};
    }
    return { success: true, message: `${message}. Applying to search…` };
  } catch (error) {
    console.error("Synonym action error:", error);
    return { error: error.message, status: 500 };
  }
};

export default function SearchSynonyms() {
  const { synonyms, activation = {phase: 'idle'} } = useLoaderData();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const pollKey = useMemo(() => Math.random().toString(36).slice(2), [activation]);
  const polled = statusFetcher.data;
  const activationStatus = polled?.requestKey === pollKey && (activation.phase === 'unavailable' || (polled.revision === activation.revision && polled.jobId === activation.jobId))
    ? polled : activation;
  const navigate = useNavigate();
  const navigation = useNavigation(); // for global page loading state

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [word, setWord] = useState("");
  const [synonymsList, setSynonymsList] = useState("");
  
  // Delete Modal State
  const [synonymToDelete, setSynonymToDelete] = useState(null);
  
  // Table Search State
  const [searchQuery, setSearchQuery] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const isGlobalLoading = navigation.state !== "idle";

  useEffect(() => {
    if (!['applying', 'unavailable'].includes(activationStatus.phase) || statusFetcher.state !== 'idle' || isSubmitting) return;
    const timer = setTimeout(() => statusFetcher.load(`/app/synonym-status?check=${pollKey}`), 2000);
    return () => clearTimeout(timer);
  }, [activationStatus, statusFetcher.state, isSubmitting, pollKey]);

  useCompletedSubmission(fetcher.data, fetcher.state, () => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  });

  const handleOpenAddModal = () => {
    setEditingId(null);
    setWord("");
    setSynonymsList("");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (syn) => {
    setEditingId(syn.id);
    setWord(syn.word);
    setSynonymsList(syn.synonyms);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setWord("");
    setSynonymsList("");
    setEditingId(null);
  };

  const handleSave = useCallback(() => {
    if (!word || !synonymsList) return;
    
    if (editingId) {
      fetcher.submit(
        { intent: "update", id: editingId, word, synonyms: synonymsList },
        { method: "POST" }
      );
    } else {
      fetcher.submit(
        { intent: "add", word, synonyms: synonymsList },
        { method: "POST" }
      );
    }
    handleCloseModal();
  }, [word, synonymsList, editingId, fetcher]);

  const confirmDelete = useCallback(() => {
    if (synonymToDelete) {
      fetcher.submit(
        { intent: "delete", id: synonymToDelete.id },
        { method: "POST" }
      );
      setSynonymToDelete(null);
    }
  }, [synonymToDelete, fetcher]);

  // Filter synonyms for the table
  const filteredSynonyms = useMemo(() => {
    if (!searchQuery.trim()) return synonyms;
    const lowerQ = searchQuery.toLowerCase();
    return synonyms.filter(syn => 
      syn.word.toLowerCase().includes(lowerQ) || 
      syn.synonyms.toLowerCase().includes(lowerQ)
    );
  }, [synonyms, searchQuery]);

  return (
    <s-page heading="Search Synonyms" full-width="true">
      <ui-title-bar title="Search Synonyms">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>

      <style dangerouslySetInnerHTML={{ __html: `
        /* Premium Spinner Animation */
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loading-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: #fff;
          animation: spin 0.8s ease-in-out infinite;
        }
        /* Custom styling for Synonyms Page based on global premium theme */
        .filter-groups-container {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: hidden;
        }

        .table-toolbar {
          padding: 20px 24px !important;
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important;
        }

        /* Back link */
        .back-link {
          color: #5B21B6 !important;
          text-decoration: none !important;
          font-weight: 700 !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          padding: 8px 14px !important;
          border-radius: 8px !important;
          background: rgba(91, 33, 182, 0.04) !important;
          border: 1px solid rgba(91, 33, 182, 0.08) !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .back-link:hover {
          color: #ffffff !important;
          background: #5B21B6 !important;
          border-color: #5B21B6 !important;
          transform: translateX(-2px);
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }

        /* Create button styling */
        .btn-create-group {
          background-color: #5B21B6 !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 10px 20px !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          position: relative !important;
          overflow: hidden !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 4px 12px rgba(91, 33, 182, 0.15) !important;
        }
        .btn-create-group:disabled {
          background-color: #cbd5e1 !important;
          box-shadow: none !important;
          cursor: not-allowed !important;
        }
        .btn-create-group:not(:disabled):hover {
          background-color: #1E1B4B !important;
          transform: translateY(-1px);
          box-shadow: inset 0 1px 0px rgba(255, 255, 255, 0.2), 0 4px 12px rgba(30, 27, 75, 0.2) !important;
        }

        /* Search bar styling */
        .search-input-field {
          width: 100% !important;
          padding: 10px 12px 10px 40px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          background-color: #ffffff !important;
          font-size: 13.5px !important;
          color: #1E1B4B !important;
          font-weight: 500 !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-sizing: border-box !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .search-input-field:focus {
          background-color: #ffffff !important;
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1) !important;
        }

        /* Table styling - Luxury dark navy header theme */
        .groups-table {
          width: 100% !important;
          border-collapse: collapse !important;
          text-align: left !important;
        }
        .groups-table th {
          background: #1E1B4B !important; 
          border-bottom: 3px solid #5B21B6 !important; 
          padding: 18px 24px !important;
          font-weight: 700 !important;
          font-size: 12.5px !important;
          color: #ffffff !important; 
          text-transform: uppercase !important;
          letter-spacing: 0.8px !important;
        }
        .groups-table tr {
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          transition: background-color 0.2s ease !important;
        }
        .groups-table tr:hover {
          background-color: rgba(91, 33, 182, 0.02) !important;
        }
        .groups-table td {
          padding: 18px 24px !important;
          font-size: 14px !important;
        }

        /* Action icons inside rows */
        .row-action-btn {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          cursor: pointer !important;
          padding: 8px !important;
          border-radius: 8px !important;
          display: inline-flex !important;
          align-items: center !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 1px 3px rgba(30, 27, 75, 0.02) !important;
          margin-left: 8px;
        }
        .row-action-btn:hover:not(:disabled) {
          background-color: #fcfcff !important;
          border-color: rgba(30, 27, 75, 0.15) !important;
        }
        .row-action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed !important;
        }
        .row-action-btn svg {
          fill: #4b5563 !important;
          transition: all 0.2s ease !important;
        }
        .btn-edit-action:hover:not(:disabled) svg {
          fill: #5B21B6 !important;
          transform: scale(1.08);
        }
        .btn-delete-action:hover:not(:disabled) svg {
          fill: #DB3A5D !important;
          transform: scale(1.08);
        }

        /* Badges */
        .collection-tag-badge {
          padding: 5px 12px !important;
          border-radius: 8px !important;
          background-color: rgba(91, 33, 182, 0.05) !important;
          color: #5B21B6 !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          transition: all 0.2s ease !important;
          display: inline-block;
          margin-right: 6px;
          margin-bottom: 4px;
        }
        .collection-tag-badge:hover {
          background-color: rgba(91, 33, 182, 0.1) !important;
          border-color: rgba(91, 33, 182, 0.2) !important;
        }

        /* Modal specific styles */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(3px);
          animation: fadeIn 0.2s ease-out;
        }

        /* Toggle Switch */
        .toggle-switch-container {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .toggle-switch-container input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-switch-slider {
          position: absolute;
          cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: #cbd5e1;
          transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 24px;
        }
        .toggle-switch-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        input:checked + .toggle-switch-slider {
          background-color: #10B981;
        }
        input:checked + .toggle-switch-slider:before {
          transform: translateX(20px);
        }
        input:disabled + .toggle-switch-slider {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .modal-content {
          background: #fff;
          border-radius: 12px;
          width: 500px;
          max-width: 90%;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          transform: translateY(0);
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%);
        }
        .modal-body {
          padding: 24px;
        }
        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid rgba(30, 27, 75, 0.08);
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: #f8fafc;
        }
        .form-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid rgba(30, 27, 75, 0.12);
          border-radius: 8px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-input:focus {
          border-color: #5B21B6;
          box-shadow: 0 0 0 3px rgba(91, 33, 182, 0.1);
        }
        .form-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #1E1B4B;
          margin-bottom: 6px;
        }
        .btn-danger {
          background-color: #DB3A5D !important;
          color: #fff !important;
          border: none !important;
          border-radius: 8px !important;
          padding: 8px 16px !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          transition: background-color 0.2s !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
        }
        .btn-danger:hover {
          background-color: #be123c !important;
        }
      ` }} />

      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
        <a href="/app/search" onClick={(e) => { e.preventDefault(); navigate("/app/search"); }} className="back-link">
          <svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
          </svg>
          Back to Search
        </a>
      </div>

      {(activationStatus.phase !== 'idle' || fetcher.data?.saved) && <div role="status" aria-live="polite" style={{marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: '#f5f3ff', color: '#5B21B6'}}>
        {fetcher.data?.saved || activationStatus.phase === 'failed'
          ? 'Synonyms are saved, but search activation failed.'
          : activationStatus.phase === 'active' ? 'Synonyms are active in search.'
          : activationStatus.phase === 'unavailable' ? 'Search activation status is temporarily unavailable.'
          : 'Synonyms saved. Applying to search…'}
        {(fetcher.data?.saved || activationStatus.phase === 'failed') && <button type="button" disabled={isSubmitting} onClick={() => fetcher.submit({intent: 'retryActivation'}, {method: 'POST'})} style={{marginLeft: 12}}>Retry activation</button>}
      </div>}
      <div className="filter-groups-container">
        {/* Toolbar */}
        <div className="table-toolbar">
          <div style={{ position: "relative", width: "300px" }}>
            <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "none", stroke: "#5B21B6", strokeWidth: "2.5", position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="8.5" cy="8.5" r="5" />
              <path d="M12.5 12.5L16 16" />
            </svg>
            <input
              type="text"
              placeholder="Search synonyms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input-field"
            />
          </div>

          <button onClick={handleOpenAddModal} className="btn-create-group">
            Add New Synonym
            <span style={{ borderLeft: "1px solid rgba(255,255,255,0.3)", paddingLeft: "8px", display: "flex", alignItems: "center" }}>
              <svg viewBox="0 0 20 20" style={{ width: "14px", height: "14px", fill: "none", stroke: "currentColor", strokeWidth: "2.5" }}>
                <path d="M10 4v12m-6-6h12" />
              </svg>
            </span>
          </button>
        </div>

        {/* Table Area */}
        {filteredSynonyms.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#64748b" }}>
            {synonyms.length === 0 && !searchQuery.trim() ? (
              <>
                <svg style={{ width: "48px", height: "48px", fill: "none", stroke: "#cbd5e1", strokeWidth: "1.5", margin: "0 auto 16px" }} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p style={{ margin: 0, fontSize: "15px", fontWeight: "500", color: "#475569" }}>No synonyms created yet.</p>
                <p style={{ margin: "4px 0 0", fontSize: "13.5px" }}>Click "Add New Synonym" to create your first mapping.</p>
              </>
            ) : <AdminNoSearchResults query={searchQuery}>No synonyms match the selected filters.</AdminNoSearchResults>}
          </div>
        ) : (
          <table className="groups-table">
            <thead>
              <tr>
                <th style={{ width: "25%" }}>Target Word</th>
                <th style={{ width: "45%" }}>Synonyms</th>
                <th style={{ width: "15%", textAlign: "center" }}>Status</th>
                <th style={{ width: "15%", textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSynonyms.map((syn) => (
                <tr key={syn.id}>
                  <td style={{ fontWeight: "600", color: "#1E1B4B" }}>
                    {syn.word}
                  </td>
                  <td>
                    {syn.synonyms.split(",").map((s, idx) => (
                      <span key={idx} className="collection-tag-badge" style={{ opacity: syn.isActive ? 1 : 0.6 }}>
                        {s.trim()}
                      </span>
                    ))}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <label className="toggle-switch-container">
                      <input
                        type="checkbox"
                        checked={syn.isActive}
                        disabled={isSubmitting || isGlobalLoading}
                        onChange={(e) => {
                          fetcher.submit(
                            { intent: "toggleStatus", id: syn.id, isActive: e.target.checked },
                            { method: "POST" }
                          );
                        }}
                      />
                      <span className="toggle-switch-slider"></span>
                    </label>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className="row-action-btn btn-edit-action"
                      onClick={() => handleOpenEditModal(syn)}
                      disabled={isSubmitting || isGlobalLoading}
                      title="Edit Synonym"
                    >
                      <svg style={{ width: "16px", height: "16px" }} viewBox="0 0 20 20">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button
                      className="row-action-btn btn-delete-action"
                      onClick={() => setSynonymToDelete(syn)}
                      disabled={isSubmitting || isGlobalLoading}
                      title="Delete Synonym"
                    >
                      <svg style={{ width: "16px", height: "16px" }} viewBox="0 0 24 24">
                        <path d="M6 7H5v13a2 2 0 002 2h10a2 2 0 002-2V7H6zm10.618-3L15 2H9L7.382 4H3v2h18V4h-4.382zM9 18H7v-8h2v8zm4 0h-2v-8h2v8zm4 0h-2v-8h2v8z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal for Add / Edit */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E1B4B", margin: 0 }}>
                {editingId ? "Edit Synonym" : "Add New Synonym"}
              </h2>
              <button onClick={handleCloseModal} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                <svg style={{ width: "20px", height: "20px", stroke: "#64748b", strokeWidth: "2" }} viewBox="0 0 24 24" fill="none">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="modal-body">
              <div style={{ marginBottom: "16px" }}>
                <label className="form-label">Target Word</label>
                <input
                  type="text"
                  placeholder="e.g. dress"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  className="form-input"
                  disabled={editingId !== null || isSubmitting}
                />
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  The main word users might search for.
                </p>
              </div>
              
              <div>
                <label className="form-label">Synonyms (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. gown, frock"
                  value={synonymsList}
                  onChange={(e) => setSynonymsList(e.target.value)}
                  className="form-input"
                  disabled={isSubmitting}
                />
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Words that mean the exact same thing as the target word.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                onClick={handleCloseModal}
                disabled={isSubmitting}
                style={{ background: "#fff", border: "1px solid rgba(30,27,75,0.12)", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: "600", color: "#475569", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!word || !synonymsList || isSubmitting}
                className="btn-create-group"
                style={{ padding: "8px 16px", minWidth: "120px", borderRadius: "8px" }}
              >
                {isSubmitting ? <span className="loading-spinner"></span> : "Save Synonym"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {synonymToDelete && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setSynonymToDelete(null)}>
          <div className="modal-content" style={{ width: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E1B4B", margin: 0 }}>
                Delete Synonym
              </h2>
              <button onClick={() => !isSubmitting && setSynonymToDelete(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                <svg style={{ width: "20px", height: "20px", stroke: "#64748b", strokeWidth: "2" }} viewBox="0 0 24 24" fill="none">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: "#334155", fontSize: "14px", lineHeight: "1.5" }}>
                Are you sure you want to delete the synonym for <strong style={{color:"#1E1B4B"}}>"{synonymToDelete.word}"</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setSynonymToDelete(null)}
                disabled={isSubmitting}
                style={{ background: "#fff", border: "1px solid rgba(30,27,75,0.12)", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: "600", color: "#475569", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isSubmitting}
                className="btn-danger"
                style={{ minWidth: "100px", justifyContent: "center" }}
              >
                {isSubmitting ? <span className="loading-spinner"></span> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
