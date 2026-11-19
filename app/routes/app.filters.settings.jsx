import {useCompletedSubmission} from '../hooks/useCompletedSubmission';
import { useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getFilterGlobalSettings, updateFilterGlobalSettings } from "../services/filterSettings.server";
import {FILTER_WIDTH_KEYS,FILTER_WIDTH_LIMITS,isValidFilterWidth,normalizeFilterWidth} from '../utils/filterWidths.js';
import {COLLECTION_SPACING_LIMITS,isValidCollectionPageWidth,isValidCollectionSpacing} from '../utils/collectionLayoutSettings.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getFilterGlobalSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const payload = {};
  if(formData.has('collectionPageWidth')){
    const value=formData.get('collectionPageWidth');
    if(!isValidCollectionPageWidth(value))return {success:false,error:'Choose theme width or custom side spacing.'};
    payload.collectionPageWidth=value;
  }
  for(const [key,limits] of Object.entries(COLLECTION_SPACING_LIMITS))if(formData.has(key)){
    const value=formData.get(key);
    if(!isValidCollectionSpacing(key,value))return {success:false,error:`Enter whole-number spacing from ${limits.min} to ${limits.max} px.`};
    payload[key]=Number(value);
  }
  for (const key of FILTER_WIDTH_KEYS) {
    if (!formData.has(key)) continue;
    const value = formData.get(key);
    if (!isValidFilterWidth(value)) return {success:false,error:'Enter a whole-number filter width from 240 to 600 px.'};
    payload[key] = Number(value);
  }
  const booleanSettings = ['horizontalFilters', 'showAttributeBasedBreadcrumb', 'showFilterOptionsWithOneItem', 'showProductCount', 'scrollUpOnFilterValuesChange', 'hideUnavailableVariantsWhenSelected', 'prioritizeSortOverPinning', 'prioritizeSortOverMerchandising'];
  for (const key of booleanSettings) {
    if (formData.has(key)) {
      const value = formData.get(key);
      if (value !== 'true' && value !== 'false') return { success: false, error: 'Invalid filter setting value' };
      payload[key] = value === 'true';
    }
  }
  if (formData.has('desktopFilterLayout')) {
    const value = formData.get('desktopFilterLayout');
    if (!['horizontal', 'vertical', 'drawer'].includes(value)) return { success: false, error: 'Invalid desktop layout' };
    payload.desktopFilterLayout = value;
  }
  if (formData.has('mobileFilterLayout')) {
    const value = formData.get('mobileFilterLayout');
    if (!['off-canvas', 'horizontal-scrolling'].includes(value)) return { success: false, error: 'Invalid mobile layout' };
    payload.mobileFilterLayout = value;
  }
  if (formData.has('filterBarBackgroundColor')) {
    const value = String(formData.get('filterBarBackgroundColor')).trim();
    if (value !== '' && !/^#[0-9a-f]{6}$/i.test(value)) return { success: false, error: 'Choose a valid background color' };
    payload.filterBarBackgroundColor = value.toLowerCase();
  }
  if (formData.has('priceFilterDisplayMode')) {
    const value = formData.get('priceFilterDisplayMode');
    if (!['List', 'Range'].includes(value)) return {success:false,error:'Invalid Price filter style'};
    payload.priceFilterDisplayMode = value;
  }
  if (formData.has('sizeOptionsPerRow')) {
    const value = Number(formData.get('sizeOptionsPerRow'));
    if (!Number.isInteger(value) || value < 2 || value > 6) return {success:false,error:'Choose 2 to 6 size options per row'};
    payload.sizeOptionsPerRow = value;
  }
  if (!Object.keys(payload).length) return { success: false, error: 'No filter settings supplied' };
  await updateFilterGlobalSettings(session.shop, payload);
  return { success: true };
};

// â”€â”€ Toggle Row Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingToggle({ label, description, value, onChange, disabled }) {
  return (
    <div className="settings-row">
      <div className="settings-text-col">
        <p className="settings-label">{label}</p>
        <p className="settings-desc">{description}</p>
      </div>
      {/* Toggle switch */}
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-slider">
          <span className="toggle-knob" />
        </span>
      </label>
    </div>
  );
}

// â”€â”€ Select Row Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingSelect({ label, description, value, onChange, options, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedLabel = options.find((o) => o.value === value)?.label || value;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="settings-row settings-select-row">
      <div className="settings-text-col">
        <p className="settings-label">{label}</p>
        <p className="settings-desc">{description}</p>
      </div>
      <div style={{ flexShrink: 0, width: "200px", position: "relative" }} ref={dropdownRef}>
        <div
          onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
          style={{
            width: "100%",
            padding: "11px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(30, 27, 75, 0.12)",
            background: "#ffffff",
            color: "#1E1B4B",
            fontSize: "13.5px",
            fontWeight: "600",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 2px 4px rgba(30, 27, 75, 0.02)",
            transition: "all 0.2s ease",
            boxSizing: "border-box",
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = "#5B21B6"}
          onMouseLeave={(e) => !isOpen && (e.currentTarget.style.borderColor = "rgba(30, 27, 75, 0.12)")}
        >
          {selectedLabel}
          <svg
            viewBox="0 0 20 20"
            style={{
              width: "12px",
              height: "12px",
              fill: "#1e1b4b",
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "0.2s",
            }}
          >
            <path d="M10 13a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 10 13z" />
          </svg>
        </div>

        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: "8px",
              background: "#fff",
              borderRadius: "10px",
              boxShadow: "0 10px 30px rgba(30, 27, 75, 0.08)",
              border: "1px solid rgba(30, 27, 75, 0.08)",
              zIndex: 1000,
              padding: "6px 0",
              boxSizing: "border-box",
            }}
          >
            {options.map((opt) => (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  color: value === opt.value ? "#5B21B6" : "#1e1b4b",
                  background: value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(91, 33, 182, 0.05)";
                  e.currentTarget.style.color = "#5B21B6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = value === opt.value ? "rgba(91, 33, 182, 0.05)" : "transparent";
                  e.currentTarget.style.color = value === opt.value ? "#5B21B6" : "#1e1b4b";
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€ Section Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingFilterWidth({ label, description, value, onChange, disabled, mobile=false, popover=false, defaultWidth=FILTER_WIDTH_LIMITS.default }) {
  const [draft,setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = isValidFilterWidth(draft);
  const changed = valid && Number(draft) !== value;
  const id = label.toLowerCase().replaceAll(' ','-');
  const previewWidth = Math.min(90,(valid ? Number(draft) : value) / (mobile?480:900) * 100);
  const drawer = !popover&&(/drawer/i.test(label)||mobile);
  const buttonStyle = {padding:'8px 12px',border:'1px solid #ddd6e7',borderRadius:8,background:'#fff',color:'#5b21b6',font:'inherit',fontSize:12,cursor:'pointer'};
  return <section aria-label={label+' settings'} style={{padding:20,border:'1px solid #e5dfed',borderRadius:14,background:'#fff',margin:'16px 0',boxSizing:'border-box'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:10}}>
      <label className="settings-label" htmlFor={id} style={{margin:0}}>{label}</label>
      <span style={{fontSize:12,color:'#766c82'}}>Saved: {value} px</span>
    </div>
    <p className="settings-desc" id={id+'-help'} style={{margin:'0 0 18px'}}>{description}</p>
    <div style={{display:'flex',gap:24,flexWrap:'wrap',alignItems:'center'}}>
      <div aria-hidden="true" style={{flex:'1 1 210px',minWidth:0,height:130,position:'relative',overflow:'hidden',border:'1px solid #e8e3ef',borderRadius:10,background:'#f8f6fb'}}>
        <div style={{height:18,background:'#eae5f2',borderBottom:'1px solid #ddd6e7'}} />
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,padding:12,paddingLeft:drawer||popover?12:previewWidth+'%'}}>{[1,2,3].map(i=><div key={i} style={{height:78,background:'#e9e3f1',borderRadius:5}} />)}</div>
        {drawer && <div style={{position:'absolute',inset:'19px 0 0',background:'rgba(37,24,55,.12)'}} />}
        {popover&&<div style={{position:'absolute',top:23,left:12,display:'flex',gap:6}}>{['Color','Size'].map(text=><span key={text} style={{fontSize:9,padding:'3px 7px',background:'#fff',border:'1px solid #d8d0e2',borderRadius:4}}>{text}</span>)}</div>}
        <div style={{position:'absolute',top:popover?46:19,bottom:popover?'auto':0,height:popover?76:undefined,left:popover?12:0,width:previewWidth+'%',minWidth:55,background:'#fff',borderRight:'2px solid #8b5cf6',padding:10,boxSizing:'border-box',boxShadow:drawer||popover?'4px 0 12px #30253e1a':'none'}}>
          <div style={{height:5,width:'70%',background:'#8b5cf6',borderRadius:3,marginBottom:12}} />{[1,2,3,4].map(i=><div key={i} style={{height:4,background:'#e6e0ee',marginBottom:8,borderRadius:3}} />)}
        </div>
      </div>
      <fieldset disabled={disabled} style={{flex:'1 1 250px',minWidth:0,margin:0,padding:0,border:0,display:'grid',gap:12}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:600,color:'#5c5069'}}>Panel width</span>
          <span style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',border:'1px solid #d8d0e2',borderRadius:8}}>
            <input id={id} aria-label={label+' (px)'} aria-describedby={id+'-help '+id+'-range'} aria-invalid={!valid} type="number" min={FILTER_WIDTH_LIMITS.min} max={FILTER_WIDTH_LIMITS.max} step="1" value={draft} onChange={e=>setDraft(e.target.value)} style={{minWidth:0,width:64,border:0,font:'inherit',color:'#30253e',background:'transparent'}} /><span style={{fontSize:12,color:'#766c82'}}>px</span>
          </span>
        </div>
        <input type="range" aria-label={label+' slider'} min={FILTER_WIDTH_LIMITS.min} max={FILTER_WIDTH_LIMITS.max} step="1" value={valid?Number(draft):value} onChange={e=>setDraft(e.target.value)} style={{width:'100%',margin:0,accentColor:'#7c3aed'}} />
        <div id={id+'-range'} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#766c82'}}><span>{FILTER_WIDTH_LIMITS.min} px</span><span>{FILTER_WIDTH_LIMITS.max} px</span></div>
        <div role="group" aria-label={label+' presets'} style={{display:'flex',gap:8,flexWrap:'wrap'}}>{(popover?[['Narrow',240],['Default',300],['Wide',420]]:[['Narrow',300],['Default',420],['Wide',520]]).map(([name,width])=><button key={name} type="button" aria-pressed={valid&&Number(draft)===width} onClick={()=>setDraft(String(width))} style={{...buttonStyle,borderColor:valid&&Number(draft)===width?'#8b5cf6':'#ddd6e7',background:valid&&Number(draft)===width?'#f5f3ff':'#fff'}}>{name}</button>)}</div>
        {!valid && <p role="alert" style={{margin:0,color:'#b42318',fontSize:12}}>Enter a whole number from {FILTER_WIDTH_LIMITS.min} to {FILTER_WIDTH_LIMITS.max} px.</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:2}}>
          <button type="button" aria-label={'Apply '+label.toLowerCase()} disabled={disabled||!changed} onClick={()=>onChange(Number(draft))} style={{...buttonStyle,borderColor:'#6d28d9',background:'#6d28d9',color:'#fff',opacity:(disabled||!changed)?0.5:1}}>Apply width</button>
          <button type="button" aria-label={'Reset '+label.toLowerCase()} onClick={()=>{setDraft(String(defaultWidth));if(value!==defaultWidth)onChange(defaultWidth);}} style={buttonStyle}>Reset to {defaultWidth} px</button>
        </div>
      </fieldset>
    </div>
  </section>;
}


function SettingBarColor({ value, onChange, disabled }) {
  const [custom, setCustom] = useState(!!value);
  const [draft, setDraft] = useState(value || '#ffffff');
  useEffect(() => { setCustom(!!value); setDraft(value || '#ffffff'); }, [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  const previewColor = valid ? draft : '#ffffff';
  const rgb = [1,3,5].map(start => parseInt(previewColor.slice(start,start+2),16));
  const previewText = rgb[0]*0.299 + rgb[1]*0.587 + rgb[2]*0.114 < 140 ? '#ffffff' : '#1e1b4b';
  const presets = [['White','#ffffff'],['Cream','#fbf7f5'],['Light gray','#f4f6f8'],['Lavender','#f5f3ff'],['Navy','#1e1b4b'],['Black','#111111']];
  const usePage = () => { setCustom(false); if (value) onChange(''); };
  return (
    <div className="settings-row" style={{flexWrap:'wrap'}}>
      <div className="settings-text-col" style={{minWidth:200}}>
        <p className="settings-label">Filter and sort bar background</p>
        <p className="settings-desc">Choose the background of the bar containing Filters and Bestselling. By default, it matches the surrounding page. Reload the storefront after saving.</p>
      </div>
      <fieldset disabled={disabled} style={{border:'1px solid #e5dfed',padding:16,margin:0,display:'grid',gap:14,width:300,maxWidth:'100%',minWidth:0,flex:'0 1 300px',borderRadius:12,background:'#fcfbfe',boxSizing:'border-box'}}>
        <select aria-label="Filter and sort bar background" value={custom ? 'custom' : 'page'} onChange={e => {
          if (e.target.value === 'custom') setCustom(true); else usePage();
        }} style={{padding:'10px 12px',border:'1px solid #d8d0e2',borderRadius:8,background:'#fff',font:'inherit',fontSize:13,width:'100%'}}>
          <option value="page">Page background (default)</option>
          <option value="custom">Custom color</option>
        </select>
        {!custom ? <p style={{margin:0,fontSize:12,color:'#766c82',lineHeight:1.6}}>Automatically matches the surrounding collection or search page.</p> : <>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <input type="color" aria-label="Bar background color" value={previewColor} onChange={e => setDraft(e.target.value)} style={{width:48,height:44,padding:3,border:'1px solid #d8d0e2',borderRadius:8,background:'#fff',cursor:'pointer',flexShrink:0}} />
            <label style={{display:'grid',gap:5,minWidth:0,flex:1,fontSize:11,fontWeight:600,color:'#766c82'}}>HEX color
              <span style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',border:'1px solid #d8d0e2',borderRadius:8,background:'#fff'}}>
                <span aria-hidden="true" style={{color:'#94869e'}}>#</span>
                <input aria-label="Bar background hex color" aria-invalid={!valid} value={draft.replace(/^#/,'')} maxLength={7} onChange={e => setDraft('#'+e.target.value.trim().replace(/^#/,''))} spellCheck={false} style={{width:'100%',minWidth:0,border:0,outline:0,font:'13px ui-monospace,monospace',background:'transparent',color:'#30253e'}} />
              </span>
            </label>
          </div>
          <div role="group" aria-label="Suggested background colors" style={{display:'flex',gap:9}}>
            {presets.map(([name,color]) => <button key={color} type="button" aria-label={'Use '+name} aria-pressed={draft.toLowerCase() === color} title={name} onClick={() => setDraft(color)} style={{width:28,height:28,borderRadius:'50%',background:color,border:draft.toLowerCase() === color?'2px solid #7c3aed':'1px solid #d8d0e2',boxShadow:draft.toLowerCase() === color?'0 0 0 2px #ede9fe':'none',cursor:'pointer',padding:0}} />)}
          </div>
          <div aria-label="Filter bar color preview" style={{display:'flex',justifyContent:'space-between',padding:'14px 12px',border:'1px solid #e5dfed',borderRadius:8,background:previewColor,color:previewText,fontSize:12,fontWeight:600}}><span>Filters</span><span>Best selling⌄</span></div>
          {!valid && <p role="alert" style={{margin:0,fontSize:12,color:'#b42318'}}>Enter a six-digit HEX color.</p>}
          <button type="button" disabled={!valid || draft.toLowerCase() === value} onClick={() => onChange(draft.toLowerCase())} style={{padding:'10px 14px',border:0,borderRadius:8,background:'#5b21b6',color:'#fff',fontWeight:600,cursor:'pointer',opacity:!valid || draft.toLowerCase() === value?0.5:1}}>Apply color</button>
          <button type="button" onClick={usePage} style={{border:0,padding:0,background:'none',color:'#6d5880',fontSize:12,textDecoration:'underline',cursor:'pointer'}}>Use page background</button>
        </>}
      </fieldset>
    </div>
  );
}

function SettingsSection({ title, children }) {
  return (
    <div className="settings-card">
      {title && (
        <div className="settings-card-header">
          <svg
            viewBox="0 0 20 20"
            style={{ width: "16px", height: "16px", fill: "#5B21B6" }}
          >
            <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.75-11.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5zm0 4.5a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5z" />
          </svg>
          <h3 className="settings-card-title">{title}</h3>
        </div>
      )}
      <div className="settings-card-body">
        {children}
      </div>
    </div>
  );
}

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function FilterSettings() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData();
  useCompletedSubmission(actionData, nav.state, () => {
    if (actionData?.success) shopify.toast.show("Filter settings saved");
    else if (actionData?.error) shopify.toast.show(actionData.error, { isError: true });
  });

  const [horizontalFilters, setHorizontalFilters] = useState(settings?.horizontalFilters || false);
  const [desktopLayout, setDesktopLayout] = useState(
    settings?.desktopFilterLayout || (settings?.horizontalFilters ? "horizontal" : "drawer")
  );
  const [mobileLayout, setMobileLayout] = useState(settings?.mobileFilterLayout || "off-canvas");
  const [barBackground, setBarBackground] = useState(settings?.filterBarBackgroundColor || '');
  const [priceStyle, setPriceStyle] = useState(settings?.priceFilterDisplayMode || 'List');
  const [sizeColumns, setSizeColumns] = useState(String(settings?.sizeOptionsPerRow || 4));
  const [drawerWidth,setDrawerWidth] = useState(normalizeFilterWidth(settings?.drawerWidth));
  const [verticalWidth,setVerticalWidth] = useState(normalizeFilterWidth(settings?.verticalFilterWidth));
  const [mobileDrawerWidth,setMobileDrawerWidth] = useState(normalizeFilterWidth(settings?.mobileDrawerWidth));
  const [mobileHorizontalWidth,setMobileHorizontalWidth] = useState(normalizeFilterWidth(settings?.mobileHorizontalFilterWidth,'mobileHorizontalFilterWidth'));

  const [showBreadcrumb, setShowBreadcrumb] = useState(settings?.showAttributeBasedBreadcrumb ?? true);
  const [showSingleItem, setShowSingleItem] = useState(settings?.showFilterOptionsWithOneItem || false);
  const [showProductCount, setShowProductCount] = useState(settings?.showProductCount ?? true);
  const [scrollOnChange, setScrollOnChange] = useState(settings?.scrollUpOnFilterValuesChange || false);

  const [hideUnavailableVariants, setHideUnavailableVariants] = useState(settings?.hideUnavailableVariantsWhenSelected || false);

  const [sortOverPinning, setSortOverPinning] = useState(settings?.prioritizeSortOverPinning ?? false);
  const [sortOverMerchandising, setSortOverMerchandising] = useState(settings?.prioritizeSortOverMerchandising ?? false);

  const isSaving = nav.state !== "idle";
  useEffect(() => {
    if (nav.state !== 'idle') return;
    setHorizontalFilters(settings?.horizontalFilters ?? false);
    setDesktopLayout(settings?.desktopFilterLayout || (settings?.horizontalFilters ? 'horizontal' : 'drawer'));
    setMobileLayout(settings?.mobileFilterLayout || 'off-canvas');
    setBarBackground(settings?.filterBarBackgroundColor || '');
    setPriceStyle(settings?.priceFilterDisplayMode || 'List');
    setSizeColumns(String(settings?.sizeOptionsPerRow || 4));
    setDrawerWidth(normalizeFilterWidth(settings?.drawerWidth));
    setVerticalWidth(normalizeFilterWidth(settings?.verticalFilterWidth));
    setMobileDrawerWidth(normalizeFilterWidth(settings?.mobileDrawerWidth));
    setMobileHorizontalWidth(normalizeFilterWidth(settings?.mobileHorizontalFilterWidth,'mobileHorizontalFilterWidth'));
    setShowBreadcrumb(settings?.showAttributeBasedBreadcrumb ?? true);
    setShowSingleItem(settings?.showFilterOptionsWithOneItem ?? false);
    setShowProductCount(settings?.showProductCount ?? true);
    setScrollOnChange(settings?.scrollUpOnFilterValuesChange ?? false);
    setHideUnavailableVariants(settings?.hideUnavailableVariantsWhenSelected ?? false);
    setSortOverPinning(settings?.prioritizeSortOverPinning ?? false);
    setSortOverMerchandising(settings?.prioritizeSortOverMerchandising ?? false);
  }, [settings, nav.state]);


  const handleSettingChange = (key, value) => {
    if (isSaving) return;
    if (key === "prioritizeSortOverPinning") setSortOverPinning(value);
    else if (key === "prioritizeSortOverMerchandising") setSortOverMerchandising(value);
    else if (key === "desktopFilterLayout") {
      setDesktopLayout(value);
      setHorizontalFilters(value === "horizontal");
    }
    else if (key === "horizontalFilters") {
      setHorizontalFilters(value);
      setDesktopLayout(value ? "horizontal" : "drawer");
    }
    else if (key === "mobileFilterLayout") setMobileLayout(value);
    else if (key === "filterBarBackgroundColor") setBarBackground(value);
    else if (key === 'priceFilterDisplayMode') setPriceStyle(value);
    else if (key === 'sizeOptionsPerRow') setSizeColumns(value);
    else if (key === 'drawerWidth') setDrawerWidth(value);
    else if (key === 'verticalFilterWidth') setVerticalWidth(value);
    else if (key === 'mobileDrawerWidth') setMobileDrawerWidth(value);
    else if (key === 'mobileHorizontalFilterWidth') setMobileHorizontalWidth(value);
    else if (key === "showAttributeBasedBreadcrumb") setShowBreadcrumb(value);
    else if (key === "showFilterOptionsWithOneItem") setShowSingleItem(value);
    else if (key === "showProductCount") setShowProductCount(value);
    else if (key === "scrollUpOnFilterValuesChange") setScrollOnChange(value);
    else if (key === "hideUnavailableVariantsWhenSelected") setHideUnavailableVariants(value);

    const formData = new FormData();
    formData.set(key, String(value));
    submit(formData, { method: "post" });
  };

  return (
    <div className="settings-page">
      <style dangerouslySetInnerHTML={{ __html: `
        .settings-page {
          background: #f8f9fc !important;
          min-height: calc(100vh - 56px) !important;
          display: flex !important;
          flex-direction: column !important;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          box-sizing: border-box !important;
        }
        .settings-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          padding: 20px 32px !important;
          background: #ffffff !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          box-shadow: 0 2px 8px rgba(30, 27, 75, 0.02) !important;
        }
        .btn-settings-back {
          background: none !important;
          border: none !important;
          cursor: pointer !important;
          padding: 8px !important;
          border-radius: 8px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease !important;
        }
        .btn-settings-back:hover {
          background: rgba(30, 27, 75, 0.05) !important;
        }
        .settings-title-text {
          font-size: 15px !important;
          color: #5B21B6 !important;
          font-weight: 700 !important;
          background: rgba(91, 33, 182, 0.06) !important;
          padding: 12px 20px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(91, 33, 182, 0.12) !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .settings-container {
          flex: 1 !important;
          padding: 32px !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .settings-card {
          background: #ffffff !important;
          border: 1px solid rgba(30, 27, 75, 0.08) !important;
          border-radius: 16px !important;
          box-shadow: 0 4px 20px rgba(30, 27, 75, 0.02) !important;
          overflow: visible !important;
          margin-bottom: 28px !important;
        }
        .settings-card-header {
          padding: 18px 24px !important;
          background: linear-gradient(90deg, #f8faff 0%, #f4f3ff 100%) !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.08) !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
        }
        .settings-card-title {
          font-size: 16px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
          margin: 0 !important;
        }
        .settings-card-body {
          padding: 8px 24px !important;
        }
        .settings-row {
          display: flex !important;
          justify-content: space-between !important;
          align-items: flex-start !important;
          padding: 24px 0 !important;
          border-bottom: 1px solid rgba(30, 27, 75, 0.06) !important;
          gap: 40px !important;
        }
        .settings-row:last-child {
          border-bottom: none !important;
        }
        .settings-text-col {
          flex: 1 !important;
        }
        .settings-label {
          margin: 0 0 6px 0 !important;
          font-size: 14.5px !important;
          font-weight: 700 !important;
          color: #1E1B4B !important;
        }
        .settings-desc {
          margin: 0 !important;
          font-size: 13.5px !important;
          color: #4b5563 !important;
          line-height: 1.6 !important;
        }

        @media (max-width: 600px) {
          .settings-select-row { flex-direction: column; gap: 14px !important; }
          .settings-select-row > div { width: 100% !important; min-width: 0; box-sizing: border-box; }
        }

        /* Luxury custom Toggle slider */
        .toggle-switch {
          position: relative !important;
          display: inline-block !important;
          width: 48px !important;
          height: 26px !important;
          flex-shrink: 0 !important;
          cursor: pointer !important;
        }
        .toggle-switch input {
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
        }
        .toggle-slider {
          position: absolute !important;
          inset: 0 !important;
          background-color: rgba(30, 27, 75, 0.12) !important;
          border-radius: 34px !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .toggle-switch input:checked + .toggle-slider {
          background-color: #10B981 !important;
        }
        .toggle-knob {
          position: absolute !important;
          height: 20px !important;
          width: 20px !important;
          left: 3px !important;
          bottom: 3px !important;
          background-color: #fff !important;
          border-radius: 50% !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 2px 4px rgba(30, 27, 75, 0.1) !important;
        }
        .toggle-switch input:checked + .toggle-slider .toggle-knob {
          left: 25px !important;
        }
      ` }} />

      {/* Premium Header */}
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => navigate("/app/filters")}
            className="btn-settings-back"
            title="Back to Filters"
          >
            <svg
              viewBox="0 0 20 20"
              style={{ width: "20px", height: "20px", fill: "#1E1B4B" }}
            >
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="settings-title-text">
            Filter Settings
          </span>
        </div>
      </div>

      <div className="settings-container">
        <SettingsSection title="Sorting">
          <SettingToggle disabled={isSaving}
            label="Prioritize sort order over merchandising rules"
            description="Let Price, Title, Date and Trending sorting override merchandising boosts. Bestselling keeps merchandising priority."
            value={sortOverMerchandising}
            onChange={(val) => handleSettingChange("prioritizeSortOverMerchandising", val)}
          />
          <SettingToggle disabled={isSaving}
            label="Prioritize sort order over pinning"
            description="Let Price, Title, Date and Trending sorting override pinned positions. Bestselling keeps pins in their configured order."
            value={sortOverPinning}
            onChange={(val) => handleSettingChange("prioritizeSortOverPinning", val)}
          />
        </SettingsSection>
        <SettingsSection title="Filters Settings">
          <SettingBarColor disabled={isSaving} value={barBackground} onChange={value => handleSettingChange('filterBarBackgroundColor', value)} />
          <SettingSelect disabled={isSaving} label="Price filter style"
            description="Choose checkboxes or a range slider for Price. Checkboxes are the default for every store. Saved price bands are kept. Reload the storefront after saving."
            value={priceStyle} onChange={value => handleSettingChange('priceFilterDisplayMode', value)}
            options={[{value:'List',label:'Checkboxes (default)'},{value:'Range',label:'Range slider'}]} />
          <SettingSelect disabled={isSaving} label="Size options per row"
            description="Choose how many size options appear in each row. The default is four. Reload the storefront after saving."
            value={sizeColumns} onChange={value => handleSettingChange('sizeOptionsPerRow', value)}
            options={[2,3,4,5,6].map(value => ({value:String(value),label:String(value) + (value === 4 ? ' (default)' : '')}))} />
          <SettingSelect disabled={isSaving}
            label="Desktop filter layout"
            description="Choose how filters appear on desktop and tablet: Horizontal toolbar, Vertical sidebar, or Drawer."
            value={desktopLayout}
            onChange={(val) => handleSettingChange("desktopFilterLayout", val)}
            options={[
              { value: "horizontal", label: "Horizontal Toolbar" },
              { value: "vertical", label: "Vertical Sidebar" },
              { value: "drawer", label: "Drawer" },
            ]}
          />
          <SettingFilterWidth disabled={isSaving} label="Drawer width" value={drawerWidth} onChange={value=>handleSettingChange('drawerWidth',value)}
            description="Applies to Drawer filters on screens wider than 768 px. Reload the storefront after saving." />
          <SettingFilterWidth disabled={isSaving} label="Vertical sidebar width" value={verticalWidth} onChange={value=>handleSettingChange('verticalFilterWidth',value)}
            description="Applies to the Vertical sidebar on desktop and tablet. Space is kept for products. Reload the storefront after saving." />
          <SettingSelect disabled={isSaving}
                        label="Mobile filter layout"
            description="Choose the display layout for filters on mobile."
            value={mobileLayout}
            onChange={(val) => handleSettingChange("mobileFilterLayout", val)}
            options={[
              { value: "off-canvas", label: "Off-canvas" },
              { value: "horizontal-scrolling", label: "Horizontal scrolling" },
            ]}
          />
          {mobileLayout==='off-canvas'?<SettingFilterWidth disabled={isSaving} mobile label="Off-canvas filter width" value={mobileDrawerWidth} onChange={value=>handleSettingChange('mobileDrawerWidth',value)}
            description="Sets the slide-out filter panel width on screens up to 768 px. The panel automatically fits within the screen."/>:
          <SettingFilterWidth disabled={isSaving} mobile popover defaultWidth={300} label="Horizontal filter dropdown width" value={mobileHorizontalWidth} onChange={value=>handleSettingChange('mobileHorizontalFilterWidth',value)}
            description="Sets the width of the options panel opened from the scrolling filter bar. It fits within the screen with space at each edge."/>}
          <SettingToggle disabled={isSaving}
                        label="Show attribute based breadcrumb"
            description="When enabled, the attribute based breadcrumb showing the active filters is displayed."
            value={showBreadcrumb}
            onChange={(val) => handleSettingChange("showAttributeBasedBreadcrumb", val)}
          />
          <SettingToggle disabled={isSaving}
                        label="Show filter options even if they have only one item"
            description="When enabled, a filter with only one filter value and its product count equals to the number of showing products are still shown. By default this option is turned off because the collection page is the same with or without the filter value selected."
            value={showSingleItem}
            onChange={(val) => handleSettingChange("showFilterOptionsWithOneItem", val)}
          />
          <SettingToggle disabled={isSaving}
                        label="Show product count"
            description="When enabled, the number of products are shown on the right on filter options."
            value={showProductCount}
            onChange={(val) => handleSettingChange("showProductCount", val)}
          />
          <SettingToggle disabled={isSaving}
                        label="Scroll up on filter values change"
            description="Scroll to the top of the page when filter values change in any layout. If the filter drawer is open, scrolling waits until it closes. Reload the storefront after saving."
            value={scrollOnChange}
            onChange={(val) => handleSettingChange("scrollUpOnFilterValuesChange", val)}
          />
          <SettingToggle disabled={isSaving}
                        label="Hide unavailable variants if a filter value is selected"
            description="After a filter is selected, show only available variants matching the selection. Products without an available match are excluded. Applies to app filter results and product cards; reload the storefront after saving."
            value={hideUnavailableVariants}
            onChange={(val) => handleSettingChange("hideUnavailableVariantsWhenSelected", val)}
          />
        </SettingsSection>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
