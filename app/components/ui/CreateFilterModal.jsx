import React, { useState,useEffect } from "react";
// import { Modal } from "./Modal";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Checkbox } from "./Checkbox";

const Tooltip = ({ content, children }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginBottom: "8px",
          backgroundColor: "#313745",
          color: "#fff",
          padding: "12px",
          borderRadius: "6px",
          fontSize: "13px",
          width: "280px",
          zIndex: 100000,
          whiteSpace: "pre-wrap",
          lineHeight: "1.4",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          textAlign: "left"
        }}>
          {content}
          <div style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            borderWidth: "6px",
            borderStyle: "solid",
            borderColor: "#313745 transparent transparent transparent"
          }} />
        </div>
      )}
    </div>
  );
};

const TooltipIcon = ({ content }) => (
  <Tooltip content={content}>
    <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#e4e5e7", color: "#6d7175", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #c9cccf", cursor: "help", fontWeight: "bold" }}>?</div>
  </Tooltip>
);

const OPTION_TYPES = [
  { value: "collection", label: "Collection" },
  { value: "vendor", label: "Vendor" },
  { value: "product_type", label: "Product type" },
  { value: "tags", label: "Tags" },
  { value: "color", label: "Color (product option)" },
  { value: "denominations", label: "Denominations (product option)" },
  { value: "title", label: "Title (product option)" },
  { value: "price", label: "Price" },
  { value: "percent_sale", label: "Percent sale" },
  { value: "stock_status", label: "Stock status" },
  { value: "inventory_locations", label: "Inventory locations" },
  { value: "weight", label: "Weight" },
  { value: "review_rating", label: "Review rating" },
];

const OptionTypeDropdown = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedLabel = OPTION_TYPES.find(o => o.value === value)?.label || "Select";
  
  const filteredOptions = OPTION_TYPES.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        {selectedLabel}
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor", transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s" }}><path d="M10 14a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 1 1 1.414-1.414L10 11.586l4.293-4.293a.999.999 0 1 1 1.414 1.414l-5 5A.997.997 0 0 1 10 14z"/></svg>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "#f0f4f9", borderRadius: "20px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#007bff", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#007bff", width: "100%", fontSize: "14px" }}
                autoFocus
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, paddingTop: "8px" }}>
            {filteredOptions.map(opt => (
              <div 
                key={opt.value}
                onClick={() => { 
                  onChange(opt.value, opt.label); 
                  setIsOpen(false); 
                  setSearch(""); 
                }}
                style={{ padding: "10px 24px", cursor: "pointer", fontSize: "13px", color: "#202223", backgroundColor: value === opt.value ? "#f4f6f8" : "transparent" }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f4f6f8"}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = value === opt.value ? "#f4f6f8" : "transparent"}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const MultiSelectDropdown = ({ value, onChange, options, placeholder = "Select values", renderTagsOutside = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  const handleToggle = (opt) => {
    if (value.includes(opt)) {
      onChange(value.filter(v => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "40px", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
          {value.length === 0 || renderTagsOutside ? <span style={{ opacity: 0.7, color: "#007bff", fontWeight: "normal" }}>{placeholder}</span> : value.map(v => (
            <span key={v} style={{ background: "#d1e4fb", padding: "2px 8px", borderRadius: "12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
              {v}
              <span onClick={(e) => { e.stopPropagation(); handleToggle(v); }} style={{ cursor: "pointer", marginLeft: "2px", fontWeight: "bold" }}>×</span>
            </span>
          ))}
        </div>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "#f0f4f9", borderRadius: "20px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#007bff", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#007bff", width: "100%", fontSize: "14px" }}
                autoFocus
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, paddingTop: "8px" }}>
            {filteredOptions.length === 0 ? <div style={{ padding: "10px 24px", color: "#6d7175", fontSize: "13px" }}>No options found.</div> : null}
            {filteredOptions.map(opt => (
              <div 
                key={opt}
                onClick={() => handleToggle(opt)}
                style={{ padding: "10px 24px", cursor: "pointer", fontSize: "13px", color: "#202223", display: "flex", alignItems: "center", gap: "8px", backgroundColor: "transparent" }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f4f6f8"}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              >
                <Checkbox checked={value.includes(opt)} onChange={() => {}} />
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SingleSelectDropdown = ({ value, onChange, options, placeholder = "Select value" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "40px", boxSizing: "border-box" }}
      >
        <span style={{ color: value ? "#007bff" : "rgba(0, 123, 255, 0.7)", fontWeight: value ? "500" : "normal" }}>
          {value || placeholder}
        </span>
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor", transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s", flexShrink: 0 }}><path d="M10 14a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 1 1 1.414-1.414L10 11.586l4.293-4.293a.999.999 0 1 1 1.414 1.414l-5 5A.997.997 0 0 1 10 14z"/></svg>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "#f0f4f9", borderRadius: "20px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#007bff", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#007bff", width: "100%", fontSize: "14px" }}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, paddingTop: "8px" }}>
            {filteredOptions.length === 0 ? <div style={{ padding: "10px 24px", color: "#6d7175", fontSize: "13px" }}>No options found.</div> : null}
            {filteredOptions.map(opt => (
              <div 
                key={opt}
                onClick={() => { onChange(opt); setIsOpen(false); }}
                style={{ padding: "10px 24px", cursor: "pointer", fontSize: "13px", color: "#202223", display: "flex", alignItems: "center", gap: "8px", backgroundColor: "transparent" }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f4f6f8"}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SimpleDropdown = ({ value, onChange, options, width = "200px" }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ position: "relative", width }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", boxSizing: "border-box" }}
      >
        <span>{value}</span>
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor", transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s" }}><path d="M10 14a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 1 1 1.414-1.414L10 11.586l4.293-4.293a.999.999 0 1 1 1.414 1.414l-5 5A.997.997 0 0 1 10 14z"/></svg>
      </div>
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: "8px", width: "100%", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "8px 0" }}>
          {options.map(opt => (
            <div 
              key={opt}
              onClick={() => { onChange(opt); setIsOpen(false); }}
              style={{ padding: "10px 24px", cursor: "pointer", fontSize: "13px", color: "#202223" }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f4f6f8"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function CreateFilterModal({ isOpen, onClose, onSave, shopifyCollections = [], storeData = {}, initialData = null }) {
  const [activeTab, setActiveTab] = useState("general");
  const [showPreview, setShowPreview] = useState(true);
  
  // Form State
  const [optionType, setOptionType] = useState("collection");
  const [prefix, setPrefix] = useState("");
  const [filterTitle, setFilterTitle] = useState("Collection");
  const [displayMode, setDisplayMode] = useState("List");
  const [ratingColor, setRatingColor] = useState("#ffff00");
  const [navCollections, setNavCollections] = useState(false);
  const [useManualValues, setUseManualValues] = useState(false);
  const [manualValues, setManualValues] = useState([]);
  const [sortManualValues, setSortManualValues] = useState(false);
  const [multipleSelection, setMultipleSelection] = useState(false);
  const [narrowDown, setNarrowDown] = useState(false);
  const [excludedValues, setExcludedValues] = useState([]);

  // Price & Sale Ranges State
  const [priceRanges, setPriceRanges] = useState([
    { id: 1, label: "{0} - {1}", from: "0", to: "10" },
    { id: 2, label: "From {0}", from: "10", to: "" }
  ]);
  const [saleRanges, setSaleRanges] = useState([
    { id: 1, label: "{0}% - {1}%", from: "0", to: "10" },
    { id: 2, label: "From {0}%", from: "10", to: "" }
  ]);
  const [weightRanges, setWeightRanges] = useState([
    { id: 1, label: "{0} - {1}", from: "0", to: "10" },
    { id: 2, label: "From {0}", from: "10", to: "" }
  ]);
  const [reviewRanges, setReviewRanges] = useState([
    { id: 1, label: "No reviews", from: "0", to: "" },
    { id: 2, label: "", from: "1", to: "" },
    { id: 3, label: "", from: "2", to: "" },
    { id: 4, label: "", from: "3", to: "" },
    { id: 5, label: "", from: "4", to: "" },
    { id: 6, label: "", from: "5", to: "" }
  ]);

  // Stock Status State
  const [stockStatusConfig, setStockStatusConfig] = useState({
    inStock: { enabled: true, label: "In stock" },
    stockOnHand: { enabled: true, label: "Stock On Hand" },
    preOrder: { enabled: true, label: "Pre-Order" },
    outOfStock: { enabled: false, label: "Out of stock" }
  });
  

  // Navigation Collections State
  const [childType, setChildType] = useState("Select child type");
  const [mainCollections, setMainCollections] = useState([{ id: Date.now(), collection: "" }]);
  const [keepMainCollectionsUnchanged, setKeepMainCollectionsUnchanged] = useState(false);

  // Preview State
  const [device, setDevice] = useState("desktop");
  const [layout, setLayout] = useState("sidebar");

  const [advanced, setAdvanced] = useState({
    displayTooltip: false,
    tooltipContent: "",
    valuesTransformation: "No transformation",
    showMoreType: "Scrollbar",
    maxHeight: "300px",
    sortType: "Label - AZ",
        desktopCollapsed: false,
    desktopSearchBox: false,
    mobileSearchBox: false
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setOptionType(initialData.optionType || "collection");
        setFilterTitle(initialData.filterTitle || "");
        setPrefix(initialData.prefix || "");
        setNavCollections(initialData.navCollections || false);
        setChildType(initialData.childType || "Select child type");
        setMainCollections(initialData.mainCollections || [{ id: Date.now(), collection: "" }]);
        setKeepMainCollectionsUnchanged(initialData.keepMainCollectionsUnchanged || false);
        setMultipleSelection(initialData.multipleSelection || false);
        setNarrowDown(initialData.narrowDown || false);
        setUseManualValues(initialData.useManualValues || false);
        setExcludedValues(initialData.excludedValues || []);
        setManualValues(initialData.manualValues || []);
        setSortManualValues(initialData.sortManualValues || false);
        setDisplayMode(initialData.displayMode || "List");
        
        if (initialData.priceRanges) setPriceRanges(initialData.priceRanges.map(r => ({ ...r, from: r.from !== undefined ? r.from : (r.min || ""), to: r.to !== undefined ? r.to : (r.max || "") })));
        if (initialData.saleRanges) setSaleRanges(initialData.saleRanges);
        if (initialData.weightRanges) setWeightRanges(initialData.weightRanges);
        if (initialData.reviewRanges) setReviewRanges(initialData.reviewRanges);
        if (initialData.stockStatusConfig) setStockStatusConfig(initialData.stockStatusConfig);
        if (initialData.ratingColor) setRatingColor(initialData.ratingColor);

        if (initialData.advanced) {
          setAdvanced(prev => ({ ...prev, ...initialData.advanced }));
        }
      } else {
        setOptionType("collection");
        setFilterTitle("Collection");
        setPrefix("");
        setNavCollections(false);
        setChildType("Select child type");
        setMainCollections([{ id: Date.now(), collection: "" }]);
        setKeepMainCollectionsUnchanged(false);
        setMultipleSelection(false);
        setNarrowDown(false);
        setUseManualValues(false);
        setExcludedValues([]);
        setManualValues([]);
        setSortManualValues(false);
        setAdvanced({
          valuesTransformation: "Default",
          showMoreType: "Scrollbar",
          maxHeight: "300px",
          sortType: "Label - AZ",
          displayTooltip: false,
          tooltipContent: "",
          desktopCollapsed: false,
          desktopSearchBox: false,
          mobileSearchBox: false
        });
        setDisplayMode("List");
        setPriceRanges([
          { id: Date.now(), label: "{0} - {1}", from: "0", to: "10" },
          { id: Date.now() + 1, label: "From {0}", from: "10", to: "" }
        ]);
        setSaleRanges([
          { id: Date.now(), label: "{0}% - {1}%", from: "0", to: "10" },
          { id: Date.now() + 1, label: "From {0}%", from: "10", to: "" }
        ]);
        setWeightRanges([
          { id: Date.now(), label: "{0} - {1}", from: "0", to: "10" },
          { id: Date.now() + 1, label: "From {0}", from: "10", to: "" }
        ]);
        setReviewRanges([
          { id: Date.now(), label: "No reviews", from: "0", to: "" },
          { id: Date.now() + 1, label: "", from: "1", to: "" },
          { id: Date.now() + 2, label: "", from: "2", to: "" },
          { id: Date.now() + 3, label: "", from: "3", to: "" },
          { id: Date.now() + 4, label: "", from: "4", to: "" },
          { id: Date.now() + 5, label: "", from: "5", to: "" }
        ]);
        setStockStatusConfig({
          inStock: true, inStockLabel: "In stock", inStockType: "checkbox",
          outOfStock: true, outOfStockLabel: "Out of stock", outOfStockType: "checkbox"
        });
        setRatingColor("#ffff00");
      }
      setActiveTab("general");
    }
  }, [isOpen, initialData]);

  const DUMMY_DATA = {
    collection: (shopifyCollections || []).map(c => ({ label: c, count: 0 })),
    vendor: (storeData?.vendors || []).map(v => ({ label: v.value, count: v.count })),
    product_type: (storeData?.productTypes || []).map(p => ({ label: p.value, count: p.count })),
    tags: (storeData?.tags || []).map(t => ({ label: t.value, count: t.count })),
  };

  const getDummyData = (type) => {
    // Dynamic ranges for Price, Percent Sale, Weight, Review Rating
    if (["price", "percent_sale", "weight", "review_rating"].includes(type)) {
      const ranges = type === "price" ? priceRanges 
                   : type === "percent_sale" ? saleRanges 
                   : type === "weight" ? weightRanges 
                   : reviewRanges;
                   
      // In the real app, we'd need to calculate how many products fall into each specific range.
      // For preview purposes, we fall back to total products or divide evenly if that makes sense, 
      // but to be absolutely dynamic without static data, we use the DB's total product count.
      const totalCount = storeData?.totalProducts || 0;
      
      return ranges.map(r => {
        if (type === "review_rating" && !r.label) {
          return { label: r.from, isStars: true, count: totalCount };
        }
        const rFrom = r.from !== undefined ? r.from : (r.min || "");
        const rTo = r.to !== undefined ? r.to : (r.max || "");
        let label = (r.label || "").replace("{0}", rFrom);
        if (rTo) label = label.replace("{1}", rTo);
        return { label, count: totalCount };
      });
    }
    
    // Dynamic checkboxes for Stock Status using REAL Database counts
    if (type === "stock_status") {
      const data = [];
      const counts = storeData?.stockStatusCounts || { inStock: 0, stockOnHand: 0, preOrder: 0, outOfStock: 0 };
      
      if (stockStatusConfig.inStock.enabled) {
        if (!stockStatusConfig.stockOnHand.enabled && !stockStatusConfig.preOrder.enabled) {
          data.push({ label: stockStatusConfig.inStock.label, count: counts.inStock });
        } else {
          if (stockStatusConfig.stockOnHand.enabled) data.push({ label: stockStatusConfig.stockOnHand.label, count: counts.stockOnHand });
          if (stockStatusConfig.preOrder.enabled) data.push({ label: stockStatusConfig.preOrder.label, count: counts.preOrder });
        }
      }
      if (stockStatusConfig.outOfStock.enabled) {
        data.push({ label: stockStatusConfig.outOfStock.label, count: counts.outOfStock });
      }
      return data;
    }
    
    // Dynamic Locations
    if (type === "inventory_locations") {
      return storeData?.locations?.map(l => ({ label: l.value, count: l.count })) || [];
    }

    // If it's a known top-level type, return its data
    if (DUMMY_DATA[type]) return DUMMY_DATA[type];
    
    // Check if it's a dynamic option type (like 'color', 'size', 'title', 'denominations')
    if (storeData?.options && storeData.options[type]) {
      return storeData.options[type].map(v => ({ label: v.value, count: v.count }));
    }

    // Fallback dummy data if nothing exists
    const labelType = type === "option" ? filterTitle || "option" : type;
    return [
      { label: `Sample ${labelType} 1`, count: 5 },
      { label: `Sample ${labelType} 2`, count: 3 },
      { label: `Sample ${labelType} 3`, count: 2 }
    ];
  };

  let currentOptionsData = getDummyData(optionType);
  const currentOptionsLabels = currentOptionsData.map(o => o.label);

  const renderStars = (ratingStr) => {
    const num = parseInt(ratingStr);
    if (isNaN(num)) return ratingStr;
    return (
      <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <svg key={star} viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: star <= num ? "#FFC107" : "transparent", stroke: "#FFC107", strokeWidth: "1.5px" }}>
            <path d="M10 1.3l2.388 6.722h7.312l-5.938 4.056 2.388 6.722-5.938-4.056-5.938 4.056 2.388-6.722-5.938-4.056h7.312z" />
          </svg>
        ))}
      </div>
    );
  };

  // Apply Advanced Transformations
  if (advanced.valuesTransformation === "Capitalize") {
    currentOptionsData = currentOptionsData.map(o => ({ ...o, label: o.label.charAt(0).toUpperCase() + o.label.slice(1).toLowerCase() }));
  } else if (advanced.valuesTransformation === "Uppercase") {
    currentOptionsData = currentOptionsData.map(o => ({ ...o, label: o.label.toUpperCase() }));
  } else if (advanced.valuesTransformation === "Lowercase") {
    currentOptionsData = currentOptionsData.map(o => ({ ...o, label: o.label.toLowerCase() }));
  }

  // Apply Advanced Sorting
  if (advanced.sortType === "Label - AZ") {
    currentOptionsData.sort((a, b) => a.label.localeCompare(b.label));
  } else if (advanced.sortType === "Label - ZA") {
    currentOptionsData.sort((a, b) => b.label.localeCompare(a.label));
  } else if (advanced.sortType === "Product count - Highest to lowest") {
    currentOptionsData.sort((a, b) => b.count - a.count);
  } else if (advanced.sortType === "Product count - Lowest to highest") {
    currentOptionsData.sort((a, b) => a.count - b.count);
  }

  if (!isOpen) return null;

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
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          width: "1100px",
          maxWidth: "95vw",
          height: "85vh",
          maxHeight: "850px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          overflow: "hidden"
        }}
      >
        {/* Header Title */}
        <div style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e1e3e5" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#202223" }}>
            {initialData ? "Edit Filters" : "Create a new filter"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
              <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
            </svg>
          </button>
        </div>

        {/* Tabs and Preview Toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px", borderBottom: "1px solid #e1e3e5", background: "#fcfcfc" }}>
          <div style={{ display: "flex", gap: "24px" }}>
            <div 
              onClick={() => setActiveTab("general")}
              style={{ padding: "12px 0", cursor: "pointer", color: activeTab === "general" ? "#007bff" : "#6d7175", borderBottom: activeTab === "general" ? "3px solid #007bff" : "3px solid transparent", fontWeight: activeTab === "general" ? "600" : "500", fontSize: "14px" }}
            >
              General
            </div>
            <div 
              onClick={() => setActiveTab("advanced")}
              style={{ padding: "12px 0", cursor: "pointer", color: activeTab === "advanced" ? "#007bff" : "#6d7175", borderBottom: activeTab === "advanced" ? "3px solid #007bff" : "3px solid transparent", fontWeight: activeTab === "advanced" ? "600" : "500", fontSize: "14px" }}
            >
              Advanced
            </div>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: "8px" }}>
              <div style={{ position: "relative", width: "36px", height: "20px" }}>
                <input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, backgroundColor: showPreview ? "#007bff" : "#8c9196", borderRadius: "34px", transition: "0.2s" }}>
                  <span style={{ position: "absolute", height: "14px", width: "14px", left: showPreview ? "19px" : "3px", bottom: "3px", backgroundColor: "white", borderRadius: "50%", transition: "0.2s" }} />
                </span>
              </div>
              <span style={{ fontSize: "13px", color: "#4a4c4e", fontWeight: "500" }}>Preview</span>
            </label>
            <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#f4f6f8", color: "#8c9196", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #d2d5d8", cursor: "help" }}>?</div>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          
          {/* Left Form Panel */}
          <div style={{ flex: 1, padding: "24px", paddingBottom: "250px", overflowY: "auto", overflowX: "hidden", borderRight: showPreview ? "1px solid #e1e3e5" : "none" }}>
            {activeTab === "general" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                
                {/* Option Type */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: "600", color: "#4a4c4e" }}>Option type</label>
                    <TooltipIcon content="The type of the filter." />
                  </div>
                  <OptionTypeDropdown 
                    value={optionType} 
                    onChange={(val, label) => {
                      // If the current title matches the old option type label, update it to the new one
                      const oldLabel = (OPTION_TYPES.find(o => o.value === optionType)?.label || "Collection").replace(" (product option)", "");
                      if (filterTitle === oldLabel) {
                        setFilterTitle(label.replace(" (product option)", ""));
                      }
                      setOptionType(val);
                      
                      // Check if current display mode is valid for the new option type
                      const validModes = ["tags", "color", "denominations", "title"].includes(val) ? ["List", "Box", "Swatch"] : ["List", "Box"];
                      if (!validModes.includes(displayMode)) {
                        setDisplayMode("List");
                      }
                    }} 
                  />
                </div>

                {/* Prefix */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: "600", color: "#4a4c4e" }}>Prefix</label>
                    <TooltipIcon content={"If specified, only the collections starting with this prefix are shown as filter option values.\nThis prefix is case-sensitive.\n\ne.g. If your values start with Color_ and this prefix is set to Color_, only the values starting with Color_ are shown in this filter."} />
                  </div>
                  <input 
                    type="text" 
                    placeholder="e.g. Gender:" 
                    value={prefix}
                    onChange={e => setPrefix(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                  />
                </div>

                {/* Filter Title */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: "600", color: "#4a4c4e" }}>Filter title</label>
                    <TooltipIcon content="The header label of the filter." />
                  </div>
                  <div style={{ position: "relative" }}>
                    <input 
                      type="text" 
                      value={filterTitle}
                      onChange={e => setFilterTitle(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                    />
                    {filterTitle && (
                      <button 
                        onClick={() => setFilterTitle("")}
                        style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "#d1e4fb", color: "#007bff", border: "none", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px" }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Display mode */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: "600", color: "#4a4c4e" }}>Display mode</label>
                    <TooltipIcon content="Choose how the filter options should be displayed." />
                  </div>
                  <SimpleDropdown 
                    value={displayMode} 
                    onChange={setDisplayMode} 
                    options={
                      ["tags", "color", "denominations", "title", "inventory_locations"].includes(optionType) ? ["List", "Box", "Swatch"] 
                      : ["price", "percent_sale", "weight", "review_rating"].includes(optionType) ? ["List", "Range"]
                      : ["List", "Box"]
                    } 
                    width="100%"
                  />
                </div>

                {/* Navigation Collections */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: navCollections ? "12px" : "0", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Checkbox checked={navCollections} onChange={setNavCollections} />
                    <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Navigation collections</span>
                    <TooltipIcon content={"On a collection page, if this option is checked and user selects a collection, he/she is redirected to the corresponding collection page. Manual values must be used in this case."} />
                  </div>
                  {navCollections && (
                    <SimpleDropdown 
                      value={childType} 
                      onChange={setChildType} 
                      options={["None", "Tags", "Collections", "Hyperlink"]} 
                    />
                  )}
                </div>

                {navCollections && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginLeft: "28px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Main collection</label>
                      <TooltipIcon content="Select the main collections to navigate from." />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {mainCollections.map((mc, index) => (
                        <div key={mc.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {/* Drag handle */}
                          <div style={{ color: "#007bff", cursor: "grab", display: "flex", flexDirection: "column", gap: "3px" }}>
                            <div style={{ display: "flex", gap: "3px" }}><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span></div>
                            <div style={{ display: "flex", gap: "3px" }}><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span></div>
                            <div style={{ display: "flex", gap: "3px" }}><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span><span style={{width:"4px",height:"4px",background:"currentColor",borderRadius:"50%"}}></span></div>
                          </div>
                          
                          <div style={{ flex: 1 }}>
                            <SingleSelectDropdown 
                              value={mc.collection}
                              onChange={(val) => {
                                const newCols = [...mainCollections];
                                newCols[index].collection = val;
                                setMainCollections(newCols);
                              }}
                              options={shopifyCollections}
                              placeholder="Select collection"
                            />
                          </div>
                          
                          <button 
                            onClick={() => {
                              setMainCollections(mainCollections.filter(item => item.id !== mc.id));
                            }}
                            style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #007bff", background: "#fff", color: "#007bff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                          >
                            <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M16 6H4a1 1 0 1 0 0 2h1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8h1a1 1 0 1 0 0-2zM9 4a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2H9zm2 12h2V8h-2v8zm-4 0h2V8H7v8z" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <Button 
                        variant="primary" 
                        onClick={() => setMainCollections([...mainCollections, { id: Date.now(), collection: "" }])}
                        style={{ borderRadius: "20px", padding: "6px 16px", fontSize: "13px", background: "#007bff", border: "none", display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        <span style={{ fontSize: "16px" }}>+</span> Add item
                      </Button>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", marginBottom: "8px" }}>
                      <Checkbox checked={keepMainCollectionsUnchanged} onChange={setKeepMainCollectionsUnchanged} />
                      <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Keep main collections unchanged</span>
                      <TooltipIcon content="When checked, the main collections will remain unchanged when navigating to child collections." />
                    </div>
                  </div>
                )}

                {/* Values Section */}
                <div style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "600", color: "#202223" }}>Values</span>
                    <Tooltip content="To merge values, go to App settings / Merged values.">
                      <a href="#" style={{ fontSize: "13px", color: "#007bff", textDecoration: "none" }}>(want to merge values?)</a>
                    </Tooltip>
                  </div>
                  
                  {["price", "percent_sale", "weight", "review_rating"].includes(optionType) ? (
                    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div style={{ display: "flex", gap: "20px", color: "#6d7175", fontSize: "13px", fontWeight: "600" }}>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "4px" }}>Label <TooltipIcon content="Format using {0} for From and {1} for To" /></div>
                        <div style={{ flex: 1 }}>From</div>
                        <div style={{ flex: 1 }}>To</div>
                        <div style={{ width: "80px" }}></div>
                      </div>
                      
                      {(optionType === "price" ? priceRanges : optionType === "percent_sale" ? saleRanges : optionType === "weight" ? weightRanges : reviewRanges).map((range, idx) => {
                        const ranges = optionType === "price" ? priceRanges : optionType === "percent_sale" ? saleRanges : optionType === "weight" ? weightRanges : reviewRanges;
                        const setRanges = optionType === "price" ? setPriceRanges : optionType === "percent_sale" ? setSaleRanges : optionType === "weight" ? setWeightRanges : setReviewRanges;
                        
                        return (
                          <div key={range.id} style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                            <input 
                              style={{ flex: 1, padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "13px", fontWeight: "500", width: "100%" }}
                              value={range.label}
                              onChange={(e) => {
                                const newRanges = [...ranges];
                                newRanges[idx].label = e.target.value;
                                setRanges(newRanges);
                              }}
                            />
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                              <Checkbox checked={range.from !== ""} onChange={() => {}} />
                              <input 
                                style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", fontSize: "13px", fontWeight: "600", color: "#202223" }} 
                                value={range.from} 
                                onChange={(e) => {
                                  const newRanges = [...ranges];
                                  newRanges[idx].from = e.target.value;
                                  setRanges(newRanges);
                                }}
                              />
                            </div>
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                              <Checkbox checked={range.to !== ""} onChange={(val) => {
                                const newRanges = [...ranges];
                                newRanges[idx].to = val ? "10" : "";
                                setRanges(newRanges);
                              }} />
                              <input 
                                style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: range.to !== "" ? "#f0f4f9" : "transparent", fontSize: "13px", color: "#202223", visibility: range.to !== "" ? "visible" : "hidden" }} 
                                value={range.to} 
                                onChange={(e) => {
                                  const newRanges = [...ranges];
                                  newRanges[idx].to = e.target.value;
                                  setRanges(newRanges);
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button 
                                onClick={() => {
                                  const newId = Date.now();
                                  setRanges([...ranges.slice(0, idx+1), { id: newId, label: "", from: "", to: "" }, ...ranges.slice(idx+1)]);
                                }}
                                style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #007bff", background: "#fff", color: "#007bff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "18px" }}
                              >
                                +
                              </button>
                              <button 
                                onClick={() => setRanges(ranges.filter(r => r.id !== range.id))}
                                style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #007bff", background: "#fff", color: "#007bff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                              >
                                <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M16 6H4a1 1 0 1 0 0 2h1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8h1a1 1 0 1 0 0-2zM9 4a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2H9zm2 12h2V8h-2v8zm-4 0h2V8H7v8z"/></svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {optionType === "review_rating" && (
                        <div style={{ marginTop: "16px" }}>
                          <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175", display: "block", marginBottom: "8px" }}>Rating color</label>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#f0f4f9", borderRadius: "20px", padding: "4px 16px" }}>
                            <input 
                              style={{ flex: 1, border: "none", background: "transparent", fontSize: "13px", color: "#007bff", padding: "8px 0", outline: "none" }}
                              value={ratingColor}
                              onChange={(e) => setRatingColor(e.target.value)}
                            />
                            <div style={{ width: "16px", height: "16px", background: ratingColor, border: "1px solid rgba(0,0,0,0.1)", borderRadius: "2px" }}></div>
                            <svg viewBox="0 0 20 20" style={{ width: "14px", height: "14px", fill: "#007bff", cursor: "pointer" }}><path d="M12.3 3.7l4 4L4 20H0v-4L12.3 3.7zm1.4-1.4L16 0l4 4-2.3 2.3-4-4z"/></svg>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : optionType === "stock_status" ? (
                    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
                      
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Checkbox checked={stockStatusConfig.inStock.enabled} onChange={(val) => setStockStatusConfig({...stockStatusConfig, inStock: {...stockStatusConfig.inStock, enabled: val}})} />
                          <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "600" }}>Show in stock filter option</span>
                        </div>
                        {stockStatusConfig.inStock.enabled && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                            <input 
                              style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "13px" }}
                              value={stockStatusConfig.inStock.label}
                              onChange={(e) => setStockStatusConfig({...stockStatusConfig, inStock: {...stockStatusConfig.inStock, label: e.target.value}})}
                            />
                            <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e1e3e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", cursor: "pointer" }}>×</div>
                          </div>
                        )}
                      </div>

                      {stockStatusConfig.inStock.enabled && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "20px", paddingLeft: "32px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Checkbox checked={stockStatusConfig.stockOnHand.enabled} onChange={(val) => setStockStatusConfig({...stockStatusConfig, stockOnHand: {...stockStatusConfig.stockOnHand, enabled: val}})} />
                              <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Stock On Hand</span>
                              <TooltipIcon content="Products currently physically in stock" />
                            </div>
                            {stockStatusConfig.stockOnHand.enabled && (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                                <input 
                                  style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "13px" }}
                                  value={stockStatusConfig.stockOnHand.label}
                                  onChange={(e) => setStockStatusConfig({...stockStatusConfig, stockOnHand: {...stockStatusConfig.stockOnHand, label: e.target.value}})}
                                />
                                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e1e3e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", cursor: "pointer" }}>×</div>
                              </div>
                            )}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Checkbox checked={stockStatusConfig.preOrder.enabled} onChange={(val) => setStockStatusConfig({...stockStatusConfig, preOrder: {...stockStatusConfig.preOrder, enabled: val}})} />
                              <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Pre-Order</span>
                              <TooltipIcon content="Products available for pre-order" />
                            </div>
                            {stockStatusConfig.preOrder.enabled && (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                                <input 
                                  style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "13px" }}
                                  value={stockStatusConfig.preOrder.label}
                                  onChange={(e) => setStockStatusConfig({...stockStatusConfig, preOrder: {...stockStatusConfig.preOrder, label: e.target.value}})}
                                />
                                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e1e3e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", cursor: "pointer" }}>×</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Checkbox checked={stockStatusConfig.outOfStock.enabled} onChange={(val) => setStockStatusConfig({...stockStatusConfig, outOfStock: {...stockStatusConfig.outOfStock, enabled: val}})} />
                          <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Show out of stock filter option</span>
                        </div>
                        {stockStatusConfig.outOfStock.enabled && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                            <input 
                              style={{ width: "100%", padding: "8px 16px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "13px" }}
                              value={stockStatusConfig.outOfStock.label}
                              onChange={(e) => setStockStatusConfig({...stockStatusConfig, outOfStock: {...stockStatusConfig.outOfStock, label: e.target.value}})}
                            />
                            <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e1e3e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", cursor: "pointer" }}>×</div>
                          </div>
                        )}
                      </div>

                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                        <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setUseManualValues(!useManualValues)}>
                          <span style={{ position: "absolute", inset: 0, backgroundColor: useManualValues ? "#007bff" : "#e1e3e5", borderRadius: "34px", transition: "0.2s" }}>
                            <span style={{ position: "absolute", height: "14px", width: "14px", left: useManualValues ? "19px" : "3px", bottom: "3px", backgroundColor: "white", borderRadius: "50%", transition: "0.2s" }} />
                          </span>
                        </div>
                        <span style={{ fontSize: "13px", color: useManualValues ? "#202223" : "#6d7175" }}>
                          {useManualValues ? "The manual values below are shown to your customers" : `No manual values. Your customers see all ${filterTitle || "Collection"} values.`}
                        </span>
                      </div>

                      {!useManualValues ? (
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                            <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Excluded values</label>
                            <TooltipIcon content="The option values that should not be shown in the filter." />
                          </div>
                          <MultiSelectDropdown 
                            value={excludedValues}
                            onChange={setExcludedValues}
                            options={currentOptionsLabels}
                            placeholder="Select values to exclude"
                            renderTagsOutside={true}
                          />
                          {excludedValues.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                              {excludedValues.map(v => (
                                <span key={v} style={{ background: "#007bff", color: "#fff", padding: "4px 12px", borderRadius: "16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500" }}>
                                  {v}
                                  <span onClick={() => setExcludedValues(excludedValues.filter(item => item !== v))} style={{ cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}>×</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div style={{ marginBottom: "16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                              <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Manual values</label>
                              <TooltipIcon content="The option values that should be shown in the filter." />
                            </div>
                            <MultiSelectDropdown 
                              value={manualValues}
                              onChange={setManualValues}
                              options={currentOptionsLabels}
                              placeholder="Select values to show"
                              renderTagsOutside={true}
                            />
                            {manualValues.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                                {manualValues.map(v => (
                                  <span key={v} style={{ background: "#007bff", color: "#fff", padding: "4px 12px", borderRadius: "16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500" }}>
                                    {v}
                                    <span onClick={() => setManualValues(manualValues.filter(item => item !== v))} style={{ cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}>×</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <Checkbox checked={sortManualValues} onChange={setSortManualValues} />
                            <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Sort manual values</span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* Multiple selection */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: multipleSelection ? "12px" : "0" }}>
                    <Checkbox checked={multipleSelection} onChange={setMultipleSelection} />
                    <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Multiple selection</span>
                    <TooltipIcon content="When checked, users can choose multiple filter option values." />
                  </div>

                  {multipleSelection && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Checkbox checked={narrowDown} onChange={setNarrowDown} />
                      <span style={{ fontSize: "14px", color: "#007bff", fontWeight: "500" }}>Narrow down filter option values</span>
                      <TooltipIcon content="When checked, products must match all selected values instead of any selected value." />
                    </div>
                  )}
                </div>

              </div>
            )}
            
            {activeTab === "advanced" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "24px" }}>
                {/* Display tooltip */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Checkbox 
                      checked={advanced.displayTooltip} 
                      onChange={(checked) => setAdvanced({ ...advanced, displayTooltip: checked })} 
                    />
                    <label style={{ fontSize: "14px", fontWeight: "600", color: "#007bff" }}>Display tooltip</label>
                    <TooltipIcon content="Show a tooltip icon next to the filter title." />
                  </div>
                  
                  {advanced.displayTooltip && (
                    <div style={{ marginTop: "12px", marginLeft: "28px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                        <label style={{ fontSize: "13px", color: "#8c9196" }}>Tooltip content</label>
                        <TooltipIcon content="The text to display inside the tooltip." />
                      </div>
                      <input 
                        type="text" 
                        value={advanced.tooltipContent}
                        onChange={e => setAdvanced({ ...advanced, tooltipContent: e.target.value })}
                        placeholder="Type tooltip text here"
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", outline: "none" }}
                      />
                    </div>
                  )}
                </div>

                {["vendor", "collection", "product_type", "tags", "color", "denominations", "title", "inventory_locations"].includes(optionType) ? (
                  <>
                    {/* Values transformation */}
                    <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", color: "#8c9196" }}>Values transformation</label>
                    <TooltipIcon content="Transform how the filter option labels appear." />
                  </div>
                  <SimpleDropdown 
                    value={advanced.valuesTransformation} 
                    onChange={val => setAdvanced({ ...advanced, valuesTransformation: val })} 
                    options={["No transformation", "Capitalize", "Uppercase", "Lowercase"]} 
                    width="100%"
                  />
                </div>

                {/* Show more type */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", color: "#8c9196" }}>Show more type</label>
                    <TooltipIcon content="How to display long lists of filter values." />
                  </div>
                  <SimpleDropdown 
                    value={advanced.showMoreType} 
                    onChange={val => setAdvanced({ ...advanced, showMoreType: val })} 
                    options={["Scrollbar", "Show all", "View more", "View more with scrollbar"]} 
                    width="100%"
                  />
                </div>

                {/* Maximum height (Conditional) */}
                {(advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                      <label style={{ fontSize: "13px", color: "#8c9196" }}>Maximum height</label>
                      <TooltipIcon content="The maximum height of the filter block before a scrollbar appears." />
                    </div>
                    <div style={{ position: "relative" }}>
                      <input 
                        type="text" 
                        value={advanced.maxHeight}
                        onChange={e => setAdvanced({ ...advanced, maxHeight: e.target.value })}
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "20px", border: "none", background: "#f0f4f9", color: "#007bff", fontSize: "14px", outline: "none" }}
                      />
                      {advanced.maxHeight && (
                        <button 
                          onClick={() => setAdvanced({ ...advanced, maxHeight: "" })}
                          style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "#d1e4fb", color: "#007bff", border: "none", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px" }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Sort type */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "13px", color: "#8c9196" }}>Sort type</label>
                    <TooltipIcon content="How filter options should be ordered." />
                  </div>
                  <SimpleDropdown 
                    value={advanced.sortType} 
                    onChange={val => setAdvanced({ ...advanced, sortType: val })} 
                    options={["Label - AZ", "Label - ZA", "Product count - Highest to lowest", "Product count - Lowest to highest"]} 
                    width="100%"
                  />
                </div>

                {/* On desktop & On mobile checkboxes */}
                <div style={{ display: "flex", gap: "40px", marginTop: "16px" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ margin: 0, fontSize: "13px", color: "#202223" }}>On desktop</h4>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Checkbox 
                        checked={advanced.desktopCollapsed} 
                        onChange={checked => setAdvanced({ ...advanced, desktopCollapsed: checked })} 
                      />
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#007bff" }}>Initially collapsed</label>
                      <TooltipIcon content="Filter block will be collapsed when the page loads on desktop." />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Checkbox 
                        checked={advanced.desktopSearchBox} 
                        onChange={checked => setAdvanced({ ...advanced, desktopSearchBox: checked })} 
                      />
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#007bff" }}>Show search box</label>
                      <TooltipIcon content="Show a search input inside the filter block on desktop." />
                    </div>
                  </div>

                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ margin: 0, fontSize: "13px", color: "#202223" }}>On mobile</h4>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "32px" }}>
                      <Checkbox 
                        checked={advanced.mobileSearchBox} 
                        onChange={checked => setAdvanced({ ...advanced, mobileSearchBox: checked })} 
                      />
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#007bff" }}>Show search box</label>
                      <TooltipIcon content="Show a search input inside the filter block on mobile." />
                    </div>
                  </div>
                </div>
                  </>
                ) : (
                  <>
                    {/* Restricted Options (e.g. Price) only show Initially Collapsed */}
                    <div style={{ marginTop: "16px" }}>
                      <label style={{ fontSize: "13px", fontWeight: "600", color: "#202223", display: "block", marginBottom: "12px" }}>On desktop</label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input 
                          type="checkbox" 
                          checked={advanced.desktopCollapsed} 
                          onChange={e => setAdvanced({ ...advanced, desktopCollapsed: e.target.checked })} 
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "14px", color: "#007bff" }}>Initially collapsed</span>
                        <TooltipIcon content="When checked, the filter is initially collapsed." />
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Preview Panel */}
          {showPreview && (
            <div style={{ width: "350px", background: "#fcfcfc", display: "flex", flexDirection: "column", padding: "24px", overflowY: "auto" }}>
              
              {/* Device and Layout Toggles */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", marginBottom: "24px" }}>
                <div style={{ display: "flex", background: "#fff", borderRadius: "4px", border: "1px solid #c9cccf", overflow: "hidden" }}>
                  <button 
                    onClick={() => setDevice("desktop")}
                    style={{ padding: "6px 12px", border: "none", background: device === "desktop" ? "#f4f6f8" : "#fff", color: device === "desktop" ? "#007bff" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><path d="M17.5 3h-15C1.67 3 1 3.67 1 4.5v9c0 .83.67 1.5 1.5 1.5H7v2H5v1h10v-1h-2v-2h4.5c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zm-.5 10H3V5h14v8z"/></svg>
                  </button>
                  <button 
                    onClick={() => setDevice("mobile")}
                    style={{ padding: "6px 12px", border: "none", borderLeft: "1px solid #c9cccf", background: device === "mobile" ? "#f4f6f8" : "#fff", color: device === "mobile" ? "#007bff" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M13 1H7C5.9 1 5 1.9 5 3v14c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm-3 16c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm3-3H7V4h6v10z"/></svg>
                  </button>
                </div>

                <div style={{ display: "flex", background: "#fff", borderRadius: "4px", border: "1px solid #c9cccf", overflow: "hidden" }}>
                  <button 
                    onClick={() => setLayout("sidebar")}
                    style={{ padding: "6px 12px", border: layout === "sidebar" ? "1px solid #007bff" : "none", background: layout === "sidebar" ? "#f4f6f8" : "#fff", color: layout === "sidebar" ? "#007bff" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><rect x="3" y="4" width="4" height="12"/><rect x="8" y="4" width="9" height="12" opacity="0.3"/></svg>
                  </button>
                  <button 
                    onClick={() => setLayout("top")}
                    style={{ padding: "6px 12px", border: layout === "top" ? "1px solid #007bff" : "none", borderLeft: layout === "top" ? "1px solid #007bff" : "1px solid #c9cccf", background: layout === "top" ? "#f4f6f8" : "#fff", color: layout === "top" ? "#007bff" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><rect x="4" y="3" width="12" height="3"/><rect x="4" y="7" width="12" height="10" opacity="0.3"/></svg>
                  </button>
                </div>
              </div>

              {/* Preview Box */}
              <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px", minHeight: "200px", overflowY: "auto", flex: 1 }}>
                {device === "desktop" ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
                        <h3 style={{ margin: 0, fontSize: "12px", fontWeight: "700", color: "#202223", textTransform: "uppercase" }}>
                          {filterTitle || "COLLECTION"}
                        </h3>
                        {advanced.displayTooltip && (
                          <div title={advanced.tooltipContent} style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#f4f6f8", color: "#8c9196", fontSize: "9px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #d2d5d8", cursor: "help" }}>?</div>
                        )}
                      </div>
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#202223", transform: advanced.desktopCollapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M5 8l5 5 5-5z" /></svg>
                    </div>

                    {!advanced.desktopCollapsed && (
                      <div style={{ 
                        display: "flex", 
                        flexDirection: "column", 
                        gap: "12px", 
                        maxHeight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") && advanced.maxHeight ? advanced.maxHeight : "none", 
                        overflowY: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "auto" : "visible",
                        paddingRight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "4px" : "0"
                      }}>
                        {["vendor", "collection", "product_type", "tags", "color", "denominations", "title", "inventory_locations"].includes(optionType) && advanced.desktopSearchBox && (
                          <input 
                            type="text" 
                            placeholder="Filter options" 
                            style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #e1e3e5", fontSize: "13px", marginBottom: "8px" }} 
                          />
                        )}

                      {currentOptionsData
                        .filter(item => !excludedValues.includes(item.label))
                        .map(item => (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#202223" }}>
                            <span>{item.isStars ? renderStars(item.label) : item.label}</span>
                            {item.count > 0 && <span style={{ color: "#8c9196" }}>({item.count})</span>}
                          </div>
                        ))
                      }
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "16px", borderBottom: "1px solid #e1e3e5", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5c5f62" }}><path d="M12 16a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 0 1 0-1.414l5-5a.999.999 0 1 1 1.414 1.414L8.414 10l4.293 4.293A.999.999 0 0 1 12 16" /></svg>
                        <h3 style={{ margin: 0, fontSize: "13px", fontWeight: "400", color: "#4a4c4e", textTransform: "uppercase" }}>
                          {filterTitle || "COLLECTION"}
                        </h3>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "13px", color: "#8c9196" }}>All</span>
                        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#8c9196" }}><path d="M14.707 5.293a.999.999 0 0 1 1.414 1.414l-7.5 7.5a.997.997 0 0 1-1.414 0l-3.5-3.5a.999.999 0 1 1 1.414-1.414L8 12.086l6.707-6.793z"/><path d="M18.707 5.293a.999.999 0 0 1 1.414 1.414l-9 9a.997.997 0 0 1-1.414 0l-1.5-1.5a.999.999 0 1 1 1.414-1.414l.793.793 8.293-8.293z"/></svg>
                      </div>
                    </div>

                    <div style={{ 
                      display: "flex", 
                      flexDirection: "column", 
                      gap: "24px",
                      maxHeight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") && advanced.maxHeight ? advanced.maxHeight : "none", 
                      overflowY: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "auto" : "visible"
                    }}>
                      {["vendor", "collection", "product_type", "tags", "color", "denominations", "title", "inventory_locations"].includes(optionType) && advanced.mobileSearchBox && (
                        <input 
                          type="text" 
                          placeholder="Filter options" 
                          style={{ padding: "8px 12px", borderRadius: "4px", border: "1px solid #e1e3e5", fontSize: "14px", marginBottom: "8px" }} 
                        />
                      )}
                      {currentOptionsData
                        .filter(item => !excludedValues.includes(item.label))
                        .map(item => (
                          <div key={item.label} style={{ display: "flex", gap: "4px", fontSize: "13px", color: "#202223" }}>
                            <span>{item.isStars ? renderStars(item.label) : item.label}</span>
                            {item.count > 0 && <span style={{ color: "#c9cccf" }}>({item.count})</span>}
                          </div>
                        ))
                      }
                    </div>
                  </>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: "12px", borderTop: "1px solid #e1e3e5", background: "#fff" }}>
          <Button variant="default" onClick={onClose} style={{ borderRadius: "20px", padding: "8px 24px", color: "#8c9196", border: "1px solid #e1e3e5" }}>
            CANCEL
          </Button>
          <Button 
            variant="primary" 
            onClick={() => onSave({ 
              filterId: initialData?.id,
              optionType, prefix, filterTitle, navCollections, childType, mainCollections, keepMainCollectionsUnchanged, multipleSelection, narrowDown, useManualValues, excludedValues, manualValues, sortManualValues, advanced,
              displayMode, priceRanges, saleRanges, weightRanges, reviewRanges, stockStatusConfig, ratingColor
            })}
            style={{ borderRadius: "20px", padding: "8px 24px", background: "#007bff", border: "none" }}
          >
            {initialData ? "UPDATE" : "CREATE"}
          </Button>
        </div>

      </div>
    </div>
  );
}
