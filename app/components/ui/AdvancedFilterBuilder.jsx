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
      footer={
        <>
          <Button variant="default" onClick={onClose} style={{ borderRadius: "20px", padding: "8px 24px", color: "#8c9196", border: "1px solid #e1e3e5" }}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={handleApply} style={{ borderRadius: "20px", padding: "8px 24px", background: "#51a2ff", border: "none" }}>
            OK
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "8px 0" }}>
        
        {/* Header Options */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#4a4c4e", fontWeight: "500" }}>
            Show results matching 
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: "16px",
                border: "none",
                background: "#f0f4f9",
                color: "#007bff",
                fontWeight: "600",
                cursor: "pointer",
                outline: "none"
              }}
            >
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            of the following conditions
          </div>
          <Button variant="default" onClick={handleClearAll} style={{ borderRadius: "20px", color: "#007bff", border: "1px solid #007bff", background: "transparent", fontSize: "13px", padding: "6px 16px" }}>
            CLEAR ALL
          </Button>
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
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "20px",
                    border: "none",
                    background: "#f0f4f9",
                    color: "#007bff",
                    fontWeight: "500",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none"
                  }}
                >
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>

                {/* Operator Select */}
                <select
                  value={condition.operator}
                  onChange={(e) => updateCondition(condition.id, "operator", e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "20px",
                    border: "none",
                    background: "#f0f4f9",
                    color: "#007bff",
                    fontWeight: "500",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none"
                  }}
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
                          backgroundColor: condition.value ? "#008060" : "#8c9196",
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
                      style={{
                        width: "100%",
                        padding: "8px 16px",
                        borderRadius: "20px",
                        border: "none",
                        background: "#f0f4f9",
                        color: "#202223",
                        outline: "none",
                        boxSizing: "border-box"
                      }}
                    />
                  )}
                </div>

                {/* Delete Button */}
                <IconButton
                  icon={
                    <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#51a2ff" }}>
                      <path d="M16 4h-3V3a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1H4a1 1 0 0 0 0 2h1v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6h1a1 1 0 1 0 0-2zM9 3h2v1H9V3zm5 14H6V6h8v11z" />
                    </svg>
                  }
                  onClick={() => removeCondition(condition.id)}
                  style={{ padding: "8px" }}
                />
              </div>
            );
          })}
        </div>

        {/* Add Filter Button */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
          <Button 
            variant="primary" 
            onClick={addCondition} 
            icon={<span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span>}
            style={{ borderRadius: "20px", padding: "8px 32px", background: "#007bff", width: "100%", maxWidth: "300px" }}
          >
            Add filter
          </Button>
        </div>

      </div>
    </Modal>
  );
}
