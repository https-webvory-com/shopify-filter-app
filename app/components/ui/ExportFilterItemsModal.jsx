import React, { useState } from "react";
import { Modal } from "./Modal";
import { Checkbox } from "./Checkbox";

const ALL_FIELDS = [
  { id: "Active", label: "Active", mandatory: false },
  { id: "CircleSwatch", label: "Circle swatch", mandatory: false },
  { id: "CollapseOnMobile", label: "Collapse on mobile", mandatory: false },
  { id: "CollapseOnPc", label: "Collapse on PC", mandatory: false },
  { id: "DisplayMode", label: "Display mode", mandatory: true },
  { id: "DisplayToolTip", label: "Display tooltip", mandatory: false },
  { id: "ExcludedValues", label: "Excluded values", mandatory: false },
  { id: "FacetName", label: "Identifier", mandatory: true },
  { id: "GroupId", label: "Filter group ID", mandatory: true },
  { id: "Id", label: "Filter name", mandatory: true },
  { id: "InStockLabel", label: "In-stock label", mandatory: false },
  { id: "InverseFormula", label: "Inverse formula", mandatory: false },
  { id: "Label", label: "Label", mandatory: true },
  { id: "LabelPrefix", label: "Label prefix", mandatory: false },
  { id: "ManualValues", label: "Manual values", mandatory: false },
  { id: "MaxHeight", label: "Max height", mandatory: false },
  { id: "MaxItems", label: "Max number of items", mandatory: false },
  { id: "Multiple", label: "Multiple", mandatory: false },
  { id: "Narrow", label: "Narrow filter", mandatory: false },
  { id: "NavigationCollections", label: "Navigation collections", mandatory: false },
  { id: "NavigationCollectionsChildType", label: "Navigation collections child type", mandatory: false },
  { id: "NavigationCollectionsKeepMain", label: "Keep main navigation collections", mandatory: false },
  { id: "NavigationCollectionsMenu", label: "Navigation collections menu", mandatory: false },
  { id: "Ordinal", label: "Ordinal", mandatory: true },
  { id: "OutOfStockLabel", label: "Out-of-stock label", mandatory: false },
  { id: "PreOrderLabel", label: "Pre-order label", mandatory: false },
  { id: "Range", label: "Ranges", mandatory: false },
  { id: "RangeFormat", label: "Range format", mandatory: false },
  { id: "RatingColor", label: "Rating color", mandatory: false },
  { id: "ShowInStock", label: "Show in-stock option", mandatory: false },
  { id: "ShowMoreType", label: "Show more type", mandatory: true },
  { id: "ShowOutOfStock", label: "Show out-of-stock option", mandatory: false },
  { id: "ShowPreOrder", label: "Show pre-order", mandatory: false },
  { id: "ShowSearchBoxOnMobile", label: "Show search box on mobile", mandatory: false },
  { id: "ShowSearchBoxOnPc", label: "Show search box on PC", mandatory: false },
  { id: "ShowSliderInputPrefixSuffix", label: "Show slider input prefix", mandatory: false },
  { id: "ShowStockOnHand", label: "Show stock on hand", mandatory: false },
  { id: "ShowSwatchLabel", label: "Show swatch label", mandatory: false },
  { id: "SliderColor", label: "Slider color", mandatory: false },
  { id: "SliderPrefix", label: "Slider prefix", mandatory: false },
  { id: "SliderSuffix", label: "Slider suffix", mandatory: false },
  { id: "SliderValueSymbols", label: "Slider value symbols", mandatory: false },
  { id: "SortManualValues", label: "Sort manual values", mandatory: false },
  { id: "SortType", label: "Sort type", mandatory: true },
  { id: "StockOnHandLabel", label: "Stock on hand label", mandatory: false },
  { id: "SwatchImages", label: "Swatch images", mandatory: false },
  { id: "SwatchLabelDisplay", label: "Swatch label display", mandatory: false },
  { id: "Tooltip", label: "Tooltip", mandatory: false },
  { id: "UseManualValues", label: "Use manual values", mandatory: false },
  { id: "ValueFormula", label: "Value formula", mandatory: false },
  { id: "ValuesTransformation", label: "Values transformation", mandatory: true },
];

export function ExportFilterItemsModal({ isOpen, onClose, filters, filterGroupId }) {
  const [fields, setFields] = useState(() => {
    const initial = {};
    ALL_FIELDS.forEach((f) => {
      initial[f.id] = true; // all checked by default
    });
    return initial;
  });

  const handleToggleField = (fieldId) => {
    setFields((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }));
  };

  const handleExport = () => {
    if (!filters || filters.length === 0) {
      onClose();
      return;
    }

    // Build headers based on selected fields
    const selectedFields = ALL_FIELDS.filter((f) => fields[f.id]);
    const headers = selectedFields.map((f) => f.id);

    // Build rows
    const rows = filters.map((filter, index) => {
      const row = [];

      selectedFields.forEach((field) => {
        let val = "";
        
        switch (field.id) {
          case "DisplayMode":
            // 0=list, 1=swatch, 2=range, etc. Map our displayMode string to integer if needed
            val = filter.displayMode === "list" ? "0" : filter.displayMode === "swatch" ? "1" : filter.displayMode === "range" ? "2" : "0";
            break;
          case "GroupId":
            val = filterGroupId;
            break;
          case "Id":
            val = filter.id;
            break;
          case "FacetName":
            if (filter.filterType === "option") val = `option:${filter.filterKey}`;
            else if (filter.filterType === "product_type") val = "productType";
            else if (filter.filterType === "collection") val = "collections";
            else val = filter.filterType;
            break;
          case "Label":
            val = filter.label;
            break;
          case "Ordinal":
            val = index;
            break;
          case "Active":
            val = filter.isEnabled ? "True" : "False";
            break;
          case "CollapseOnMobile":
            val = filter.config?.collapsed ? "True" : "False";
            break;
          case "ShowSearchBoxOnPc":
          case "ShowSearchBoxOnMobile":
            val = filter.config?.showSearch ? "True" : "False";
            break;
          case "MaxItems":
            val = filter.config?.limit || "";
            break;
          case "SortType":
            val = filter.config?.sortBy === "count" ? "1" : "0"; // Example mapping
            break;
          case "SortManualValues":
            val = "False";
            break;
          case "ShowMoreType":
            val = "0";
            break;
          case "ValuesTransformation":
            val = "";
            break;
          default:
            const booleanFields = [
              "CircleSwatch", "CollapseOnMobile", "CollapseOnPc", "DisplayToolTip",
              "Multiple", "Narrow", "NavigationCollectionsKeepMain",
              "ShowInStock", "ShowOutOfStock", "ShowPreOrder",
              "ShowSearchBoxOnMobile", "ShowSearchBoxOnPc",
              "ShowSliderInputPrefixSuffix", "ShowStockOnHand", "ShowSwatchLabel",
              "SortManualValues", "UseManualValues"
            ];
            if (booleanFields.includes(field.id)) {
              val = "False";
            }
            break;
        }

        row.push(val);
      });

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
    link.setAttribute("download", `filters_export_${new Date().getTime()}.csv`);
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
        OK
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
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
          <p style={{ margin: 0, fontSize: "14px", color: "#6d7175", fontWeight: "500" }}>
            Fields to export
          </p>
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "#e1e3e5",
              color: "#6d7175",
              fontSize: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "help",
            }}
          >
            ?
          </div>
        </div>
        
        {/* Scrollable container for the many fields */}
        <div style={{ maxHeight: "350px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "8px" }}>
          {ALL_FIELDS.map((f) => (
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
              <div
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: "#e1e3e5",
                  color: "#6d7175",
                  fontSize: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: "4px",
                }}
              >
                ?
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
          <p style={{ margin: 0, fontSize: "14px", color: "#6d7175", fontWeight: "500" }}>
            Export format
          </p>
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "#e1e3e5",
              color: "#6d7175",
              fontSize: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "help",
            }}
          >
            ?
          </div>
        </div>
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
          <option>Excel</option>
          <option>JSON</option>
        </select>
      </div>
    </Modal>
  );
}
