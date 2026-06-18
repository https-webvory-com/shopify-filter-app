import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
const TooltipIcon = ({ text }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: "6px", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "14px", height: "14px", borderRadius: "50%", background: "#e2e8f0", color: "#64748b", fontSize: "10px", fontWeight: "bold" }}>?</div>
      {show && text && (
        <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#333e54", color: "#e2e8f0", padding: "12px 16px", borderRadius: "6px", fontSize: "13px", width: "max-content", maxWidth: "250px", zIndex: 100, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)", textAlign: "left", lineHeight: "1.5", whiteSpace: "normal", fontWeight: "normal", letterSpacing: "normal" }}>
          {text}
          <div style={{ position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%) rotate(45deg)", width: "8px", height: "8px", background: "#333e54" }}></div>
        </div>
      )}
    </div>
  );
};

export default function CreateSearchRuleModal({ 
  isOpen, onClose, ruleToEdit = null, shopifyCollections = [], shopifyVendors = [], shopifyOptions = {},
  shopifyLocations = [], shopifyProductTypes = [], shopifyTags = [], shopifyProducts = [], shopifySkus = [], shopifyBarcodes = []
}) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [ruleName, setRuleName] = useState("");
  const [customerTags, setCustomerTags] = useState("");
  const [customerTagInput, setCustomerTagInput] = useState("");
  const [locales, setLocales] = useState("");
  const [ruleRules, setRuleRules] = useState([{ action: "Boost", field: "", value: "", operator: "Operator", operand: "", dateValue: "" }]);
  const [isSearchQueriesDropdownOpen, setIsSearchQueriesDropdownOpen] = useState(false);
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchQueries, setSearchQueries] = useState([]);

  const [isDateRangeChecked, setIsDateRangeChecked] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [startDate, setStartDate] = useState("2026-05-25");
  const [endDate, setEndDate] = useState("2026-05-25");

  const [showRulesTooltip, setShowRulesTooltip] = useState(false);
  const [openActionDropdownIndex, setOpenActionDropdownIndex] = useState(null);
  const [openFieldDropdownIndex, setOpenFieldDropdownIndex] = useState(null);
  const [fieldSearch, setFieldSearch] = useState("");

  const [openOperatorDropdownIndex, setOpenOperatorDropdownIndex] = useState(null);
  const [openRuleDatePickerIndex, setOpenRuleDatePickerIndex] = useState(null);
  const [openVendorDropdownIndex, setOpenVendorDropdownIndex] = useState(null);
  const [dropdownSearch, setDropdownSearch] = useState("");

  const handleClose = () => {
    setRuleName("");
    setCustomerTags("");
    setCustomerTagInput("");
    setLocales("");
    setRuleRules([{ action: "Boost", field: "", value: "", operator: "Operator", operand: "", dateValue: "" }]);
    setIsSearchQueriesDropdownOpen(false);
    setSearchQueryInput("");
    setSearchQueries([]);
    setIsDateRangeChecked(false);
    setIsDatePickerOpen(false);
    setOpenActionDropdownIndex(null);
    setOpenFieldDropdownIndex(null);
    setFieldSearch("");
    setOpenOperatorDropdownIndex(null);
    setOpenRuleDatePickerIndex(null);
    setOpenVendorDropdownIndex(null);
    setDropdownSearch("");
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      if (ruleToEdit) {
        setRuleName(ruleToEdit.name || "");
        setCustomerTags(ruleToEdit.customerTags || "");
        setLocales(ruleToEdit.locales || "");
        setSearchQueries(ruleToEdit.searchQueries || []);
        if (ruleToEdit.startDate || ruleToEdit.endDate) {
          setIsDateRangeChecked(true);
          setStartDate(ruleToEdit.startDate ? new Date(ruleToEdit.startDate).toISOString().split('T')[0] : "2026-05-25");
          setEndDate(ruleToEdit.endDate ? new Date(ruleToEdit.endDate).toISOString().split('T')[0] : "2026-05-25");
        } else {
          setIsDateRangeChecked(false);
          setStartDate("2026-05-25");
          setEndDate("2026-05-25");
        }
        if (ruleToEdit.conditions && ruleToEdit.conditions.length > 0) {
          setRuleRules(ruleToEdit.conditions.map(c => {
            let parsedValue = c.value;
            try {
              if (typeof c.value === 'string' && (c.value.startsWith('[') || c.value.startsWith('{'))) {
                parsedValue = JSON.parse(c.value);
              }
            } catch (e) {}
            return {
              action: c.action || "Boost",
              field: c.field || "",
              value: parsedValue || "",
              operator: c.operator || "Operator",
              operand: c.operand || "",
              dateValue: c.dateValue || ""
            };
          }));
        } else {
          setRuleRules([{ action: "Boost", field: "", value: "", operator: "Operator", operand: "", dateValue: "" }]);
        }
      } else {
        setRuleName("");
        setCustomerTags("");
        setLocales("");
        setRuleRules([{ action: "Boost", field: "", value: "", operator: "Operator", operand: "", dateValue: "" }]);
        setIsSearchQueriesDropdownOpen(false);
        setSearchQueryInput("");
        setSearchQueries([]);
        setIsDateRangeChecked(false);
        setIsDatePickerOpen(false);
        setStartDate("2026-05-25");
        setEndDate("2026-05-25");
      }
    }
  }, [isOpen, ruleToEdit]);

  const handleCreate = () => {
    const payload = {
      actionType: ruleToEdit ? "editRule" : "createRule",
      name: ruleName,
      searchQueries: JSON.stringify(searchQueries),
      customerTags,
      locales,
      startDate: isDateRangeChecked ? startDate : null,
      endDate: isDateRangeChecked ? endDate : null,
      conditions: JSON.stringify(ruleRules)
    };
    if (ruleToEdit) payload.id = ruleToEdit.id;
    fetcher.submit(payload, { method: "POST", action: "/app/search/merchandising" });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && (fetcher.data?.intent === "create" || fetcher.data?.intent === "edit")) {
      handleClose();
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.dropdown-inside')) {
        setOpenActionDropdownIndex(null);
        setOpenFieldDropdownIndex(null);
        setOpenOperatorDropdownIndex(null);
        setOpenRuleDatePickerIndex(null);
        setOpenVendorDropdownIndex(null);
        setIsSearchQueriesDropdownOpen(false);
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const addRuleRule = () => {
    setRuleRules([...ruleRules, { action: "Boost", field: "", value: "", operator: "Operator", operand: "", dateValue: "" }]);
  };

  const removeRuleRule = (index) => {
    const newRules = [...ruleRules];
    newRules.splice(index, 1);
    setRuleRules(newRules);
  };

  const filteredCollections = shopifyCollections.filter(c => 
    c.title.toLowerCase().includes(searchQueryInput.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div onClick={handleClose} style={{ boxSizing: "border-box", position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <style>{`
        /* Custom scrollbar for modal card */
        .rule-modal-card::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
        }
        .rule-modal-card::-webkit-scrollbar-track {
          background: transparent !important;
          margin: 16px 0;
        }
        .rule-modal-card::-webkit-scrollbar-thumb {
          background: rgba(30, 27, 75, 0.15) !important;
          border-radius: 6px !important;
        }
        .rule-modal-card::-webkit-scrollbar-thumb:hover {
          background: rgba(30, 27, 75, 0.3) !important;
        }

        /* Focus styles */
        .rule-modal-card input:focus, 
        .rule-modal-card select:focus {
          border-color: #5B21B6 !important;
          box-shadow: 0 0 0 2px rgba(62, 58, 177, 0.1) !important;
        }
      `}</style>
      <div 
        onClick={(e) => e.stopPropagation()} 
        className="rule-modal-card"
        style={{ 
          boxSizing: "border-box", 
          background: "#fff", 
          width: "100%", 
          maxWidth: "900px", 
          maxHeight: "90vh", 
          overflowY: "auto", 
          overflowX: "hidden",
          borderRadius: "16px", 
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)", 
          display: "flex", 
          flexDirection: "column", 
          position: "relative" 
        }}
      >
        
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "32px 32px 16px 32px" }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#1E1B4B" }}>{ruleToEdit ? "Edit Rule" : "Create a New Rule"}</h2>
          <button 
            onClick={handleClose} 
            style={{ 
              background: "rgba(30, 27, 75, 0.05)", 
              border: "none", 
              cursor: "pointer", 
              color: "#94a3b8", 
              fontSize: "18px",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s"
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(30, 27, 75, 0.05)"}
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "0 32px 32px 32px", display: "flex", flexDirection: "column", gap: "20px", paddingBottom: "50px" }}>
          
          {/* Rule Name */}
          <div>
            <label style={{ display: "flex", alignItems: "center", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "6px" }}>
              Rule name <TooltipIcon text="Name of the merchandising rule." />
            </label>
            <input 
              type="text" 
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              style={{ boxSizing: "border-box", width: "100%", background: "#fff", border: "1px solid #c9cccf", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", color: "#202223", outline: "none", transition: "all 0.2s" }}
              onFocus={(e) => {
                e.target.style.borderColor = "#5B21B6";
                e.target.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#c9cccf";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Target Search Terms */}
          <div>
            <label style={{ display: "flex", alignItems: "center", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "6px" }}>
              Target Search Terms <TooltipIcon text="The search keywords for which this rule is applied. Leave blank to apply to all searches." />
            </label>
            <div 
              style={{ boxSizing: "border-box", width: "100%", background: "#fff", border: "1px solid #c9cccf", padding: "6px 10px", borderRadius: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", transition: "all 0.2s" }}
              tabIndex={-1}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#5B21B6";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#c9cccf";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {searchQueries.map(tag => (
                <div key={tag} style={{ display: "flex", alignItems: "center", background: "rgba(62, 58, 177, 0.08)", color: "#5B21B6", padding: "4px 8px", borderRadius: "16px", fontSize: "13px", fontWeight: "600", border: "1px solid rgba(62, 58, 177, 0.1)" }}>
                  {tag}
                  <div 
                    onClick={() => setSearchQueries(searchQueries.filter(t => t !== tag))}
                    style={{ marginLeft: "6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5B21B6" }}
                  >
                    <svg style={{ width: "12px", height: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </div>
                </div>
              ))}
              <div style={{ position: "relative", flex: 1, minWidth: "150px" }} className="dropdown-inside">
                <input 
                  type="text" 
                  placeholder={searchQueries.length > 0 ? "" : "Enter search terms e.g. shoes, sneakers"}
                  value={searchQueryInput}
                  onChange={(e) => setSearchQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQueryInput.trim()) {
                      e.preventDefault();
                      if (!searchQueries.includes(searchQueryInput.trim())) {
                        setSearchQueries([...searchQueries, searchQueryInput.trim()]);
                      }
                      setSearchQueryInput("");
                    }
                  }}
                  style={{ width: "100%", border: "none", outline: "none", fontSize: "14px", color: "#202223", background: "transparent", padding: "4px 0" }}
                />
                {searchQueryInput.trim() && (
                  <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "8px", background: "#fff", border: "1px solid rgba(30, 27, 75, 0.08)", borderRadius: "10px", boxShadow: "0 10px 15px -3px rgba(30, 27, 75, 0.1)", zIndex: 10, minWidth: "200px" }}>
                    <div 
                      onClick={() => {
                        if (!searchQueries.includes(searchQueryInput.trim())) {
                          setSearchQueries([...searchQueries, searchQueryInput.trim()]);
                        }
                        setSearchQueryInput("");
                      }}
                      style={{ padding: "10px 16px", cursor: "pointer", fontSize: "14px", color: "#5B21B6", display: "flex", alignItems: "center", gap: "8px" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <svg style={{ width: "14px", height: "14px", color: "#5B21B6" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                      Add <strong>{searchQueryInput}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Customer tags */}
          <div>
            <label style={{ display: "flex", alignItems: "center", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "6px" }}>
              Customer tags <TooltipIcon text="The customer tags to which this rule is applied. Leave blank to apply to all customers, or enter [no tag] to apply to customers without tags." />
            </label>
            <div 
              style={{ boxSizing: "border-box", width: "100%", background: "#fff", border: "1px solid #c9cccf", padding: "6px 10px", borderRadius: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", transition: "all 0.2s" }}
              tabIndex={-1}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#5B21B6";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#c9cccf";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {customerTags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <div key={tag} style={{ display: "flex", alignItems: "center", background: "rgba(62, 58, 177, 0.08)", color: "#5B21B6", padding: "4px 8px", borderRadius: "16px", fontSize: "13px", fontWeight: "600", border: "1px solid rgba(62, 58, 177, 0.1)" }}>
                  {tag}
                  <div 
                    onClick={() => {
                      const tags = customerTags.split(',').map(t => t.trim()).filter(Boolean);
                      setCustomerTags(tags.filter(t => t !== tag).join(','));
                    }}
                    style={{ marginLeft: "6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5B21B6" }}
                  >
                    <svg style={{ width: "12px", height: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </div>
                </div>
              ))}
              <div style={{ position: "relative", flex: 1, minWidth: "150px" }} className="dropdown-inside">
                <input 
                  type="text" 
                  placeholder={customerTags ? "" : "Enter customer tags, or leave blank to apply to all customers"}
                  value={customerTagInput}
                  onChange={(e) => setCustomerTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customerTagInput.trim()) {
                      e.preventDefault();
                      const tags = customerTags.split(',').map(t => t.trim()).filter(Boolean);
                      if (!tags.includes(customerTagInput.trim())) {
                        setCustomerTags([...tags, customerTagInput.trim()].join(','));
                      }
                      setCustomerTagInput("");
                    }
                  }}
                  style={{ width: "100%", border: "none", outline: "none", fontSize: "14px", color: "#202223", background: "transparent", padding: "4px 0" }}
                />
                {customerTagInput.trim() && (
                  <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "8px", background: "#fff", border: "1px solid rgba(30, 27, 75, 0.08)", borderRadius: "10px", boxShadow: "0 10px 15px -3px rgba(30, 27, 75, 0.1)", zIndex: 10, minWidth: "200px" }}>
                    <div 
                      onClick={() => {
                        const tags = customerTags.split(',').map(t => t.trim()).filter(Boolean);
                        if (!tags.includes(customerTagInput.trim())) {
                          setCustomerTags([...tags, customerTagInput.trim()].join(','));
                        }
                        setCustomerTagInput("");
                      }}
                      style={{ padding: "10px 16px", cursor: "pointer", fontSize: "14px", color: "#5B21B6", display: "flex", alignItems: "center", gap: "8px" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <svg style={{ width: "14px", height: "14px", color: "#5B21B6" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                      Add <strong>{customerTagInput}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Apply to locales */}
          <div>
            <label style={{ display: "flex", alignItems: "center", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "6px" }}>
              Apply to locales <TooltipIcon text="The locales to which this rule is applied. Leave blank to apply to all locales." />
            </label>
            <div style={{ position: "relative" }}>
              <input 
                type="text" 
                placeholder="Enter locales, or leave blank to apply to all locales" 
                value={locales}
                onChange={(e) => setLocales(e.target.value)}
                style={{ boxSizing: "border-box", width: "100%", background: "#fff", border: "1px solid #c9cccf", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", color: "#202223", outline: "none", transition: "all 0.2s" }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#5B21B6";
                  e.target.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#c9cccf";
                  e.target.style.boxShadow = "none";
                }}
              />
              <svg style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", width: "16px", height: "16px", color: "#8c9196", pointerEvents: "none" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
          </div>

          {/* Date range */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: "8px" }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <input 
                    type="checkbox" 
                    checked={isDateRangeChecked}
                    onChange={(e) => setIsDateRangeChecked(e.target.checked)}
                    style={{ appearance: "none", width: "16px", height: "16px", borderRadius: "4px", background: isDateRangeChecked ? "#5B21B6" : "#fff", border: isDateRangeChecked ? "none" : "1px solid #cbd5e1", cursor: "pointer", margin: 0 }} 
                  />
                  {isDateRangeChecked && (
                    <svg style={{ position: "absolute", width: "10px", height: "10px", color: "#fff", pointerEvents: "none" }} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "600" }}>Date range</span>
                <TooltipIcon text="Apply this Merchandising rule within a certain time-period." />
              </label>
            </div>

            {isDateRangeChecked && (
              <div style={{ position: "relative", marginTop: "8px" }} className="dropdown-inside">
                <div 
                  onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                  style={{ width: "100%", background: "#f8fafc", color: "#334155", border: "1px solid rgba(30, 27, 75, 0.08)", padding: "12px 16px", borderRadius: "10px", fontSize: "14px", display: "flex", alignItems: "center", cursor: "pointer" }}
                >
                  <svg style={{ width: "16px", height: "16px", color: "#5B21B6", marginRight: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  {startDate} - {endDate}
                </div>

                {/* Date Picker Popover */}
                {isDatePickerOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)", padding: "24px", zIndex: 20, width: "600px", border: "1px solid #e2e8f0" }}>
                    
                    <div style={{ display: "flex", gap: "32px", justifyContent: "space-between" }}>
                      
                      {/* Left Calendar (Start Date) */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", gap: "4px" }}>
                          Start date <TooltipIcon />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                          <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                          <div style={{ fontSize: "16px", fontWeight: "600", color: "#1e293b" }}>May 2026</div>
                          <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
                        </div>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "10px", color: "#64748b", fontWeight: "600", marginBottom: "8px" }}>
                          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                        </div>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "14px", color: "#334155" }}>
                          <div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}>1</div><div style={{ padding: "6px" }}>2</div>
                          <div style={{ padding: "6px" }}>3</div><div style={{ padding: "6px" }}>4</div><div style={{ padding: "6px" }}>5</div><div style={{ padding: "6px" }}>6</div><div style={{ padding: "6px" }}>7</div><div style={{ padding: "6px" }}>8</div><div style={{ padding: "6px" }}>9</div>
                          <div style={{ padding: "6px" }}>10</div><div style={{ padding: "6px" }}>11</div><div style={{ padding: "6px" }}>12</div><div style={{ padding: "6px" }}>13</div><div style={{ padding: "6px" }}>14</div><div style={{ padding: "6px" }}>15</div><div style={{ padding: "6px" }}>16</div>
                          <div style={{ padding: "6px" }}>17</div><div style={{ padding: "6px" }}>18</div><div style={{ padding: "6px" }}>19</div><div style={{ padding: "6px" }}>20</div><div style={{ padding: "6px" }}>21</div><div style={{ padding: "6px" }}>22</div><div style={{ padding: "6px" }}>23</div>
                          <div style={{ padding: "6px" }}>24</div>
                          <div style={{ padding: "6px", background: "#5B21B6", color: "#fff", borderRadius: "50%", cursor: "pointer", fontWeight: "600" }}>25</div>
                          <div style={{ padding: "6px", color: "#94a3b8" }}>26</div><div style={{ padding: "6px", color: "#94a3b8" }}>27</div><div style={{ padding: "6px", color: "#94a3b8" }}>28</div><div style={{ padding: "6px", color: "#94a3b8" }}>29</div><div style={{ padding: "6px", color: "#94a3b8" }}>30</div>
                          <div style={{ padding: "6px", color: "#94a3b8" }}>31</div>
                        </div>
                      </div>

                      {/* Right Calendar (End Date) */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", gap: "4px" }}>
                          End date <TooltipIcon />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                          <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                          <div style={{ fontSize: "16px", fontWeight: "600", color: "#1e293b" }}>May 2026</div>
                          <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
                        </div>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "10px", color: "#64748b", fontWeight: "600", marginBottom: "8px" }}>
                          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                        </div>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "14px", color: "#334155" }}>
                          <div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}>1</div><div style={{ padding: "6px" }}>2</div>
                          <div style={{ padding: "6px" }}>3</div><div style={{ padding: "6px" }}>4</div><div style={{ padding: "6px" }}>5</div><div style={{ padding: "6px" }}>6</div><div style={{ padding: "6px" }}>7</div><div style={{ padding: "6px" }}>8</div><div style={{ padding: "6px" }}>9</div>
                          <div style={{ padding: "6px" }}>10</div><div style={{ padding: "6px" }}>11</div><div style={{ padding: "6px" }}>12</div><div style={{ padding: "6px" }}>13</div><div style={{ padding: "6px" }}>14</div><div style={{ padding: "6px" }}>15</div><div style={{ padding: "6px" }}>16</div>
                          <div style={{ padding: "6px" }}>17</div><div style={{ padding: "6px" }}>18</div><div style={{ padding: "6px" }}>19</div><div style={{ padding: "6px" }}>20</div><div style={{ padding: "6px" }}>21</div><div style={{ padding: "6px" }}>22</div><div style={{ padding: "6px" }}>23</div>
                          <div style={{ padding: "6px" }}>24</div>
                          <div style={{ padding: "6px", background: "#5B21B6", color: "#fff", borderRadius: "50%", cursor: "pointer", fontWeight: "600" }}>25</div>
                          <div style={{ padding: "6px", fontWeight: "600" }}>26</div><div style={{ padding: "6px", fontWeight: "600" }}>27</div><div style={{ padding: "6px", fontWeight: "600" }}>28</div><div style={{ padding: "6px", fontWeight: "600" }}>29</div><div style={{ padding: "6px", fontWeight: "600" }}>30</div>
                          <div style={{ padding: "6px", fontWeight: "600" }}>31</div>
                        </div>
                      </div>

                    </div>

                    {/* Footer values and buttons */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "24px" }}>
                      <div style={{ display: "flex", gap: "100px", paddingLeft: "16px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#1E1B4B" }}>{startDate}</div>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#1E1B4B" }}>{endDate}</div>
                      </div>
                      <div style={{ display: "flex", gap: "12px" }}>
                        <button 
                          onClick={() => setIsDatePickerOpen(false)}
                          style={{ background: "#fff", color: "#5B21B6", border: "1px solid #5B21B6", padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => setIsDatePickerOpen(false)}
                          style={{ background: "#5B21B6", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
                        >
                          Select
                        </button>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rules section */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ position: "relative", display: "inline-block" }}>
                <label 
                  style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#64748b", marginBottom: "0" }}
                  onMouseEnter={() => setShowRulesTooltip(true)}
                  onMouseLeave={() => setShowRulesTooltip(false)}
                >
                  Rules <TooltipIcon />
                </label>
              
              {/* Rules Tooltip */}
              {showRulesTooltip && (
                <div style={{ position: "absolute", top: "100%", left: 0, background: "#1E1B4B", color: "#fff", padding: "16px", borderRadius: "8px", fontSize: "12px", width: "350px", zIndex: 5, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)" }}>
                  <div style={{ marginBottom: "12px" }}>The merchandising rules.</div>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <div><strong style={{ color: "#fff" }}>Boost:</strong> Boost the matching products.</div>
                    <div><strong style={{ color: "#fff" }}>Bury:</strong> Bury the matching products.</div>
                    <div><strong style={{ color: "#fff" }}>Pin:</strong> Pin the matching products.</div>
                    <div><strong style={{ color: "#fff" }}>Exclude:</strong> Exclude the matching products.</div>
                    <div><strong style={{ color: "#fff" }}>Include:</strong> Include the matching products even if they are not in the selected collection.</div>
                  </div>
                  <div style={{ marginTop: "12px" }}>
                    <strong style={{ color: "#fff" }}>Dynamic:</strong> Use this advanced rule to set the score for the matching products.
                  </div>
                  {/* Tooltip arrow */}
                  <div style={{ position: "absolute", top: "-6px", left: "20px", width: "12px", height: "12px", background: "#1E1B4B", transform: "rotate(45deg)" }}></div>
                </div>
              )}
            </div>
            
            <button 
                onClick={addRuleRule}
                style={{ background: "#5B21B6", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#1e1b4b"}
                onMouseLeave={e => e.currentTarget.style.background = "#5B21B6"}
              >
                <svg style={{ width: "14px", height: "14px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                Add rule
            </button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {ruleRules.map((r, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    
                    {/* Action Custom Dropdown */}
                    <div style={{ position: "relative", width: "120px" }} className="dropdown-inside">
                      <div 
                        onClick={() => setOpenActionDropdownIndex(openActionDropdownIndex === i ? null : i)}
                        style={{ boxSizing: "border-box", width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: "#202223", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "#5B21B6"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = openActionDropdownIndex === i ? "#5B21B6" : "#c9cccf"}
                      >
                        <span>{r.action}</span>
                        <svg style={{ width: "16px", height: "16px", color: "#8c9196" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </div>
                      {openActionDropdownIndex === i && (
                        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "8px", background: "#fff", borderRadius: "10px", boxShadow: "0 10px 25px -5px rgba(30, 27, 75, 0.15)", border: "1px solid rgba(30, 27, 75, 0.08)", zIndex: 30, width: "100%", overflow: "hidden" }}>
                          {["Boost", "Bury", "Pin", "Include", "Exclude", "Dynamic"].map(opt => (
                            <div 
                              key={opt}
                              onClick={() => {
                                  const newRules = [...ruleRules];
                                  newRules[i].action = opt;
                                  setRuleRules(newRules);
                                  setOpenActionDropdownIndex(null);
                              }}
                              style={{ padding: "10px 16px", fontSize: "14px", color: r.action === opt ? "#5B21B6" : "#1E1B4B", fontWeight: r.action === opt ? "600" : "400", cursor: "pointer", background: r.action === opt ? "rgba(62, 58, 177, 0.04)" : "transparent" }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                              onMouseLeave={e => {
                                if (r.action !== opt) e.currentTarget.style.background = "transparent";
                              }}
                            >
                              {opt}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Field Custom Dropdown */}
                    <div style={{ position: "relative", flex: 1, minWidth: "150px" }} className="dropdown-inside">
                      <div 
                        onClick={() => {
                          if (openFieldDropdownIndex === i) {
                            setOpenFieldDropdownIndex(null);
                          } else {
                            setOpenFieldDropdownIndex(i);
                            setFieldSearch("");
                          }
                        }}
                        style={{ boxSizing: "border-box", width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: r.field ? "#202223" : "#8c9196", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "#5B21B6"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = openFieldDropdownIndex === i ? "#5B21B6" : "#c9cccf"}
                      >
                        <span>{r.field || "Select a field"}</span>
                        <svg style={{ width: "16px", height: "16px", color: "#8c9196", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </div>
                      {openFieldDropdownIndex === i && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", border: "1px solid rgba(30, 27, 75, 0.08)", borderRadius: "10px", boxShadow: "0 10px 25px -5px rgba(30, 27, 75, 0.15)", zIndex: 51 }}>
                          <div style={{ padding: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid rgba(30, 27, 75, 0.08)" }}>
                              <svg style={{ width: "16px", height: "16px", color: "#5B21B6", marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                              <input 
                                type="text" 
                                placeholder="Filter" 
                                value={fieldSearch}
                                onChange={e => setFieldSearch(e.target.value)}
                                style={{ border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#1E1B4B", width: "100%" }}
                                onClick={e => e.stopPropagation()}
                              />
                            </div>
                          </div>
                          <div style={{ maxHeight: "250px", overflowY: "auto", paddingBottom: "12px" }}>
                            {[
                            "Date", "Price", "Discount", "Percent sales", "Vendor", "Collections",
                            "Color (product option)", "Size (product option)", "slot (product option)",
                            "Available", "Product type", "Tags", "Product", "SKU", "Barcode", "Locations", "Rating"
                            ].filter(f => f.toLowerCase().includes(fieldSearch.toLowerCase())).map(field => (
                              <div 
                                key={field}
                                onClick={() => {
                                  const newRules = [...ruleRules];
                                  newRules[i].field = field;
                                  setRuleRules(newRules);
                                  setOpenFieldDropdownIndex(null);
                                }}
                                style={{ padding: "10px 16px", cursor: "pointer", fontSize: "14px", color: r.field === field ? "#5B21B6" : "#1E1B4B", fontWeight: r.field === field ? "600" : "400", background: r.field === field ? "rgba(62, 58, 177, 0.04)" : "transparent" }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                                onMouseLeave={e => {
                                  if (r.field !== field) e.currentTarget.style.background = "transparent";
                                }}
                              >
                                {field}
                              </div>
                            ))}
                      </div>
                        </div>
                      )}
                    </div>

                    {/* Values Input (Column 3) */}
                    <div style={{ flex: 1, position: "relative" }}>
                      {r.field === "Date" ? (
                        <div className="dropdown-inside">
                          <button 
                            onClick={() => setOpenRuleDatePickerIndex(openRuleDatePickerIndex === i ? null : i)}
                            style={{ boxSizing: "border-box", width: "100%", padding: "10px 16px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: "#202223", outline: "none", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.2s" }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = "#5B21B6"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = openRuleDatePickerIndex === i ? "#5B21B6" : "#c9cccf"}
                          >
                            <svg style={{ width: "16px", height: "16px", color: "#5B21B6" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            {r.dateValue || "Select Date Range"}
                          </button>

                          {/* Date Picker Popover for Rules */}
                          {openRuleDatePickerIndex === i && (
                            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)", zIndex: 20, width: "700px", border: "1px solid #e2e8f0", display: "flex", overflow: "hidden" }}>
                              
                              {/* Left Side (White Area) */}
                              <div style={{ padding: "24px", flex: 1 }}>
                                <div style={{ display: "flex", gap: "32px", justifyContent: "space-between" }}>
                                  
                                  {/* Left Calendar (Start Date) */}
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                      <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                                      <div style={{ fontSize: "16px", fontWeight: "600", color: "#1e293b" }}>May 2026</div>
                                      <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
                                    </div>
                                    
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "10px", color: "#64748b", fontWeight: "600", marginBottom: "8px" }}>
                                      <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                                    </div>
                                    
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "14px", color: "#334155" }}>
                                      <div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}>1</div><div style={{ padding: "6px" }}>2</div>
                                      <div style={{ padding: "6px" }}>3</div><div style={{ padding: "6px" }}>4</div><div style={{ padding: "6px" }}>5</div><div style={{ padding: "6px" }}>6</div><div style={{ padding: "6px" }}>7</div><div style={{ padding: "6px" }}>8</div><div style={{ padding: "6px" }}>9</div>
                                      <div style={{ padding: "6px" }}>10</div><div style={{ padding: "6px" }}>11</div><div style={{ padding: "6px" }}>12</div><div style={{ padding: "6px" }}>13</div><div style={{ padding: "6px" }}>14</div><div style={{ padding: "6px" }}>15</div><div style={{ padding: "6px" }}>16</div>
                                      <div style={{ padding: "6px" }}>17</div><div style={{ padding: "6px" }}>18</div><div style={{ padding: "6px" }}>19</div><div style={{ padding: "6px" }}>20</div><div style={{ padding: "6px" }}>21</div><div style={{ padding: "6px" }}>22</div><div style={{ padding: "6px" }}>23</div>
                                      <div style={{ padding: "6px" }}>24</div>
                                      <div style={{ padding: "6px", background: "#5B21B6", color: "#fff", borderRadius: "50%", cursor: "pointer", fontWeight: "600" }}>25</div>
                                      <div style={{ padding: "6px", color: "#94a3b8" }}>26</div><div style={{ padding: "6px", color: "#94a3b8" }}>27</div><div style={{ padding: "6px", color: "#94a3b8" }}>28</div><div style={{ padding: "6px", color: "#94a3b8" }}>29</div><div style={{ padding: "6px", color: "#94a3b8" }}>30</div>
                                      <div style={{ padding: "6px", color: "#94a3b8" }}>31</div>
                                    </div>
                                  </div>
                                  
                                  {/* Right Calendar (End Date) */}
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                      <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                                      <div style={{ fontSize: "16px", fontWeight: "600", color: "#1e293b" }}>May 2026</div>
                                      <button style={{ background: "none", border: "none", cursor: "pointer", color: "#5B21B6" }}><svg style={{ width: "16px", height: "16px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
                                    </div>
                                    
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "10px", color: "#64748b", fontWeight: "600", marginBottom: "8px" }}>
                                      <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                                    </div>
                                    
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center", fontSize: "14px", color: "#334155" }}>
                                      <div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}></div><div style={{ padding: "6px" }}>1</div><div style={{ padding: "6px" }}>2</div>
                                      <div style={{ padding: "6px" }}>3</div><div style={{ padding: "6px" }}>4</div><div style={{ padding: "6px" }}>5</div><div style={{ padding: "6px" }}>6</div><div style={{ padding: "6px" }}>7</div><div style={{ padding: "6px" }}>8</div><div style={{ padding: "6px" }}>9</div>
                                      <div style={{ padding: "6px" }}>10</div><div style={{ padding: "6px" }}>11</div><div style={{ padding: "6px" }}>12</div><div style={{ padding: "6px" }}>13</div><div style={{ padding: "6px" }}>14</div><div style={{ padding: "6px" }}>15</div><div style={{ padding: "6px" }}>16</div>
                                      <div style={{ padding: "6px" }}>17</div><div style={{ padding: "6px" }}>18</div><div style={{ padding: "6px" }}>19</div><div style={{ padding: "6px" }}>20</div><div style={{ padding: "6px" }}>21</div><div style={{ padding: "6px" }}>22</div><div style={{ padding: "6px" }}>23</div>
                                      <div style={{ padding: "6px" }}>24</div>
                                      <div style={{ padding: "6px", background: "#5B21B6", color: "#fff", borderRadius: "50%", cursor: "pointer", fontWeight: "600" }}>25</div>
                                      <div style={{ padding: "6px", fontWeight: "600" }}>26</div><div style={{ padding: "6px", fontWeight: "600" }}>27</div><div style={{ padding: "6px", fontWeight: "600" }}>28</div><div style={{ padding: "6px", fontWeight: "600" }}>29</div><div style={{ padding: "6px", fontWeight: "600" }}>30</div>
                                      <div style={{ padding: "6px", fontWeight: "600" }}>31</div>
                                    </div>
                                  </div>

                                </div>

                                {/* Footer values and buttons */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "24px" }}>
                                  <div style={{ display: "flex", gap: "100px", paddingLeft: "16px" }}>
                                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#1E1B4B" }}>2026-05-25</div>
                                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#1E1B4B" }}>2026-05-25</div>
                                  </div>
                                  <div style={{ display: "flex", gap: "12px" }}>
                                    <button 
                                      onClick={() => setOpenRuleDatePickerIndex(null)}
                                      style={{ background: "#fff", color: "#5B21B6", border: "1px solid #5B21B6", padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
                                    >
                                      Cancel
                                    </button>
                                    <button 
                                      onClick={() => setOpenRuleDatePickerIndex(null)}
                                      style={{ background: "#5B21B6", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
                                    >
                                      Select
                                    </button>
                                  </div>
                                </div>

                              </div>

                            </div>
                          )}
                        </div>
                      ) : [
                        "Vendor", "Collections", "Product type", "Tags", "Locations", "Product", "SKU", "Barcode",
                        "Color (product option)", "Size (product option)", "slot (product option)"
                      ].includes(r.field) || (r.field && r.field.endsWith("(product option)")) ? (
                        <div className="dropdown-inside">
                          {(() => {
                            const selectedValues = r.value ? r.value.split(',').map(s=>s.trim()).filter(Boolean) : [];
                            return (
                              <>
                                <div style={{ position: "relative" }}>
                                  <div 
                                    onClick={() => setOpenVendorDropdownIndex(openVendorDropdownIndex === i ? null : i)}
                                    style={{ boxSizing: "border-box", width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: selectedValues.length > 0 ? "#202223" : "#8c9196", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s" }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = "#5B21B6"}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = openVendorDropdownIndex === i ? "#5B21B6" : "#c9cccf"}
                                  >
                                    <span style={{ display: "block", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "8px" }}>
                                      {selectedValues.length > 0 ? `${selectedValues.length} selected` : "Select option"}
                                    </span>
                                    <svg style={{ width: "16px", height: "16px", color: "#8c9196" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                  </div>
                                  
                                  {openVendorDropdownIndex === i && (
                                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", border: "1px solid rgba(30, 27, 75, 0.08)", borderRadius: "10px", boxShadow: "0 10px 25px -5px rgba(30, 27, 75, 0.15)", zIndex: 30 }}>
                                      <div style={{ padding: "12px" }}>
                                        <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid rgba(30, 27, 75, 0.08)" }}>
                                          <svg style={{ width: "16px", height: "16px", color: "#5B21B6", marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                          <input 
                                            type="text" 
                                            placeholder="Filter" 
                                            value={dropdownSearch}
                                            onChange={e => setDropdownSearch(e.target.value)}
                                            style={{ border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#1E1B4B", width: "100%" }}
                                            onClick={e => e.stopPropagation()}
                                          />
                                        </div>
                                      </div>
                                      <div style={{ maxHeight: "250px", overflowY: "auto", paddingBottom: "12px" }}>
                                        {(() => {
                                          let currentOptions = [];
                                          if (r.field === "Vendor") currentOptions = shopifyVendors || [];
                                          else if (r.field === "Collections") currentOptions = (shopifyCollections || []).map(c => c.title);
                                          else if (r.field === "Product type") currentOptions = shopifyProductTypes || [];
                                          else if (r.field === "Tags") currentOptions = shopifyTags || [];
                                          else if (r.field === "Locations") currentOptions = shopifyLocations || [];
                                          else if (r.field === "Product") currentOptions = shopifyProducts || [];
                                          else if (r.field === "SKU") currentOptions = shopifySkus || [];
                                          else if (r.field === "Barcode") currentOptions = shopifyBarcodes || [];
                                          else if (r.field && r.field.endsWith("(product option)")) {
                                            const optName = r.field.replace(" (product option)", "");
                                            currentOptions = shopifyOptions[optName] || shopifyOptions[optName.toLowerCase()] || shopifyOptions[optName.charAt(0).toUpperCase() + optName.slice(1)] || [];
                                          }
                                          const filteredOptions = currentOptions.filter(v => {
                                            const text = typeof v === 'string' ? v : v.title;
                                            return text.toLowerCase().includes((dropdownSearch || "").toLowerCase());
                                          });
                                          
                                          return (
                                            <>
                                              {filteredOptions.map((v, vIdx) => {
                                                const text = typeof v === 'string' ? v : v.title;
                                                const image = typeof v === 'string' ? null : v.image;
                                                const isChecked = selectedValues.includes(text);
                                                return (
                                                  <div 
                                                    key={`${text}-${vIdx}`}
                                                    onClick={() => {
                                                      const newRules = [...ruleRules];
                                                      let currentValues = newRules[i].value ? newRules[i].value.split(',').map(s=>s.trim()).filter(Boolean) : [];
                                                      if (currentValues.includes(text)) {
                                                        currentValues = currentValues.filter(val => val !== text);
                                                      } else {
                                                        currentValues.push(text);
                                                      }
                                                      newRules[i].value = currentValues.join(', ');
                                                      setRuleRules(newRules);
                                                    }}
                                                    style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px" }}
                                                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                                                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                                                  >
                                                    <div style={{ width: "16px", height: "16px", flexShrink: 0, borderRadius: "4px", border: "2px solid #cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", background: isChecked ? "#5B21B6" : "transparent", borderColor: isChecked ? "#5B21B6" : "#cbd5e1" }}>
                                                      {isChecked && <svg style={{ width: "10px", height: "10px", color: "#fff" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>}
                                                    </div>
                                                    {image ? (
                                                      <img src={image} alt="" style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px", border: "1px solid rgba(30, 27, 75, 0.08)" }} />
                                                    ) : (
                                                      (r.field === "Product" || r.field === "SKU") && (
                                                        <div style={{ width: "24px", height: "24px", borderRadius: "4px", border: "1px solid rgba(30, 27, 75, 0.08)", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                          <svg style={{ width: "14px", height: "14px", color: "#cbd5e1" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        </div>
                                                      )
                                                    )}
                                                    <span style={{ fontSize: "14px", color: "#1E1B4B" }}>{text}</span>
                                                  </div>
                                                );
                                              })}
                                              {filteredOptions.length === 0 && (
                                                <div style={{ padding: "16px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}>
                                                  No options found.
                                                </div>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {selectedValues.length > 0 && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", width: "100%" }}>
                                    {selectedValues.map(val => (
                                      <div key={val} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#5B21B6", color: "#fff", padding: "8px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "500", width: "100%", boxSizing: "border-box" }}>
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: "12px" }}>{val}</span>
                                        <div 
                                          onClick={() => {
                                            const newRules = [...ruleRules];
                                            newRules[i].value = selectedValues.filter(v => v !== val).join(', ');
                                            setRuleRules(newRules);
                                          }}
                                          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", flexShrink: 0 }}
                                        >
                                          <svg style={{ width: "12px", height: "12px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <input 
                          type="text" 
                          placeholder="Search values" 
                          value={r.value}
                          onChange={(e) => {
                            const newRules = [...ruleRules];
                            newRules[i].value = e.target.value;
                            setRuleRules(newRules);
                          }}
                          style={{ boxSizing: "border-box", width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: "#202223", outline: "none", transition: "all 0.2s" }}
                          onFocus={(e) => {
                            e.target.style.borderColor = "#5B21B6";
                            e.target.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = "#c9cccf";
                            e.target.style.boxShadow = "none";
                          }}
                        />
                      )}
                    </div>

                    {/* Trash Icon */}
                    {ruleRules.length > 1 && (
                      <div>
                        <button 
                          onClick={() => removeRuleRule(i)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", padding: "4px", transition: "color 0.2s" }}
                          onMouseEnter={e => e.currentTarget.style.color = "#dc2626"}
                          onMouseLeave={e => e.currentTarget.style.color = "#ef4444"}
                          title="Delete rule"
                        >
                          <svg style={{ width: "18px", height: "18px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Dynamic Extra Row */}
                  {r.action === "Dynamic" && (
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                      <div style={{ flex: 1, maxWidth: "120px" }}></div> {/* Spacer for Action column */}
                      
                      {/* Operator Dropdown */}
                      <div style={{ position: "relative", flex: 1.5 }} className="dropdown-inside">
                        <div 
                          onClick={() => setOpenOperatorDropdownIndex(openOperatorDropdownIndex === i ? null : i)}
                          style={{ boxSizing: "border-box", width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #c9cccf", backgroundColor: "#fff", fontSize: "14px", color: "#202223", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "#5B21B6"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = openOperatorDropdownIndex === i ? "#5B21B6" : "#c9cccf"}
                        >
                          {r.operator}
                          <svg style={{ width: "12px", height: "12px", color: "#8c9196" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                        {openOperatorDropdownIndex === i && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", border: "1px solid rgba(30, 27, 75, 0.08)", borderRadius: "10px", boxShadow: "0 10px 15px -3px rgba(30, 27, 75, 0.15)", zIndex: 10, padding: "8px 0" }}>
                            {["Add", "Subtract", "Multiply", "Divide", "Set"].map(op => (
                              <div 
                                key={op}
                                onClick={() => {
                                  const newRules = [...ruleRules];
                                  newRules[i].operator = op;
                                  setRuleRules(newRules);
                                  setOpenOperatorDropdownIndex(null);
                                }}
                                style={{ padding: "8px 16px", cursor: "pointer", fontSize: "14px", color: r.operator === op ? "#5B21B6" : "#1E1B4B", fontWeight: r.operator === op ? "600" : "400", background: r.operator === op ? "rgba(62, 58, 177, 0.04)" : "transparent" }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(62, 58, 177, 0.04)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                {op}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Operand Input */}
                      <div style={{ flex: 2 }}>
                        <input 
                          type="text" 
                          placeholder="Enter score"
                          value={r.operand}
                          onChange={e => {
                            const newRules = [...ruleRules];
                            newRules[i].operand = e.target.value;
                            setRuleRules(newRules);
                          }}
                          style={{ boxSizing: "border-box", width: "100%", background: "#fff", border: "1px solid #c9cccf", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", color: "#202223", outline: "none", transition: "all 0.2s" }}
                          onFocus={(e) => {
                            e.target.style.borderColor = "#5B21B6";
                            e.target.style.boxShadow = "0 0 0 2px rgba(62, 58, 177, 0.1)";
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = "#c9cccf";
                            e.target.style.boxShadow = "none";
                          }}
                        />
                      </div>

                      {/* Spacer for Trash Icon column */}
                      {ruleRules.length > 1 && <div style={{ width: "26px" }}></div>}
                    </div>
                  )}

                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", padding: "20px 32px", background: "#fff", borderTop: "1px solid #e2e8f0", position: "sticky", bottom: 0, zIndex: 5 }}>
          <button 
            onClick={handleClose} 
            style={{ 
              padding: "10px 24px", 
              background: "#fff", 
              border: "1px solid rgba(30, 27, 75, 0.12)", 
              borderRadius: "10px", 
              color: "#1E1B4B", 
              fontWeight: "600", 
              fontSize: "14px", 
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(30, 27, 75, 0.04)";
              e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.2)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "#fff";
              e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)";
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleCreate}
            disabled={fetcher.state !== "idle" || !ruleName.trim()}
            style={{ 
              padding: "10px 24px", 
              background: (fetcher.state !== "idle" || !ruleName.trim()) ? "#94a3b8" : "#5B21B6", 
              border: "none", 
              borderRadius: "10px", 
              color: "#fff", 
              fontWeight: "600", 
              fontSize: "14px", 
              cursor: (fetcher.state !== "idle" || !ruleName.trim()) ? "not-allowed" : "pointer", 
              boxShadow: "0 2px 4px rgba(62, 58, 177, 0.15)", 
              opacity: !ruleName.trim() ? 0.7 : 1,
              transition: "all 0.2s"
            }}
            onMouseEnter={e => {
              if (fetcher.state === "idle" && ruleName.trim()) {
                e.currentTarget.style.background = "#1e1b4b";
              }
            }}
            onMouseLeave={e => {
              if (fetcher.state === "idle" && ruleName.trim()) {
                e.currentTarget.style.background = "#5B21B6";
              }
            }}
          >
            {fetcher.state !== "idle" ? (ruleToEdit ? "Updating..." : "Creating...") : (ruleToEdit ? "Update" : "Create")}
          </button>
        </div>

      </div>
    </div>
  );
}
