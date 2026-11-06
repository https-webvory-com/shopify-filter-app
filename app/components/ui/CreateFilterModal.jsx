import React, { useState,useEffect } from "react";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

import Tooltip from "./Tooltip";
import { normalizeSwatchHex } from '../../utils/swatchColor.js';
import { navigationCollectionsHelp } from '../../utils/collectionNavigation.js';

const TooltipIcon = ({ content }) => (
  <Tooltip content={content}>
    <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#e4e5e7", color: "#6d7175", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #c9cccf", cursor: "help", fontWeight: "bold" }}>?</div>
  </Tooltip>
);

const OPTION_TYPES = [
  { value: "collection", label: "Collection" },
  { value: "vendor", label: "Vendor" },
  { value: "product_type", label: "Product type" },
  { value: "tag", label: "Tag" },
  { value: "color", label: "Color (product option)" },
  { value: "title", label: "Title" },
  { value: "price", label: "Price" },
  { value: "percent_sale", label: "Percent sale" },
  { value: "stock_status", label: "Stock status" },
  { value: "inventory_locations", label: "Inventory locations" },
  { value: "weight", label: "Weight (grams)" },
  { value: "review_rating", label: "Review rating" },
];

const OptionTypeDropdown = ({ value, onChange, storeData }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const dropdownRef = React.useRef(null);
    
    // Generate dynamic option types from storeData
    const dynamicTypes = storeData?.options 
      ? Object.keys(storeData.options).map(key => ({
          value: key,
          label: `${key.charAt(0).toUpperCase() + key.slice(1)} (product option)`
        }))
      : [];
      
    // Merge predefined with dynamic (avoiding duplicates)
    const predefinedKeysLower = OPTION_TYPES.map(o => o.value.toLowerCase());
    const combinedOptions = [
      ...OPTION_TYPES,
      ...dynamicTypes.filter(d => !predefinedKeysLower.includes(d.value.toLowerCase()))
    ];

    const selectedLabel = combinedOptions.find(o => (o.value || "").toLowerCase() === (value || "").toLowerCase())?.label || "Select";
    
    const filteredOptions = combinedOptions.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%" }} ref={dropdownRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", boxSizing: "border-box" }}
      >
        {selectedLabel}
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor", transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s" }}><path d="M10 14a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 1 1 1.414-1.414L10 11.586l4.293-4.293a.999.999 0 1 1 1.414 1.414l-5 5A.997.997 0 0 1 10 14z"/></svg>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(91, 33, 182, 0.04)", borderRadius: "10px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5B21B6", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#1E1B4B", width: "100%", fontSize: "14px" }}
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

const MultiSelectDropdown = ({ value, onChange, options, placeholder = "Select values", renderTagsOutside = false, prefixLabel = "" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = React.useRef(null);
  
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = (opt) => {
    if (value.includes(opt)) {
      onChange(value.filter(v => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%" }} ref={dropdownRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "40px", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", boxSizing: "border-box" }}>
          {prefixLabel && (<span style={{ color: "#202223", fontWeight: "normal", fontSize: "14px" }}>{prefixLabel}</span>)}
          {value.length === 0 || renderTagsOutside ? <span style={{ opacity: 0.7, color: "#5B21B6", fontWeight: "normal" }}>{placeholder}</span> : value.map(v => (
            <span key={v} style={{ background: "rgba(91, 33, 182, 0.08)", padding: "2px 8px", borderRadius: "12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
              {v}
              <span onClick={(e) => { e.stopPropagation(); handleToggle(v); }} style={{ cursor: "pointer", marginLeft: "2px", fontWeight: "bold" }}>×</span>
            </span>
          ))}
        </div>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(91, 33, 182, 0.04)", borderRadius: "10px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5B21B6", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#1E1B4B", width: "100%", fontSize: "14px" }}
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
  const dropdownRef = React.useRef(null);
  
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%" }} ref={dropdownRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "40px", boxSizing: "border-box" }}
      >
        <span style={{ color: value ? "#5B21B6" : "rgba(91, 33, 182, 0.7)", fontWeight: value ? "500" : "normal" }}>
          {value || placeholder}
        </span>
        <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor", transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s", flexShrink: 0 }}><path d="M10 14a.997.997 0 0 1-.707-.293l-5-5a.999.999 0 1 1 1.414-1.414L10 11.586l4.293-4.293a.999.999 0 1 1 1.414 1.414l-5 5A.997.997 0 0 1 10 14z"/></svg>
      </div>
      
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", background: "#fff", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #e1e3e5", zIndex: 1000, padding: "12px 0", maxHeight: "350px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px 12px 12px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(91, 33, 182, 0.04)", borderRadius: "10px", padding: "8px 16px" }}>
              <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5B21B6", marginRight: "8px" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
              <input 
                type="text" 
                placeholder="Filter" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", outline: "none", color: "#1E1B4B", width: "100%", fontSize: "14px" }}
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
  const dropdownRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative", width }} ref={dropdownRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", boxSizing: "border-box" }}
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
  
  // Slider Config State (for Range display mode)
  const [sliderConfig, setSliderConfig] = useState({
    sliderRange: 4,
    sliderStep: 0.1,
    decimals: 0,
    rangeFormat: "{0} - {1}",
    sliderColor: "#5B21B6",
    sliderValueSymbols: "k,M,G,T,P,E",
    sliderPrefix: "",
    sliderSuffix: "",
    showInputPrefixSuffix: true,
    valueFormula: ""
  });
  

  // Navigation Collections State
  const [childType, setChildType] = useState("Select child type");
  const [mainCollections, setMainCollections] = useState([{ id: Date.now(), collection: "" }]);
  const [keepMainCollectionsUnchanged, setKeepMainCollectionsUnchanged] = useState(false);

  // Swatch State
  const [swatchConfig, setSwatchConfig] = useState({
    circleSwatch: true,
    showLabel: false,
    layout: "Grid",
    colors: {}
  });
  const invalidSwatchColors = Object.entries(swatchConfig.colors || {}).filter(([, color]) => color?.type === 'color' && color.value && !normalizeSwatchHex(color.value));
  const savedSwatchConfig = { ...swatchConfig, colors: Object.fromEntries(Object.entries(swatchConfig.colors || {}).map(([label, color]) => [label, color?.type === 'color' && normalizeSwatchHex(color.value) ? { ...color, value: normalizeSwatchHex(color.value) } : color])) };
  const [swatchSearch, setSwatchSearch] = useState("");
  const [selectedSwatch, setSelectedSwatch] = useState(null);
  const [hoveredSwatch, setHoveredSwatch] = useState(null);
  // Preview State
  const [device, setDevice] = useState("desktop");
  const [layout, setLayout] = useState("sidebar");
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [draggedManualIndex, setDraggedManualIndex] = useState(null);

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
        if (initialData.displayMode) {
          const mode = initialData.displayMode;
          setDisplayMode(mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase());
        } else {
          setDisplayMode("List");
        }
        
        if (initialData.priceRanges) setPriceRanges(initialData.priceRanges.map(r => ({ ...r, from: r.from !== undefined ? r.from : (r.min || ""), to: r.to !== undefined ? r.to : (r.max || "") })));
        if (initialData.saleRanges) setSaleRanges(initialData.saleRanges);
        if (initialData.weightRanges) setWeightRanges(initialData.weightRanges);
        if (initialData.reviewRanges) setReviewRanges(initialData.reviewRanges);
        if (initialData.stockStatusConfig) setStockStatusConfig(initialData.stockStatusConfig);
        if (initialData.ratingColor) setRatingColor(initialData.ratingColor);
        if (initialData.sliderConfig) setSliderConfig(initialData.sliderConfig);
        setSwatchConfig({ circleSwatch: true, showLabel: false, layout: "Grid", colors: {}, ...initialData.swatchConfig });

        if (initialData.advanced) {
          setAdvanced(prev => ({ ...prev, ...initialData.advanced }));
        }
      } else {
        setSwatchConfig({ circleSwatch: true, showLabel: false, layout: "Grid", colors: {} });
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
          inStock: { enabled: true, label: "In stock" },
          stockOnHand: { enabled: true, label: "Stock On Hand" },
          preOrder: { enabled: true, label: "Pre-Order" },
          outOfStock: { enabled: false, label: "Out of stock" }
        });
        setRatingColor("#ffff00");
        setSwatchConfig({
          circleSwatch: true,
          showLabel: false,
          layout: "Grid",
          colors: {}
        });
        setSliderConfig({
          sliderRange: 4,
          sliderStep: 0.1,
          decimals: 0,
          rangeFormat: "{0} - {1}",
          sliderColor: "#5B21B6",
          sliderValueSymbols: "k,M,G,T,P,E",
          sliderPrefix: "",
          sliderSuffix: "",
          showInputPrefixSuffix: true,
          valueFormula: ""
        });
      }
      setSelectedSwatch(null);
      setSwatchSearch("");
      setActiveTab("general");
      setPreviewCollapsed(false);
    }
  }, [isOpen, initialData]);

  useEffect(() => {
    if (isOpen && optionType === 'price') setDisplayMode(storeData.priceFilterDisplayMode === 'Range' ? 'Range' : 'List');
  }, [isOpen, optionType, storeData.priceFilterDisplayMode]);

  const DUMMY_DATA = {
    collection: (shopifyCollections || []).map(c => ({ label: c, count: 0 })),
    vendor: (storeData?.vendors || []).map(v => ({ label: v.value, count: v.count })),
    product_type: (storeData?.productTypes || []).map(p => ({ label: p.value, count: p.count })),
    tag: (storeData?.tags || []).map(t => ({ label: t.value, count: t.count })),
    tags: (storeData?.tags || []).map(t => ({ label: t.value, count: t.count })),
    title: (storeData?.titles || []).map(t => ({ label: t.value, count: t.count })),
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

    // If it's a known top-level type, return its data (case-insensitive lookup)
    const typeKey = Object.keys(DUMMY_DATA).find(k => k.toLowerCase() === type.toLowerCase());
    if (typeKey && DUMMY_DATA[typeKey] && DUMMY_DATA[typeKey].length > 0) return DUMMY_DATA[typeKey];
    
    // Check if it's a dynamic option type (like 'color', 'size', 'title', 'Denominations')
    if (storeData?.options) {
      const matchedKey = Object.keys(storeData.options).find(k => k.toLowerCase() === type.toLowerCase());
      if (matchedKey && storeData.options[matchedKey]) {
        return storeData.options[matchedKey].map(v => ({ label: v.value, count: v.count }));
      }
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
  const currentOptionsLabels = currentOptionsData
    .map((o, idx) => {
      if (!prefix) return o.label;
      if (!o.label.startsWith("Sample ")) return o.label;
      if (prefix === "Style_") {
        const styles = ["Simple", "Casual", "Modern", "Classic", "Timeless", "Formal"];
        if (idx < styles.length) return `${prefix}${styles[idx]}`;
      }
      return `${prefix}${o.label.replace("Sample ", "")}`;
    })
    .filter(label => !prefix || label.toLowerCase().startsWith(prefix.toLowerCase()));

  const previewOptionsData = (() => {
    if (navCollections && optionType?.toLowerCase() === 'collection') {
      return mainCollections.filter(item => item.collection).map(item => ({label:item.collection,displayLabel:item.collection}));
    }
    let filtered = currentOptionsData;
    if (prefix) {
      filtered = filtered.map((o, idx) => {
        if (!o.label.startsWith("Sample ")) return o;
        if (prefix === "Style_") {
          const styles = ["Simple", "Casual", "Modern", "Classic", "Timeless", "Formal"];
          if (idx < styles.length) return { ...o, label: `${prefix}${styles[idx]}` };
        }
        return { ...o, label: `${prefix}${o.label.replace("Sample ", "")}` };
      });
    }
    if (prefix) filtered = filtered.filter(item => item.label.toLowerCase().startsWith(prefix.toLowerCase()));
    if (useManualValues) {
       if (manualValues.length > 0) filtered = filtered.filter(item => manualValues.includes(item.label));
    } else {
       if (excludedValues.length > 0) filtered = filtered.filter(item => !excludedValues.includes(item.label));
    }
    return filtered.map(item => {
       let displayLabel = item.label;
       if (prefix && displayLabel.toLowerCase().startsWith(prefix.toLowerCase())) displayLabel = displayLabel.slice(prefix.length);
       return { ...item, displayLabel };
    });
  })();

  const renderStars = (ratingStr) => {
    const num = parseInt(ratingStr);
    if (isNaN(num)) return ratingStr;
    return (
      <div style={{ display: "flex", gap: "2px", alignItems: "center", boxSizing: "border-box" }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <svg key={star} viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: star <= num ? "#FFC107" : "transparent", stroke: "#FFC107", strokeWidth: "1.5px" }}>
            <path d="M10 1.3l2.388 6.722h7.312l-5.938 4.056 2.388 6.722-5.938-4.056-5.938 4.056 2.388-6.722-5.938-4.056h7.312z" />
          </svg>
        ))}
      </div>
    );
  };

  const getColorHex = (colorName) => {
    const colors = {
      black: '#1a1a1a', white: '#ffffff', red: '#e63946', blue: '#4361ee', green: '#2a9d8f', yellow: '#e9c46a', orange: '#f4a261', pink: '#ffb5a7', grey: '#8d99ae', gray: '#8d99ae', purple: '#7209b7', brown: '#6c584c'
    };
    return colors[colorName.toLowerCase()] || colorName;
  };

  const renderSliderPreview = (isTopLayout, currentDevice = "desktop") => {
    const { sliderRange, sliderColor, sliderValueSymbols, sliderPrefix, sliderSuffix, showInputPrefixSuffix } = sliderConfig;
    const ticks = [];
    const intervals = parseInt(sliderRange) > 0 ? parseInt(sliderRange) : 4;
    const points = intervals + 1;
    const maxVal = 1000000;
    
    const formatValue = (val) => {
      if (val === 0) return '0';
      if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.0', '') + 'M';
      if (val >= 1000) return (val / 1000).toFixed(1).replace('.0', '') + 'k';
      return val.toFixed(1).replace('.0', '');
    };

    for (let i = 0; i < points; i++) {
      const percent = (i / (points - 1)) * 100;
      const val = (i / (points - 1)) * maxVal;
      ticks.push(
        <div key={i} style={{ position: "absolute", left: `${percent}%`, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", top: "4px" }}>
          <div style={{ width: "1px", height: "6px", background: sliderColor || "#202223", marginBottom: "4px" }}></div>
          <span style={{ fontSize: "10px", color: "#202223", fontWeight: "400" }}>{sliderPrefix}{formatValue(val)}{sliderSuffix}</span>
        </div>
      );
    }

    const hasBorderBox = currentDevice === "desktop" && isTopLayout;
    const showTooltipArrow = currentDevice === "desktop" && isTopLayout;

    return (
      <div style={{ 
        display: "flex", flexDirection: "column", gap: "28px", 
        padding: hasBorderBox ? "16px" : "12px 0",
        background: hasBorderBox ? "#ffffff" : "transparent",
        borderRadius: hasBorderBox ? "8px" : "0",
        border: hasBorderBox ? "1px solid #e1e3e5" : "none",
        boxShadow: showTooltipArrow ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
        position: "relative",
        marginTop: showTooltipArrow ? "8px" : "0",
        paddingBottom: "32px"
      }}>
        {showTooltipArrow && (
          <div style={{ position: "absolute", top: "-6px", left: "20px", width: "10px", height: "10px", background: "#fff", borderTop: "1px solid #e1e3e5", borderLeft: "1px solid #e1e3e5", transform: "rotate(45deg)" }}></div>
        )}
        
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1, position: "relative" }}>
            {showInputPrefixSuffix && sliderPrefix && <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: "13px" }}>{sliderPrefix}</span>}
            <input type="text" value="0" readOnly style={{ width: "100%", padding: `8px 12px`, paddingLeft: showInputPrefixSuffix && sliderPrefix ? "24px" : "12px", paddingRight: showInputPrefixSuffix && sliderSuffix ? "24px" : "12px", borderRadius: "4px", border: "1px solid #c9cccf", fontSize: "13px", color: "#202223", textAlign: "center" }} />
            {showInputPrefixSuffix && sliderSuffix && <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: "13px" }}>{sliderSuffix}</span>}
          </div>
          <span style={{ color: "#202223", fontWeight: "400" }}>-</span>
          <div style={{ flex: 1, position: "relative" }}>
            {showInputPrefixSuffix && sliderPrefix && <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: "13px" }}>{sliderPrefix}</span>}
            <input type="text" value={maxVal} readOnly style={{ width: "100%", padding: `8px 12px`, paddingLeft: showInputPrefixSuffix && sliderPrefix ? "24px" : "12px", paddingRight: showInputPrefixSuffix && sliderSuffix ? "24px" : "12px", borderRadius: "4px", border: "1px solid #c9cccf", fontSize: "13px", color: "#202223", textAlign: "center" }} />
            {showInputPrefixSuffix && sliderSuffix && <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#6d7175", fontSize: "13px" }}>{sliderSuffix}</span>}
          </div>
        </div>

        <div style={{ padding: "0 10px", marginTop: "4px" }}>
          <div style={{ position: "relative", height: "2px", background: sliderColor || "#202223" }}>
            <div style={{ position: "absolute", left: "0%", top: "50%", transform: "translate(-50%, -50%)", width: "18px", height: "18px", background: "#fff", border: `2px solid ${sliderColor || "#202223"}`, borderRadius: "50%", cursor: "pointer", zIndex: 2 }}></div>
            <div style={{ position: "absolute", left: "100%", top: "50%", transform: "translate(-50%, -50%)", width: "18px", height: "18px", background: "#fff", border: `2px solid ${sliderColor || "#202223"}`, borderRadius: "50%", cursor: "pointer", zIndex: 2 }}></div>
            {ticks}
          </div>
        </div>
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

  // Older Color/Size groups stored alphabetical as the default, even though
  // merchants had not selected an order. Show their new automatic order here.
  const optionSortType = ["color", "size"].includes(optionType?.toLowerCase()) &&
    !advanced.sortModeExplicit && (!advanced.sortType || advanced.sortType === "Label - AZ")
    ? "Automatic" : advanced.sortType;
  if (optionSortType === "Automatic" && optionType?.toLowerCase() === "color") {
    currentOptionsData.sort((a, b) => (b.count || 0) - (a.count || 0) || a.label.localeCompare(b.label));
  } else if (optionSortType === "Automatic" && optionType?.toLowerCase() === "size") {
    const names = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"];
    const rank = label => {
      const text = String(label || "").trim().toUpperCase();
      const name = names.indexOf(text);
      if (name >= 0) return [0, name];
      const match = /^(\d{1,2})(P|W)?$/.exec(text);
      return match && Number(match[1]) <= 30
        ? [1, Number(match[1]) * 3 + (match[2] === "P" ? 1 : match[2] === "W" ? 2 : 0)] : [2, 0];
    };
    currentOptionsData.sort((a, b) => {
      const left = rank(a.value || a.label), right = rank(b.value || b.label);
      return left[0] - right[0] || left[1] - right[1] || a.label.localeCompare(b.label);
    });
  } else if (optionSortType === "Label - AZ") {
    currentOptionsData.sort((a, b) => a.label.localeCompare(b.label));
  } else if (optionSortType === "Label - ZA") {
    currentOptionsData.sort((a, b) => b.label.localeCompare(a.label));
  } else if (optionSortType === "Product count - Highest to lowest") {
    currentOptionsData.sort((a, b) => b.count - a.count);
  } else if (optionSortType === "Product count - Lowest to highest") {
    currentOptionsData.sort((a, b) => a.count - b.count);
  }

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
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
        onClick={(e) => e.stopPropagation()}
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
          <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(30, 27, 75, 0.12)", cursor: "pointer", padding: 0 }}>
            <svg viewBox="0 0 20 20" style={{ width: "20px", height: "20px", fill: "#5c5f62" }}>
              <path d="M11.414 10l4.293-4.293a1 1 0 1 0-1.414-1.414L10 8.586 5.707 4.293a1 1 0 0 0-1.414 1.414L8.586 10l-4.293 4.293a1 1 0 1 0 1.414 1.414L10 11.414l4.293 4.293a1 1 0 0 0 1.414-1.414L11.414 10z" />
            </svg>
          </button>
        </div>

        {/* Tabs and Preview Toggle */}
        <style>{`
          .custom-scrollbar-container::-webkit-scrollbar {
            width: 6px !important;
          }
          .custom-scrollbar-container::-webkit-scrollbar-track {
            background: rgba(30, 27, 75, 0.02) !important;
            border-radius: 10px !important;
          }
          .custom-scrollbar-container::-webkit-scrollbar-thumb {
            background: rgba(30, 27, 75, 0.15) !important;
            border-radius: 10px !important;
            transition: background 0.2s ease !important;
          }
          .custom-scrollbar-container::-webkit-scrollbar-thumb:hover {
            background: #5B21B6 !important;
          }
          .custom-scrollbar-container {
            scrollbar-width: thin !important;
            scrollbar-color: rgba(30, 27, 75, 0.15) rgba(30, 27, 75, 0.02) !important;
          }
        `}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px", borderBottom: "1px solid #e1e3e5", background: "#fcfcfc" }}>
          <div style={{ display: "flex", gap: "24px" }}>
            <div 
              onClick={() => setActiveTab("general")}
              style={{ padding: "12px 0", cursor: "pointer", color: activeTab === "general" ? "#5B21B6" : "#6d7175", borderBottom: activeTab === "general" ? "3px solid #5B21B6" : "3px solid transparent", fontWeight: activeTab === "general" ? "600" : "500", fontSize: "14px" }}
            >
              General
            </div>
            <div 
              onClick={() => setActiveTab("advanced")}
              style={{ padding: "12px 0", cursor: "pointer", color: activeTab === "advanced" ? "#5B21B6" : "#6d7175", borderBottom: activeTab === "advanced" ? "3px solid #5B21B6" : "3px solid transparent", fontWeight: activeTab === "advanced" ? "600" : "500", fontSize: "14px" }}
            >
              Advanced
            </div>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: "8px" }}>
              <div style={{ position: "relative", width: "36px", height: "20px" }}>
                <input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, backgroundColor: showPreview ? "#5B21B6" : "#8c9196", borderRadius: "34px", transition: "0.2s" }}>
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
          <div className="custom-scrollbar-container" style={{ flex: 1, padding: "24px", paddingBottom: "250px", overflowY: "auto", overflowX: "hidden", borderRight: showPreview ? "1px solid #e1e3e5" : "none" }}>
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
                    storeData={storeData}
                    onChange={(val, label) => {
                      // If the current title matches the old option type label, update it to the new one
                      let oldLabel = "Collection";
                      if (OPTION_TYPES.find(o => o.value === optionType)) {
                        oldLabel = OPTION_TYPES.find(o => o.value === optionType).label;
                      } else if (storeData?.options && storeData.options[optionType]) {
                        oldLabel = optionType.charAt(0).toUpperCase() + optionType.slice(1);
                      }
                      oldLabel = oldLabel.replace(" (product option)", "");
                      if (filterTitle === oldLabel) {
                        setFilterTitle(label.replace(" (product option)", ""));
                      }
                      setOptionType(val);
                      
                      // Check if current display mode is valid for the new option type
                      const validModes = ["price", "percent_sale", "weight", "review_rating"].includes(val) ? ["List", "Range"] : ["List", "Box", "Swatch"];
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
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
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
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                    />
                    {filterTitle && (
                      <button 
                        onClick={() => setFilterTitle("")}
                        style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "rgba(91, 33, 182, 0.08)", color: "#5B21B6", border: "1px solid rgba(30, 27, 75, 0.12)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px" }}
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
                  {optionType === 'price' ? <div>
                    <p style={{margin:'0 0 6px',fontSize:14}}>{storeData.priceFilterDisplayMode === 'Range' ? 'Range slider' : 'Checkboxes'}</p>
                    <a href="/app/filters/settings" style={{fontSize:13}}>Change Price filter style in Filters settings</a>
                  </div> : <SimpleDropdown
                    value={displayMode} 
                    onChange={setDisplayMode} 
                    options={
                      ["price", "percent_sale", "weight", "review_rating"].includes(optionType?.toLowerCase()) ? ["List", "Range"]
                      : ["List", "Box", "Swatch"]
                    } 
                    width="100%"
                  />}
                </div>

                {/* Navigation Collections */}
                {optionType?.toLowerCase() === "collection" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: navCollections ? "12px" : "0", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Checkbox aria-label="Navigation collections" checked={navCollections} onChange={setNavCollections} />
                      <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Navigation collections</span>
                      <TooltipIcon content={navigationCollectionsHelp} />
                    </div>
                    {navCollections && (
                      <SimpleDropdown 
                        value={childType} 
                        onChange={setChildType} 
                        options={["None", "Tags", "Collections", "Hyperlink"]} 
                      />
                    )}
                  </div>
                )}

                {navCollections && optionType?.toLowerCase() === "collection" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginLeft: "28px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Main collection</label>
                      <TooltipIcon content="Choose the destination collections shown as links in the storefront filter. This does not assign the filter group to those pages; page assignment is set in Filter group information." />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {mainCollections.map((mc, index) => (
                        <div key={mc.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {/* Drag handle */}
                          <div style={{ color: "#5B21B6", cursor: "grab", display: "flex", flexDirection: "column", gap: "3px" }}>
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
                            style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #5B21B6", background: "#fff", color: "#5B21B6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
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
                        style={{ borderRadius: "10px", padding: "6px 16px", fontSize: "13px", background: "#5B21B6", border: "1px solid rgba(30, 27, 75, 0.12)", display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        <span style={{ fontSize: "16px" }}>+</span> Add item
                      </Button>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", marginBottom: "8px" }}>
                      <Checkbox checked={keepMainCollectionsUnchanged} onChange={setKeepMainCollectionsUnchanged} />
                      <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Keep main collections unchanged</span>
                      <TooltipIcon content="When checked, the main collections will remain unchanged when navigating to child collections." />
                    </div>
                  </div>
                )}

                {/* Values Section */}
                {!(navCollections && optionType?.toLowerCase() === 'collection') && <div style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "600", color: "#202223" }}>Values</span>
                    <Tooltip content="To merge values, go to App settings / Merged values.">
                      <a href="#" style={{ fontSize: "13px", color: "#5B21B6", textDecoration: "none" }}>(want to merge values?)</a>
                    </Tooltip>
                  </div>
                  
                  {["price", "percent_sale", "weight", "review_rating"].includes(optionType?.toLowerCase()) ? (
                    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      
                      {displayMode === "Range" ? (
                        <>
                          <div style={{ display: "flex", gap: "20px" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider range</label>
                                <TooltipIcon content="Number of range intervals shown below the slider." />
                              </div>
                              <input type="number" value={sliderConfig.sliderRange} onChange={e => setSliderConfig({...sliderConfig, sliderRange: Number(e.target.value)})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider step</label>
                                <TooltipIcon content="Step increment for the slider." />
                              </div>
                              <input type="number" step="0.1" value={sliderConfig.sliderStep} onChange={e => setSliderConfig({...sliderConfig, sliderStep: Number(e.target.value)})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Decimals</label>
                                <TooltipIcon content="Number of decimal places." />
                              </div>
                              <input type="number" value={sliderConfig.decimals} onChange={e => setSliderConfig({...sliderConfig, decimals: Number(e.target.value)})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                              <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Range format</label>
                              <TooltipIcon content="Format using {0} for from and {1} for to." />
                            </div>
                            <input type="text" value={sliderConfig.rangeFormat} onChange={e => setSliderConfig({...sliderConfig, rangeFormat: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                          </div>
                          
                          <div style={{ display: "flex", gap: "20px" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider color</label>
                                <TooltipIcon content="Color of the active slider track." />
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#ffffff", borderRadius: "10px", padding: "4px 16px", border: "1px solid transparent" }}>
                                <input type="text" value={sliderConfig.sliderColor} onChange={e => setSliderConfig({...sliderConfig, sliderColor: e.target.value})} style={{ flex: 1, border: "1px solid rgba(30, 27, 75, 0.12)", background: "transparent", fontSize: "13px", color: "#5B21B6", padding: "6px 0", outline: "none", boxSizing: "border-box" }} />
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <div style={{ position: "relative", width: "16px", height: "16px", borderRadius: "2px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.1)" }}>
                                    <input type="color" value={sliderConfig.sliderColor || "#5B21B6"} onChange={e => setSliderConfig({...sliderConfig, sliderColor: e.target.value})} style={{ position: "absolute", top: "-10px", left: "-10px", width: "40px", height: "40px", cursor: "pointer", border: "1px solid rgba(30, 27, 75, 0.12)", padding: 0 }} />
                                  </div>
                                  <div style={{ position: "relative" }}>
                                    <input type="color" value={sliderConfig.sliderColor || "#5B21B6"} onChange={e => setSliderConfig({...sliderConfig, sliderColor: e.target.value})} style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
                                    <svg viewBox="0 0 20 20" style={{ width: "12px", height: "12px", fill: "#5B21B6" }}>
                                      <path d="M2 14.5v3.5h3.5l10.19-10.19-3.5-3.5L2 14.5zm16.14-9.8c.2-.2.2-.51 0-.71l-2.79-2.79c-.2-.2-.51-.2-.71 0l-1.68 1.68 3.5 3.5 1.68-1.68z" />
                                    </svg>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider value symbols</label>
                                <TooltipIcon content="Symbols for large numbers, e.g., k,M,G,T,P,E" />
                              </div>
                              <input type="text" value={sliderConfig.sliderValueSymbols} onChange={e => setSliderConfig({...sliderConfig, sliderValueSymbols: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: "20px" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider prefix</label>
                                <TooltipIcon content="Prefix for slider inputs, e.g., $" />
                              </div>
                              <input type="text" value={sliderConfig.sliderPrefix} onChange={e => setSliderConfig({...sliderConfig, sliderPrefix: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Slider suffix</label>
                                <TooltipIcon content="Suffix for slider inputs." />
                              </div>
                              <input type="text" value={sliderConfig.sliderSuffix} onChange={e => setSliderConfig({...sliderConfig, sliderSuffix: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <Checkbox checked={sliderConfig.showInputPrefixSuffix} onChange={val => setSliderConfig({...sliderConfig, showInputPrefixSuffix: val})} />
                            <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6" }}>Show slider input prefix & suffix</label>
                            <TooltipIcon content="Show the prefix and suffix in the input boxes as well." />
                          </div>

                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                              <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175" }}>Value formula</label>
                              <TooltipIcon content="Custom formula for calculating the value." />
                            </div>
                            <input type="text" value={sliderConfig.valueFormula} onChange={e => setSliderConfig({...sliderConfig, valueFormula: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                          </div>
                        </>
                      ) : (
                        <>
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
                          <div key={range.id} style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box" }}>
                            <input 
                              style={{ flex: 1, padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px", fontWeight: "500", width: "100%" }}
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
                                style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", fontSize: "13px", fontWeight: "600", color: "#202223" }} 
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
                                style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: range.to !== "" ? "#ffffff" : "transparent", fontSize: "13px", color: "#202223", visibility: range.to !== "" ? "visible" : "hidden" }} 
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
                                style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #5B21B6", background: "#fff", color: "#5B21B6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "18px" }}
                              >
                                +
                              </button>
                              <button 
                                onClick={() => setRanges(ranges.filter(r => r.id !== range.id))}
                                style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid #5B21B6", background: "#fff", color: "#5B21B6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                              >
                                <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M16 6H4a1 1 0 1 0 0 2h1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8h1a1 1 0 1 0 0-2zM9 4a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2H9zm2 12h2V8h-2v8zm-4 0h2V8H7v8z"/></svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      </>
                      )}
                      {optionType === "review_rating" && (
                        <div style={{ marginTop: "16px" }}>
                          <label style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175", display: "block", marginBottom: "8px" }}>Rating color</label>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#ffffff", borderRadius: "10px", padding: "4px 16px" }}>
                            <input 
                              style={{ flex: 1, border: "1px solid rgba(30, 27, 75, 0.12)", background: "transparent", fontSize: "13px", color: "#5B21B6", padding: "8px 0", outline: "none", boxSizing: "border-box" }}
                              value={ratingColor}
                              onChange={(e) => setRatingColor(e.target.value)}
                            />
                            <div style={{ width: "16px", height: "16px", background: ratingColor, border: "1px solid rgba(0,0,0,0.1)", borderRadius: "2px" }}></div>
                            <svg viewBox="0 0 20 20" style={{ width: "14px", height: "14px", fill: "#5B21B6", cursor: "pointer" }}><path d="M12.3 3.7l4 4L4 20H0v-4L12.3 3.7zm1.4-1.4L16 0l4 4-2.3 2.3-4-4z"/></svg>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : optionType === "stock_status" ? (
                    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
                      
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Checkbox checked={stockStatusConfig.inStock.enabled} onChange={(val) => setStockStatusConfig({...stockStatusConfig, inStock: {...stockStatusConfig.inStock, enabled: val}})} />
                          <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "600" }}>Show in stock filter option</span>
                        </div>
                        {stockStatusConfig.inStock.enabled && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                            <input 
                              style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px" }}
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
                              <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Stock On Hand</span>
                              <TooltipIcon content="Products currently physically in stock" />
                            </div>
                            {stockStatusConfig.stockOnHand.enabled && (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                                <input 
                                  style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px" }}
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
                              <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Pre-Order</span>
                              <TooltipIcon content="Products available for pre-order" />
                            </div>
                            {stockStatusConfig.preOrder.enabled && (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                                <input 
                                  style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px" }}
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
                          <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Show out of stock filter option</span>
                        </div>
                        {stockStatusConfig.outOfStock.enabled && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "200px" }}>
                            <input 
                              style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px" }}
                              value={stockStatusConfig.outOfStock.label}
                              onChange={(e) => setStockStatusConfig({...stockStatusConfig, outOfStock: {...stockStatusConfig.outOfStock, label: e.target.value}})}
                            />
                            <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#e1e3e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", cursor: "pointer" }}>×</div>
                          </div>
                        )}
                      </div>

                    </div>
                  ) : displayMode === "Swatch" ? (
                    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setSwatchConfig({...swatchConfig, circleSwatch: !swatchConfig.circleSwatch})}>
                            <span style={{ position: "absolute", inset: 0, backgroundColor: swatchConfig.circleSwatch ? "#5B21B6" : "#e1e3e5", borderRadius: "34px", transition: "0.2s" }}>
                              <span style={{ position: "absolute", height: "14px", width: "14px", left: swatchConfig.circleSwatch ? "19px" : "3px", bottom: "3px", backgroundColor: "white", borderRadius: "50%", transition: "0.2s" }} />
                            </span>
                          </div>
                          <span style={{ fontSize: "14px", color: "#202223", fontWeight: "500" }}>{swatchConfig.circleSwatch ? "Circle swatch" : "Rectangle swatch"}</span>
                        </div>
                        <div style={{ position: "relative", width: "250px" }}>
                          <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#5B21B6", position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293l-4.82-4.82A5.968 5.968 0 0 0 14 8a6 6 0 1 0-6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z"/></svg>
                          <input 
                            type="text"
                            placeholder="Search swatch value"
                            value={swatchSearch}
                            onChange={(e) => setSwatchSearch(e.target.value)}
                            style={{ width: "100%", padding: "8px 16px 8px 36px", borderRadius: "10px", border: "1px solid #e1e3e5", background: "#ffffff", fontSize: "13px", color: "#5B21B6", outline: "none", boxSizing: "border-box" }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setSwatchConfig({...swatchConfig, showLabel: !swatchConfig.showLabel})}>
                            <span style={{ position: "absolute", inset: 0, backgroundColor: swatchConfig.showLabel ? "#5B21B6" : "#e1e3e5", borderRadius: "34px", transition: "0.2s" }}>
                              <span style={{ position: "absolute", height: "14px", width: "14px", left: swatchConfig.showLabel ? "19px" : "3px", bottom: "3px", backgroundColor: "white", borderRadius: "50%", transition: "0.2s" }} />
                            </span>
                          </div>
                          <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Show swatch label</span>
                        </div>
                        {swatchConfig.showLabel && (
                          <div style={{ width: "150px" }}>
                            <select 
                              value={swatchConfig.layout || "Grid"} 
                              onChange={(e) => setSwatchConfig({...swatchConfig, layout: e.target.value})}
                              style={{ width: "100%", padding: "8px 12px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px", outline: "none", cursor: "pointer" }}
                            >
                              <option value="Grid">Grid</option>
                              <option value="List">List</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", padding: "10px", paddingTop: "24px", border: "1px solid #e1e3e5", borderRadius: "8px", background: "#f9fafb" }}>
                        {currentOptionsLabels.filter(l => l.toLowerCase().includes(swatchSearch.toLowerCase())).map(label => {
                          const isSelected = selectedSwatch === label;
                          const colorData = swatchConfig.colors[label];
                          return (
                            <div 
                              key={label}
                              role="button"
                              tabIndex={0}
                              aria-label={`Edit color ${label}`}
                              title={label}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSwatch(label); } }}
                              onClick={() => setSelectedSwatch(label)}
                              onMouseEnter={() => setHoveredSwatch(label)}
                              onMouseLeave={() => setHoveredSwatch(null)}
                              style={{ 
                                display: "flex", alignItems: "center", gap: "6px", cursor: "pointer",
                                padding: "4px", borderRadius: "50%",
                                background: isSelected ? "#e3f1df" : "transparent",
                                border: isSelected ? "1px solid #4caf50" : "1px solid transparent",
                                position: "relative"
                              }}
                            >
                              <div style={{ 
                                width: "32px", height: "32px", 
                                borderRadius: swatchConfig.circleSwatch ? "50%" : "4px", 
                                background: colorData?.type === "color" && colorData.value ? (normalizeSwatchHex(colorData.value) || getColorHex(label)) : (colorData?.type === "image" && colorData.value ? `url(${colorData.value}) center/cover` : getColorHex(label)),
                                border: "1px solid #c9cccf",
                                display: "flex", alignItems: "center", justifyContent: "center"
                              }}>
                              </div>
                              {hoveredSwatch === label && (
                                <div style={{
                                  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: "8px",
                                  background: "#202223", color: "#fff", fontSize: "12px", padding: "4px 8px",
                                  borderRadius: "4px", whiteSpace: "nowrap", zIndex: 10, pointerEvents: "none"
                                }}>
                                  {label}
                                  <div style={{
                                    position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%)",
                                    borderWidth: "4px 4px 0", borderStyle: "solid", borderColor: "#202223 transparent transparent transparent"
                                  }}></div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {selectedSwatch && (
                        <div style={{ padding: "16px", background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", marginTop: "8px" }}>
                          <div style={{ fontSize: "13px", color: "#202223", marginBottom: "12px" }}>
                            Assign a color or pattern to <strong>{selectedSwatch}</strong> option. For a color swatch enter a HEX value. For a pattern swatch paste an image URL.
                          </div>
                          
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#ffffff", borderRadius: "10px", padding: "4px 12px", flex: 1 }}>
                              <div style={{ position: "relative", width: "24px", height: "24px", borderRadius: "4px", overflow: "hidden", border: "1px solid #c9cccf", flexShrink: 0 }}>
                                <input 
                                  type="color" 
                                  value={swatchConfig.colors[selectedSwatch]?.type === "color" && swatchConfig.colors[selectedSwatch]?.value ? swatchConfig.colors[selectedSwatch].value : "#ffffff"} 
                                  onChange={(e) => setSwatchConfig({
                                    ...swatchConfig, 
                                    colors: { ...swatchConfig.colors, [selectedSwatch]: { type: "color", value: e.target.value } }
                                  })}
                                  style={{ position: "absolute", top: "-10px", left: "-10px", width: "50px", height: "50px", cursor: "pointer", border: "1px solid rgba(30, 27, 75, 0.12)", padding: 0 }} 
                                />
                              </div>
                              <input 
                                type="text"
                                placeholder="HEX code"
                                aria-label="HEX code"
                                aria-invalid={!!(swatchConfig.colors[selectedSwatch]?.type === "color" && swatchConfig.colors[selectedSwatch]?.value && !normalizeSwatchHex(swatchConfig.colors[selectedSwatch].value))}
                                value={swatchConfig.colors[selectedSwatch]?.type === "color" && swatchConfig.colors[selectedSwatch]?.value ? swatchConfig.colors[selectedSwatch].value : ""}
                                onChange={(e) => setSwatchConfig({
                                  ...swatchConfig, 
                                  colors: { ...swatchConfig.colors, [selectedSwatch]: { type: "color", value: e.target.value } }
                                })}
                                style={{ flex: 1, border: "1px solid rgba(30, 27, 75, 0.12)", background: "transparent", fontSize: "13px", color: "#5B21B6", outline: "none", boxSizing: "border-box" }}
                              />
                            </div>
                            <span style={{ fontSize: "13px", color: "#6d7175", fontWeight: "600" }}>OR</span>
                            <div style={{ flex: 1 }}>
                              <input 
                                type="text"
                                placeholder="https://www.my-site.com/my-image.png"
                                value={swatchConfig.colors[selectedSwatch]?.type === "image" && swatchConfig.colors[selectedSwatch]?.value ? swatchConfig.colors[selectedSwatch].value : ""}
                                onChange={(e) => setSwatchConfig({
                                  ...swatchConfig, 
                                  colors: { ...swatchConfig.colors, [selectedSwatch]: { type: "image", value: e.target.value } }
                                })}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", marginTop: "16px" }}>
                        <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setUseManualValues(!useManualValues)}>
                          <span style={{ position: "absolute", inset: 0, backgroundColor: useManualValues ? "#5B21B6" : "#e1e3e5", borderRadius: "34px", transition: "0.2s" }}>
                            <span style={{ position: "absolute", height: "14px", width: "14px", left: useManualValues ? "19px" : "3px", bottom: "3px", backgroundColor: "white", borderRadius: "50%", transition: "0.2s" }} />
                          </span>
                        </div>
                        <span style={{ fontSize: "13px", color: useManualValues ? "#202223" : "#6d7175" }}>
                          {useManualValues ? "The manual values below are shown to your customers" : `No manual values. Your customers see all ${filterTitle || "Color (product option)"} values.`}
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
                              prefixLabel={prefix}
                            />
                          {excludedValues.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                              {excludedValues.map(v => (
                                <span key={v} style={{ background: "#5B21B6", color: "#fff", padding: "4px 12px", borderRadius: "16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500" }}>
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
                              prefixLabel={prefix}
                            />
                            {manualValues.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                                {manualValues.map((v, index) => (
                                  <span 
                                    key={v} 
                                    draggable
                                    onDragStart={(e) => setDraggedManualIndex(index)}
                                    onDragEnd={() => setDraggedManualIndex(null)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      if (draggedManualIndex === null || draggedManualIndex === index) return;
                                      const newVals = [...manualValues];
                                      const draggedItem = newVals[draggedManualIndex];
                                      newVals.splice(draggedManualIndex, 1);
                                      newVals.splice(index, 0, draggedItem);
                                      setManualValues(newVals);
                                      setDraggedManualIndex(null);
                                    }}
                                    style={{ 
                                      background: "#5B21B6", color: "#fff", padding: "4px 12px", borderRadius: "16px", 
                                      fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500",
                                      cursor: "grab", opacity: draggedManualIndex === index ? 0.5 : 1
                                    }}>
                                    <span style={{cursor: "grab", marginRight: "-2px"}}>⋮⋮</span>
                                    {v}
                                    <span onClick={() => setManualValues(manualValues.filter(item => item !== v))} style={{ cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}>×</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <Checkbox checked={sortManualValues} onChange={setSortManualValues} />
                            <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Sort manual values</span>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                        <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setUseManualValues(!useManualValues)}>
                          <span style={{ position: "absolute", inset: 0, backgroundColor: useManualValues ? "#5B21B6" : "#e1e3e5", borderRadius: "34px", transition: "0.2s" }}>
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
                              prefixLabel={prefix}
                            />
                          {excludedValues.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                              {excludedValues.map(v => (
                                <span key={v} style={{ background: "#5B21B6", color: "#fff", padding: "4px 12px", borderRadius: "16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500" }}>
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
                              prefixLabel={prefix}
                            />
                            {manualValues.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                                {manualValues.map((v, index) => (
                                  <span 
                                    key={v} 
                                    draggable
                                    onDragStart={(e) => setDraggedManualIndex(index)}
                                    onDragEnd={() => setDraggedManualIndex(null)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      if (draggedManualIndex === null || draggedManualIndex === index) return;
                                      const newVals = [...manualValues];
                                      const draggedItem = newVals[draggedManualIndex];
                                      newVals.splice(draggedManualIndex, 1);
                                      newVals.splice(index, 0, draggedItem);
                                      setManualValues(newVals);
                                      setDraggedManualIndex(null);
                                    }}
                                    style={{ 
                                      background: "#5B21B6", color: "#fff", padding: "4px 12px", borderRadius: "16px", 
                                      fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500",
                                      cursor: "grab", opacity: draggedManualIndex === index ? 0.5 : 1
                                    }}>
                                    <span style={{cursor: "grab", marginRight: "-2px"}}>⋮⋮</span>
                                    {v}
                                    <span onClick={() => setManualValues(manualValues.filter(item => item !== v))} style={{ cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}>×</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <Checkbox checked={sortManualValues} onChange={setSortManualValues} />
                            <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Sort manual values</span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* Multiple selection */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: multipleSelection ? "12px" : "0" }}>
                    <Checkbox checked={multipleSelection} onChange={setMultipleSelection} />
                    <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Multiple selection</span>
                    <TooltipIcon content="When checked, users can choose multiple filter option values." />
                  </div>

                  {multipleSelection && ["collection", "tag", "inventory_locations"].includes(optionType?.toLowerCase()) && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Checkbox checked={narrowDown} onChange={setNarrowDown} />
                      <span style={{ fontSize: "14px", color: "#5B21B6", fontWeight: "500" }}>Narrow down filter option values</span>
                      <TooltipIcon content="When checked, products must match all selected values instead of any selected value." />
                    </div>
                  )}
                </div>}

              </div>
            )}
            
            {activeTab === "advanced" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "24px" }}>
                {/* Display tooltip */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, displayTooltip: !advanced.displayTooltip })}>
                      <div style={{ position: "absolute", inset: 0, backgroundColor: advanced.displayTooltip ? "#5B21B6" : "#fff", border: `1px solid ${advanced.displayTooltip ? "#5B21B6" : "#c9cccf"}`, borderRadius: "34px", transition: "0.2s" }} />
                      <span style={{ position: "absolute", height: "14px", width: "14px", left: advanced.displayTooltip ? "19px" : "3px", bottom: "2px", backgroundColor: advanced.displayTooltip ? "#fff" : "#c9cccf", borderRadius: "50%", transition: "0.2s" }} />
                    </div>
                    <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, displayTooltip: !advanced.displayTooltip })}>Display tooltip</label>
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
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                  )}
                </div>

                {!["price", "percent_sale", "weight", "review_rating"].includes(optionType?.toLowerCase()) ? (
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
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(30, 27, 75, 0.12)", background: "#ffffff", color: "#5B21B6", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                      />
                      {advanced.maxHeight && (
                        <button 
                          onClick={() => setAdvanced({ ...advanced, maxHeight: "" })}
                          style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "rgba(91, 33, 182, 0.08)", color: "#5B21B6", border: "1px solid rgba(30, 27, 75, 0.12)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px" }}
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
                    value={optionSortType}
                    onChange={val => setAdvanced({ ...advanced, sortType: val, sortModeExplicit: true })}
                    options={["Automatic", "Label - AZ", "Label - ZA", "Product count - Highest to lowest", "Product count - Lowest to highest"]}
                    width="100%"
                  />
                </div>

                {/* On desktop & On mobile checkboxes */}
                <div style={{ display: "flex", gap: "40px", marginTop: "16px" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ margin: 0, fontSize: "13px", color: "#202223" }}>On desktop</h4>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopCollapsed: !advanced.desktopCollapsed })}>
                        <div style={{ position: "absolute", inset: 0, backgroundColor: advanced.desktopCollapsed ? "#5B21B6" : "#fff", border: `1px solid ${advanced.desktopCollapsed ? "#5B21B6" : "#c9cccf"}`, borderRadius: "34px", transition: "0.2s" }} />
                        <span style={{ position: "absolute", height: "14px", width: "14px", left: advanced.desktopCollapsed ? "19px" : "3px", bottom: "2px", backgroundColor: advanced.desktopCollapsed ? "#fff" : "#c9cccf", borderRadius: "50%", transition: "0.2s" }} />
                      </div>
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopCollapsed: !advanced.desktopCollapsed })}>Initially collapsed</label>
                      <TooltipIcon content="Filter block will be collapsed when the page loads on desktop." />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopSearchBox: !advanced.desktopSearchBox })}>
                        <div style={{ position: "absolute", inset: 0, backgroundColor: advanced.desktopSearchBox ? "#5B21B6" : "#fff", border: `1px solid ${advanced.desktopSearchBox ? "#5B21B6" : "#c9cccf"}`, borderRadius: "34px", transition: "0.2s" }} />
                        <span style={{ position: "absolute", height: "14px", width: "14px", left: advanced.desktopSearchBox ? "19px" : "3px", bottom: "2px", backgroundColor: advanced.desktopSearchBox ? "#fff" : "#c9cccf", borderRadius: "50%", transition: "0.2s" }} />
                      </div>
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopSearchBox: !advanced.desktopSearchBox })}>Show search box</label>
                      <TooltipIcon content="Show a search input inside the filter block on desktop." />
                    </div>
                  </div>

                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ margin: 0, fontSize: "13px", color: "#202223" }}>On mobile</h4>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "32px" }}>
                      <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, mobileSearchBox: !advanced.mobileSearchBox })}>
                        <div style={{ position: "absolute", inset: 0, backgroundColor: advanced.mobileSearchBox ? "#5B21B6" : "#fff", border: `1px solid ${advanced.mobileSearchBox ? "#5B21B6" : "#c9cccf"}`, borderRadius: "34px", transition: "0.2s" }} />
                        <span style={{ position: "absolute", height: "14px", width: "14px", left: advanced.mobileSearchBox ? "19px" : "3px", bottom: "2px", backgroundColor: advanced.mobileSearchBox ? "#fff" : "#c9cccf", borderRadius: "50%", transition: "0.2s" }} />
                      </div>
                      <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, mobileSearchBox: !advanced.mobileSearchBox })}>Show search box</label>
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
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ position: "relative", width: "36px", height: "20px", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopCollapsed: !advanced.desktopCollapsed })}>
                          <div style={{ position: "absolute", inset: 0, backgroundColor: advanced.desktopCollapsed ? "#5B21B6" : "#fff", border: `1px solid ${advanced.desktopCollapsed ? "#5B21B6" : "#c9cccf"}`, borderRadius: "34px", transition: "0.2s" }} />
                          <span style={{ position: "absolute", height: "14px", width: "14px", left: advanced.desktopCollapsed ? "19px" : "3px", bottom: "2px", backgroundColor: advanced.desktopCollapsed ? "#fff" : "#c9cccf", borderRadius: "50%", transition: "0.2s" }} />
                        </div>
                        <label style={{ fontSize: "14px", fontWeight: "600", color: "#5B21B6", cursor: "pointer" }} onClick={() => setAdvanced({ ...advanced, desktopCollapsed: !advanced.desktopCollapsed })}>Initially collapsed</label>
                        <TooltipIcon content="When checked, the filter is initially collapsed." />
                      </div>
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
                    style={{ padding: "6px 12px", border: "1px solid rgba(30, 27, 75, 0.12)", background: device === "desktop" ? "#f4f6f8" : "#fff", color: device === "desktop" ? "#5B21B6" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><path d="M17.5 3h-15C1.67 3 1 3.67 1 4.5v9c0 .83.67 1.5 1.5 1.5H7v2H5v1h10v-1h-2v-2h4.5c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zm-.5 10H3V5h14v8z"/></svg>
                  </button>
                  <button 
                    onClick={() => setDevice("mobile")}
                    style={{ padding: "6px 12px", border: "1px solid rgba(30, 27, 75, 0.12)", borderLeft: "1px solid #c9cccf", background: device === "mobile" ? "#f4f6f8" : "#fff", color: device === "mobile" ? "#5B21B6" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "currentColor" }}><path d="M13 1H7C5.9 1 5 1.9 5 3v14c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm-3 16c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm3-3H7V4h6v10z"/></svg>
                  </button>
                </div>

                <div style={{ display: "flex", background: "#fff", borderRadius: "4px", border: "1px solid #c9cccf", overflow: "hidden" }}>
                  <button 
                    onClick={() => setLayout("sidebar")}
                    style={{ padding: "6px 12px", border: layout === "sidebar" ? "1px solid #5B21B6" : "none", background: layout === "sidebar" ? "#f4f6f8" : "#fff", color: layout === "sidebar" ? "#5B21B6" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><rect x="3" y="4" width="4" height="12"/><rect x="8" y="4" width="9" height="12" opacity="0.3"/></svg>
                  </button>
                  <button 
                    onClick={() => setLayout("top")}
                    style={{ padding: "6px 12px", border: layout === "top" ? "1px solid #5B21B6" : "none", borderLeft: layout === "top" ? "1px solid #5B21B6" : "1px solid #c9cccf", background: layout === "top" ? "#f4f6f8" : "#fff", color: layout === "top" ? "#5B21B6" : "#6d7175", cursor: "pointer" }}
                  >
                    <svg viewBox="0 0 20 20" style={{ width: "18px", height: "18px", fill: "currentColor" }}><rect x="4" y="3" width="12" height="3"/><rect x="4" y="7" width="12" height="10" opacity="0.3"/></svg>
                  </button>
                </div>
              </div>

              {/* Preview Box */}
              <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px", overflowY: "auto" }}>
                {navCollections && optionType?.toLowerCase() === 'collection' ? (
                  <div><h3 style={{margin:'0 0 12px',fontSize:12,textTransform:'uppercase'}}>{filterTitle || 'Collection'}</h3>{previewOptionsData.length ? previewOptionsData.map(item => <div key={item.label} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'10px 0',fontSize:13,borderBottom:'1px solid #eee'}}><span>{item.displayLabel}</span><span aria-hidden="true">→</span></div>) : <p style={{fontSize:13,color:'#6d7175'}}>Select a main collection to preview your navigation links.</p>}</div>
                ) : device === "desktop" ? (
                  <>
                    <div 
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", cursor: "pointer" }}
                      onClick={() => setPreviewCollapsed(!previewCollapsed)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
                        <h3 style={{ margin: 0, fontSize: "12px", fontWeight: "700", color: "#202223", textTransform: "uppercase" }}>
                          {filterTitle || "COLLECTION"}
                        </h3>
                        {advanced.displayTooltip && (
                          <div title={advanced.tooltipContent} style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#f4f6f8", color: "#8c9196", fontSize: "9px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #d2d5d8", cursor: "help" }}>?</div>
                        )}
                      </div>
                      <svg viewBox="0 0 20 20" style={{ width: "16px", height: "16px", fill: "#202223", transform: previewCollapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M5 8l5 5 5-5z" /></svg>
                    </div>

                    {!previewCollapsed && (
                      <div style={{ 
                        display: "flex", 
                        flexDirection: "column", 
                        gap: displayMode === "Range" ? "24px" : "8px", 
                        maxHeight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") && advanced.maxHeight ? advanced.maxHeight : "none", 
                        overflowY: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "auto" : "visible",
                        paddingRight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "4px" : "0"
                      }}>
                        {displayMode === "Range" ? renderSliderPreview(layout === "top", device) : (
                          <div style={{
                            display: "flex", flexDirection: "column", gap: "8px",
                            padding: layout === "top" ? "16px" : "0",
                            background: layout === "top" ? "#ffffff" : "transparent",
                            borderRadius: layout === "top" ? "8px" : "0",
                            border: layout === "top" ? "1px solid #e1e3e5" : "none",
                            boxShadow: layout === "top" ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
                            position: "relative",
                            marginTop: layout === "top" ? "8px" : "0"
                          }}>
                            {layout === "top" && (
                              <div style={{ position: "absolute", top: "-6px", left: "20px", width: "10px", height: "10px", background: "#fff", borderTop: "1px solid #e1e3e5", borderLeft: "1px solid #e1e3e5", transform: "rotate(45deg)" }}></div>
                            )}
                            {["vendor", "collection", "product_type", "tag", "color", "title", "inventory_locations", "size"].includes(optionType?.toLowerCase()) && advanced.desktopSearchBox && (
                              <div style={{ marginBottom: "12px", position: "relative" }}>
                                <input 
                                  type="text" 
                                  placeholder="Filter options" 
                                  style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #e1e3e5", fontSize: "13px", marginBottom: "8px" }} 
                                />
                              </div>
                            )}

                            {displayMode === "Box" ? (
                              <>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  {previewOptionsData
                                    .slice(0, (advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") ? 6 : undefined)
                                    .map(item => (
                                      <div key={item.label} style={{ padding: "6px 12px", border: "1px solid #c9cccf", borderRadius: "10px", fontSize: "12px", color: "#202223", background: "#f4f6f8" }}>
                                        {item.isStars ? renderStars(item.displayLabel) : item.displayLabel}
                                      </div>
                                    ))
                                  }
                                </div>
                                {(advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") && previewOptionsData.length > 6 && (
                                  <div style={{ color: "#5B21B6", fontSize: "13px", marginTop: "4px", textDecoration: "underline", cursor: "pointer" }}>+ View more</div>
                                )}
                              </>
                            ) : displayMode === "Swatch" ? (
                              <>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", flexDirection: (swatchConfig.layout === "List" ? "column" : "row") }}>
                                  {previewOptionsData
                                    .slice(0, (advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") ? 6 : undefined)
                                    .map(item => {
                                      const cData = swatchConfig.colors[item.label];
                                      const bg = cData?.type === "color" && cData.value ? (normalizeSwatchHex(cData.value) || getColorHex(item.label)) : (cData?.type === "image" && cData.value ? `url(${cData.value}) center/cover` : getColorHex(item.label));
                                      const isList = swatchConfig.layout === "List";
                                      return (
                                        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px", flexDirection: isList ? "row" : "column", justifyContent: "center" }}>
                                          <div style={{ width: "24px", height: "24px", borderRadius: swatchConfig.circleSwatch ? "50%" : "4px", background: bg, border: "1px solid #c9cccf", flexShrink: 0 }}></div>
                                          {swatchConfig.showLabel && <span style={{ fontSize: "12px", textAlign: isList ? "left" : "center" }}>{item.displayLabel}</span>}
                                        </div>
                                      );
                                    })
                                  }
                                </div>
                                {(advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") && previewOptionsData.length > 6 && (
                                  <div style={{ color: "#5B21B6", fontSize: "13px", marginTop: "4px", textDecoration: "underline", cursor: "pointer" }}>+ View more</div>
                                )}
                              </>
                            ) : (
                              <>
                                {previewOptionsData
                                  .slice(0, (advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") ? 6 : undefined)
                                  .map(item => (
                                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#202223" }}>
                                      <div style={{ width: "16px", height: "16px", border: "1px solid #8c9196", borderRadius: "2px", background: "#fff", flexShrink: 0 }}></div>
                                      <span style={{ flex: 1 }}>{item.isStars ? renderStars(item.displayLabel) : item.displayLabel}</span>
                                      {item.count > 0 && <span style={{ color: "#8c9196" }}>({item.count})</span>}
                                    </div>
                                  ))
                                }
                                {(advanced.showMoreType === "View more" || advanced.showMoreType === "View more with scrollbar") && previewOptionsData.length > 6 && (
                                  <div style={{ color: "#5B21B6", fontSize: "13px", marginTop: "4px", textDecoration: "underline", cursor: "pointer" }}>+ View more</div>
                                )}
                                {layout !== "top" && <div style={{ height: "1px", background: "#e1e3e5", width: "100%", marginTop: "4px" }}></div>}
                              </>
                            )}
                          </div>
                        )}
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
                      gap: displayMode === "Range" ? "24px" : "16px",
                      maxHeight: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") && advanced.maxHeight ? advanced.maxHeight : "none", 
                      overflowY: (advanced.showMoreType === "Scrollbar" || advanced.showMoreType === "View more with scrollbar") ? "auto" : "visible"
                    }}>
                      {displayMode === "Range" ? renderSliderPreview(false, device) : (
                        <>
                          {["vendor", "collection", "product_type", "tag", "color", "title", "inventory_locations"].includes(optionType?.toLowerCase()) && advanced.mobileSearchBox && (
                            <div style={{ marginBottom: "12px", position: "relative" }}>
                              <input 
                                type="text" 
                                placeholder="Filter options" 
                                style={{ padding: "8px 12px", borderRadius: "4px", border: "1px solid #e1e3e5", fontSize: "14px", marginBottom: "8px" }} 
                              />
                            </div>
                          )}
                          
                          {displayMode === "Box" ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                              {previewOptionsData
                                .map(item => (
                                  <div key={item.label} style={{ padding: "6px 12px", border: "1px solid #c9cccf", borderRadius: "10px", fontSize: "12px", color: "#202223", background: "#f4f6f8" }}>
                                    {item.isStars ? renderStars(item.displayLabel) : item.displayLabel}
                                  </div>
                                ))
                              }
                            </div>
                          ) : displayMode === "Swatch" ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", flexDirection: (swatchConfig.layout === "List" ? "column" : "row") }}>
                              {previewOptionsData
                                .map(item => {
                                  const cData = swatchConfig.colors[item.label];
                                  const bg = cData?.type === "color" && cData.value ? (normalizeSwatchHex(cData.value) || getColorHex(item.label)) : (cData?.type === "image" && cData.value ? `url(${cData.value}) center/cover` : getColorHex(item.label));
                                  const isList = swatchConfig.layout === "List";
                                  return (
                                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px", flexDirection: isList ? "row" : "column", justifyContent: "center" }}>
                                      <div style={{ width: "24px", height: "24px", borderRadius: swatchConfig.circleSwatch ? "50%" : "4px", background: bg, border: "1px solid #c9cccf", flexShrink: 0 }}></div>
                                      {swatchConfig.showLabel && <span style={{ fontSize: "12px", textAlign: isList ? "left" : "center" }}>{item.displayLabel}</span>}
                                    </div>
                                  );
                                })
                              }
                            </div>
                          ) : (
                            <>
                              {previewOptionsData
                                .map(item => (
                                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#202223" }}>
                                    <div style={{ width: "16px", height: "16px", border: "1px solid #8c9196", borderRadius: "2px", background: "#fff", flexShrink: 0 }}></div>
                                    <span style={{ flex: 1 }}>{item.isStars ? renderStars(item.displayLabel) : item.displayLabel}</span>
                                    {item.count > 0 && <span style={{ color: "#c9cccf" }}>({item.count})</span>}
                                  </div>
                                ))
                              }
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

            </div>
          )}
        </div>

        {invalidSwatchColors.length > 0 && <p role="alert" style={{ padding: "0 24px", color: "#b42318" }}>Enter a valid HEX color for {invalidSwatchColors.map(([label]) => label).join(', ')} (for example #e91e63 or e91e63).</p>}
        {/* Footer */}
        <div style={{ padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: "12px", borderTop: "1px solid #e1e3e5", background: "#fff" }}>
          <Button variant="default" onClick={onClose} style={{ borderRadius: "10px", padding: "8px 24px", color: "#8c9196", border: "1px solid #e1e3e5" }}>
            CANCEL
          </Button>
          <Button 
            variant="primary" 
            disabled={invalidSwatchColors.length > 0}
            onClick={() => onSave({ 
              filterId: initialData?.id,
              optionType, prefix, filterTitle, navCollections, childType, mainCollections, keepMainCollectionsUnchanged, multipleSelection, narrowDown, 
              useManualValues, 
              excludedValues: useManualValues ? [] : excludedValues, 
              manualValues: useManualValues ? manualValues : [], 
              sortManualValues, advanced,
              displayMode, priceRanges, saleRanges, weightRanges, reviewRanges, stockStatusConfig, ratingColor, sliderConfig, swatchConfig: savedSwatchConfig
            })}
            style={{ borderRadius: "10px", padding: "8px 24px", background: "#5B21B6", border: "1px solid rgba(30, 27, 75, 0.12)" }}
          >
            {initialData ? "UPDATE" : "CREATE"}
          </Button>
        </div>

      </div>
    </div>
  );
}
