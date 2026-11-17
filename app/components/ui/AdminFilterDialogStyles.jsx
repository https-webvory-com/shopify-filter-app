// Shared appearance for the admin list-filter dialogs. Filtering stays with each page.
export default function AdminFilterDialogStyles() {
  return <style>{`
    .admin-filter-dialog {
      box-sizing: border-box !important;
      width: 700px !important;
      max-width: calc(100vw - 32px) !important;
      max-height: 90vh;
      overflow-y: auto !important;
      border-radius: 12px !important;
      background: #fff !important;
      color: #1E1B4B;
      font-size: 14px;
      line-height: 1.4;
    }
    .admin-filter-dialog h2 { color: #1E1B4B !important; font-size: 20px !important; font-weight: 600 !important; line-height: 24px; }
    .admin-filter-dialog select, .admin-filter-dialog input[type="text"] {
      box-sizing: border-box !important; min-width: 0; max-width: 100%; height: 36px;
      border: 1px solid rgba(30,27,75,.12) !important; border-radius: 10px !important;
      background: #fff !important; color: #1E1B4B !important; font-size: 13.5px !important;
    }
    .admin-filter-dialog select:focus, .admin-filter-dialog input[type="text"]:focus {
      border-color: #5B21B6 !important; box-shadow: 0 0 0 2px rgba(91,33,182,.1) !important;
    }
    .admin-filter-dialog .admin-filter-match-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .admin-filter-dialog .admin-filter-match-options { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px !important; color: #202223 !important; font-weight: 400 !important; }
    .admin-filter-dialog .admin-filter-row {
      display: grid !important; grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1.25fr) 32px;
      gap: 12px !important; align-items: center; padding-right: 8px;
    }
    .admin-filter-dialog .admin-filter-row > * { min-width: 0 !important; width: auto !important; }
    .admin-filter-dialog .admin-filter-row select, .admin-filter-dialog .admin-filter-row input[type="text"] { width: 100% !important; padding: 7px 12px !important; }
    .admin-filter-dialog .admin-filter-row > button { box-sizing: border-box !important; width: 32px !important; height: 32px; padding: 8px !important; flex-shrink: 0; }
    .admin-filter-dialog .admin-filter-add, .admin-filter-dialog .filter-builder-add-btn,
    .admin-filter-dialog .admin-filter-apply, .admin-filter-dialog .btn-reorder-save {
      background: #5B21B6 !important; color: #fff !important; border: 0 !important;
      border-radius: 10px !important; font-size: 13.5px !important; font-weight: 700 !important;
      height: 36px !important; padding: 7px 18px !important; box-sizing: border-box;
      box-shadow: 0 4px 12px rgba(91,33,182,.15) !important; transform: none !important;
    }
    .admin-filter-dialog .admin-filter-add, .admin-filter-dialog .filter-builder-add-btn { width: 280px !important; max-width: 100% !important; }
    .admin-filter-dialog .admin-filter-add-row { display: flex; justify-content: center; }
    .admin-filter-dialog .admin-filter-clear, .admin-filter-dialog .filter-builder-clear-btn {
      box-sizing: border-box; height: 32px; padding: 6px 16px !important; font-size: 13px !important;
      background: #fff !important; color: #4b5563 !important; border: 1px solid rgba(30,27,75,.12) !important; border-radius: 10px !important;
    }
    .admin-filter-dialog .admin-filter-add:hover, .admin-filter-dialog .filter-builder-add-btn:hover,
    .admin-filter-dialog .admin-filter-apply:hover, .admin-filter-dialog .btn-reorder-save:hover { background: #1E1B4B !important; }
    .admin-filter-dialog .admin-filter-cancel, .admin-filter-dialog .btn-reorder-cancel {
      background: #fff !important; color: #4b5563 !important; border: 1px solid rgba(30,27,75,.12) !important;
      height: 36px; box-sizing: border-box; padding: 7px 18px !important; font-size: 13.5px !important; font-weight: 600; border-radius: 10px !important;
    }
    .admin-filter-dialog .admin-filter-cancel, .admin-filter-dialog .admin-filter-apply,
    .admin-filter-dialog .btn-reorder-cancel, .admin-filter-dialog .btn-reorder-save { min-width: 100px !important; }
    .admin-filter-dialog .admin-filter-apply:disabled { background: #94a3b8 !important; box-shadow: none !important; }
    .admin-filter-dialog .filter-builder-match-select { color: #1E1B4B !important; }
    @media (max-width: 520px) {
      .admin-filter-dialog .admin-filter-row { grid-template-columns: minmax(0,1fr) 32px; }
      .admin-filter-dialog .admin-filter-row > :nth-child(-n+2) { grid-column: 1 / -1; }
    }
  `}</style>;
}
