import React, { useState } from "react";
import { Modal } from "./Modal";
import { Checkbox } from "./Checkbox";

export function ExportFilterGroupsModal({ isOpen, onClose, selectedGroups, allGroups }) {
  const [fields, setFields] = useState({
    identifier: true,
    itemName: true,
    siteIdentifier: true,
    active: true,
    collectionTitles: true,
    collections: true,
    forCollectionPages: true,
  });

  const handleToggleField = (field) => {
    setFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleExport = () => {
    // Generate CSV data based on selectedGroups and allGroups
    const groupsToExport = allGroups.filter((g) => selectedGroups.includes(g.id));

    if (groupsToExport.length === 0) {
      onClose();
      return;
    }

    // Build headers based on selected fields
    const headers = [];
    if (fields.identifier) headers.push("Identifier");
    if (fields.itemName) headers.push("Item name");
    if (fields.siteIdentifier) headers.push("Site identifier");
    if (fields.active) headers.push("Active");
    if (fields.collectionTitles) headers.push("Collection titles");
    if (fields.collections) headers.push("Collections");
    if (fields.forCollectionPages) headers.push("For collection pages");

    // Build rows
    const rows = groupsToExport.map((group) => {
      const row = [];

      const collectionTitles = group.collections
        .filter((c) => c.pageType === "collection" && c.collectionTitle !== "All Collections")
        .map((c) => c.collectionTitle);

      const collectionIds = group.collections
        .filter((c) => c.pageType === "collection" && c.collectionId !== "__all__")
        .map((c) => c.collectionId.split("/").pop());

      const forCollectionPages = group.collections.some((c) => c.pageType === "collection");

      if (fields.identifier) row.push(group.id);
      if (fields.itemName) row.push(group.name);
      if (fields.siteIdentifier) row.push(""); // Often blank or just shop name
      if (fields.active) row.push(group.status ? "True" : "False");
      
      if (fields.collectionTitles) {
        row.push(collectionTitles.length > 0 ? `["${collectionTitles.join('","')}"]` : "");
      }
      if (fields.collections) {
        row.push(collectionIds.length > 0 ? `[${collectionIds.join(",")}]` : "");
      }
      if (fields.forCollectionPages) row.push(forCollectionPages ? "TRUE" : "FALSE");

      return row;
    });

    // Escape CSV fields
    const escapeCsv = (str) => {
      if (str === undefined || str === null) return '""';
      const s = String(str);
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return `"${s}"`;
    };

    const csvContent = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    // Trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `filter_groups_export_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onClose();
  };

  const footer = (
    <>
      <button
        onClick={onClose}
        style={{
          padding: "8px 16px",
          borderRadius: "6px",
          border: "1px solid #c9cccf",
          background: "#fff",
          color: "#202223",
          fontSize: "14px",
          fontWeight: "500",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        onClick={handleExport}
        style={{
          padding: "8px 16px",
          borderRadius: "6px",
          border: "none",
          background: "#5B21B6",
          color: "#fff",
          fontSize: "14px",
          fontWeight: "500",
          cursor: "pointer",
        }}
      >
        Export
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export items"
      width="450px"
      footer={footer}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
        <p style={{ margin: "0 0 8px", fontSize: "14px", color: "#6d7175", fontWeight: "500" }}>
          Fields to export
        </p>
        {[
          { id: "identifier", label: "Identifier", mandatory: true },
          { id: "itemName", label: "Item name", mandatory: true },
          { id: "siteIdentifier", label: "Site identifier", mandatory: true },
          { id: "active", label: "Active", mandatory: false },
          { id: "collectionTitles", label: "Collection titles", mandatory: false },
          { id: "collections", label: "Collections", mandatory: false },
          { id: "forCollectionPages", label: "For collection pages", mandatory: false },
        ].map((f) => (
          <label
            key={f.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: f.mandatory ? "not-allowed" : "pointer",
              fontSize: "14px",
              color: "#202223",
              opacity: f.mandatory ? 0.6 : 1,
            }}
          >
            <Checkbox
              checked={fields[f.id]}
              onChange={() => {
                if (!f.mandatory) handleToggleField(f.id);
              }}
              style={{
                opacity: f.mandatory ? 0.6 : 1,
                cursor: f.mandatory ? "not-allowed" : "pointer",
              }}
            />
            {f.label}
          </label>
        ))}
      </div>

      <div>
        <p style={{ margin: "0 0 8px", fontSize: "14px", color: "#6d7175", fontWeight: "500" }}>
          Export format
        </p>
        <select
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid #c9cccf",
            background: "#fff",
            fontSize: "14px",
            color: "#202223",
            outline: "none",
          }}
        >
          <option>CSV</option>
        </select>
      </div>
    </Modal>
  );
}
