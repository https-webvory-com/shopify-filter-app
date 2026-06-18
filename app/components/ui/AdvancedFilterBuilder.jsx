import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

const FIELD_OPTIONS = [
  { value: "label", label: "Label", type: "text" },
  { value: "isEnabled", label: "Active", type: "boolean" },
  { value: "displayMode", label: "Display mode", type: "text" },
];

const OPERATORS_TEXT = [
  { value: "contains", label: "contains" },
  { value: "doesNotContain", label: "does not contains" },
  { value: "equals", label: "equals" },
  { value: "doesNotEqual", label: "does not equal" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
];

const OPERATORS_BOOLEAN = [
  { value: "equals", label: "equals" },
  { value: "doesNotEqual", label: "does not equal" },
];

export function AdvancedFilterBuilder({
  isOpen,
  onClose,
  initialConditions = [],
  initialMatchType = "all",
  onApply,
}) {
  const [matchType, setMatchType] = useState(initialMatchType);
  const [conditions, setConditions] = useState(initialConditions);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setMatchType(initialMatchType);
      setConditions(initialConditions.length > 0 ? initialConditions : [{ id: Date.now(), field: "label", operator: "contains", value: "" }]);
    }
  }, [isOpen, initialConditions, initialMatchType]);

  const addCondition = () => {
    setConditions([
      ...conditions,
      { id: Date.now(), field: "label", operator: "contains", value: "" },
    ]);
  };

  const removeCondition = (id) => {
    setConditions(conditions.filter((c) => c.id !== id));
  };

  const updateCondition = (id, key, newValue) => {
    setConditions(
      conditions.map((c) => {
        if (c.id === id) {
          const updated = { ...c, [key]: newValue };
          // Reset operator/value if field type changes
          if (key === "field") {
            const fieldInfo = FIELD_OPTIONS.find((f) => f.value === newValue);
            if (fieldInfo.type === "boolean") {
              updated.operator = "equals";
              updated.value = true;
            } else {
              updated.operator = "contains";
              updated.value = "";
            }
          }
          return updated;
        }
        return c;
      })
    );
  };

  const handleClearAll = () => {
    setConditions([]);
  };

  const handleApply = () => {
    // Filter out empty text conditions
    const validConditions = conditions.filter(c => {
      const fieldInfo = FIELD_OPTIONS.find(f => f.value === c.field);
      if (fieldInfo?.type === "text" && !c.value.toString().trim()) return false;
      return true;
    });
    onApply(matchType, validConditions);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Filter"
      width="700px"
      padding="26px"
      footer={
        <>
          <button
            onClick={onClose}
            className="btn-reorder-cancel"
            style={{ minWidth: "100px" }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="btn-reorder-save"
            style={{ minWidth: "100px" }}
          >
            OK
          </button>
        </>
      }
    >
      <style dangerouslySetInnerHTML={{ __html: `
        .filter-builder-select {
          padding: 10px 14px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          background: #ffffff !important;
          color: #1E1B4B !important;
          font-weight: 600 !important;
          outline: none !important;
          cursor: pointer !important;
          font-size: 13.5px !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .filter-builder-select:focus {
          border-color: #3E3AB1 !important;
          box-shadow: 0 0 0 3px rgba(62, 58, 177, 0.1) !important;
        }
        .filter-builder-input {
          width: 100% !important;
          padding: 10px 16px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          background: #ffffff !important;
          color: #1E1B4B !important;
          font-size: 13.5px !important;
          outline: none !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.02) !important;
        }
        .filter-builder-input:focus {
          border-color: #3E3AB1 !important;
          box-shadow: 0 0 0 3px rgba(62, 58, 177, 0.1) !important;
        }
        .filter-builder-trash-btn {
          background: none !important;
          border: none !important;
          cursor: pointer !important;
          padding: 8px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 8px !important;
          color: #8c9196 !important;
          transition: all 0.2s ease !important;
        }
        .filter-builder-trash-btn:hover {
          background: rgba(219, 58, 93, 0.08) !important;
          color: #DB3A5D !important;
        }
        .filter-builder-add-btn {
          background: #3E3AB1 !important;
          border: none !important;
          color: #ffffff !important;
          font-weight: 700 !important;
          padding: 10px 24px !important;
          border-radius: 10px !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          width: 100% !important;
          max-width: 280px !important;
          box-shadow: 0 4px 12px rgba(62, 58, 177, 0.15) !important;
        }
        .filter-builder-add-btn:hover {
          background: #1E1B4B !important;
          box-shadow: 0 4px 12px rgba(30, 27, 75, 0.2) !important;
          transform: translateY(-1px) !important;
        }
        .filter-builder-clear-btn {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.12) !important;
          color: #4b5563 !important;
          font-weight: 600 !important;
          font-size: 13px !important;
          padding: 8px 18px !important;
          border-radius: 10px !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }
        .filter-builder-clear-btn:hover {
          border-color: #DB3A5D !important;
          color: #DB3A5D !important;
          background: rgba(219, 58, 93, 0.04) !important;
        }
        .filter-builder-match-select {
          padding: 6px 12px !important;
          border-radius: 8px !important;
          border: 1px solid rgba(62, 58, 177, 0.15) !important;
          background: rgba(62, 58, 177, 0.05) !important;
          color: #3E3AB1 !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          outline: none !important;
          font-size: 13.5px !important;
          transition: all 0.2s ease !important;
        }
        .filter-builder-match-select:focus {
          border-color: #3E3AB1 !important;
        }
      ` }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "8px 0" }}>
        
        {/* Header Options */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14.5px", color: "#1E1B4B", fontWeight: "600" }}>
            Show results matching 
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value)}
              className="filter-builder-match-select"
            >
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            of the following conditions
          </div>
          <button onClick={handleClearAll} className="filter-builder-clear-btn">
            CLEAR ALL
          </button>
        </div>

        {/* Condition Rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {conditions.map((condition) => {
            const fieldInfo = FIELD_OPTIONS.find((f) => f.value === condition.field) || FIELD_OPTIONS[0];
            const operators = fieldInfo.type === "boolean" ? OPERATORS_BOOLEAN : OPERATORS_TEXT;

            return (
              <div key={condition.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                
                {/* Field Select */}
                <select
                  value={condition.field}
                  onChange={(e) => updateCondition(condition.id, "field", e.target.value)}
                  className="filter-builder-select"
                  style={{ flex: 1 }}
                >
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>

                {/* Operator Select */}
                <select
                  value={condition.operator}
                  onChange={(e) => updateCondition(condition.id, "operator", e.target.value)}
                  className="filter-builder-select"
                  style={{ flex: 1 }}
                >
                  {operators.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* Value Input */}
                <div style={{ flex: 1.5, display: "flex", alignItems: "center", minWidth: 0 }}>
                  {fieldInfo.type === "boolean" ? (
                    <div style={{ paddingLeft: "12px" }}>
                      <label style={{ position: "relative", display: "inline-block", width: "40px", height: "22px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={condition.value === true}
                          onChange={(e) => updateCondition(condition.id, "value", e.target.checked)}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: "absolute",
                          inset: 0,
                          backgroundColor: condition.value ? "#10B981" : "#8c9196",
                          borderRadius: "34px",
                          transition: "0.2s",
                        }}>
                          <span style={{
                            position: "absolute",
                            height: "16px",
                            width: "16px",
                            left: condition.value ? "20px" : "4px",
                            bottom: "3px",
                            backgroundColor: "white",
                            transition: "0.2s",
                            borderRadius: "50%",
                          }} />
                        </span>
                      </label>
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Enter value"
                      value={condition.value}
                      onChange={(e) => updateCondition(condition.id, "value", e.target.value)}
                      className="filter-builder-input"
                    />
                  )}
                </div>

                {/* Delete Button */}
                <button
                  onClick={() => removeCondition(condition.id)}
                  className="filter-builder-trash-btn"
                  title="Remove condition"
                >
                  <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}>
                    <path d="M16 4h-3V3a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1H4a1 1 0 0 0 0 2h1v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6h1a1 1 0 1 0 0-2zM9 3h2v1H9V3zm5 14H6V6h8v11z" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Add Filter Button */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
          <button 
            onClick={addCondition} 
            className="filter-builder-add-btn"
          >
            <span>+</span> Add filter
          </button>
        </div>

      </div>
    </Modal>
  );
}
