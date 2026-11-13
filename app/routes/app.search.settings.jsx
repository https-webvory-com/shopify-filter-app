import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { useState, useEffect } from 'react';
import { getSearchSettings, saveSearchSettings, resetSearchSettings } from '../services/searchSettings.server.js';
import { DEFAULT_SEARCH_SETTINGS, SEARCH_SETTING_FIELDS, ADVANCED_SEARCH_FIELDS, SEARCH_ENUM_FIELDS, validateSearchSettings } from '../utils/searchSettings.js';
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import SearchConfigurationLayout from '../components/SearchConfigurationLayout';
import CompactSearchSettings from '../components/CompactSearchSettings';
import SearchIndexSettings from '../components/SearchIndexSettings';
import {getSearchIndexStatus} from '../services/searchIndex.server.js';
import { listSearchCollections, listSearchProducts } from '../services/searchCollectionPicker.server.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  if(url.searchParams.get('productPicker')==='1'){
    const query=url.searchParams.get('q')||'';
    try{return await listSearchProducts(session.shop,{query});}
    catch{return {query,products:[],productPickerError:'Could not load products. Please retry.'};}
  }
  if (url.searchParams.get('collectionPicker') === '1') {
    const query = url.searchParams.get('q') || '', after = url.searchParams.get('after') || '';
    try { return await listSearchCollections(session.shop, { query, after }); }
    catch { return { query, after, collections: [], hasMore: false, nextCursor: '', collectionPickerError: 'Could not load saved collections. Please retry.' }; }
  }
  const [settings,indexStatus]=await Promise.all([getSearchSettings(session.shop),getSearchIndexStatus(session.shop)]);
  return {settings,indexStatus};
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get('intent') === 'reset') {
    try { await resetSearchSettings(session.shop); return { success: true, settings: null,indexStatus:{phase:'default'} }; }
    catch { return { error: 'Could not restore defaults. Please retry.' }; }
  }
  if (form.get('intent') !== 'save') return { error: 'Unknown settings action.' };
  let settings;
  try { settings = validateSearchSettings(JSON.parse(String(form.get('settings') || ''))); }
  catch (error) { return { error: error instanceof SyntaxError ? 'Invalid search settings.' : error.message }; }
  try { const saved=await saveSearchSettings(session.shop, settings,{preserveEmptyPins:true}); return { success: true, settings:saved,indexStatus:await getSearchIndexStatus(session.shop) }; }
  catch { return { error: 'Could not save search settings. Please retry.' }; }
};

const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };
const settingsStyles = `
.cs-editor .cs-tab-text{display:grid;gap:6px;margin:0 0 20px;font-size:13px;font-weight:600}.cs-editor .cs-tab-text input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9cccf;border-radius:6px;font:inherit}.cs-editor .cs-tab-text small{line-height:1.5}
.cs-editor .cs-sortable-tab{display:flex;align-items:center;border:1px solid #e8e1f1;border-radius:10px;background:#fff;min-width:0}.cs-editor .cs-sortable-tab:has([aria-selected=true]){background:#f5f0ff;border-color:#8b5cf6;box-shadow:0 0 0 1px #8b5cf6}.cs-editor .cs-tabs .cs-sortable-tab>button[role=tab]{border:0!important;box-shadow:none!important;background:transparent!important;padding-left:4px}.cs-editor button.cs-drag-handle{display:inline-flex;align-items:center;justify-content:center;flex:none;padding:5px;border:0;border-radius:6px;background:transparent;color:#9a8daa;cursor:grab;touch-action:none}.cs-editor button.cs-drag-handle:hover{background:#ede9fe;color:#5b21b6}.cs-editor button.cs-drag-handle:active{cursor:grabbing}.cs-editor [data-dragging=true]{box-shadow:0 8px 25px #3b176526;border-radius:12px;background:#faf8ff}.cs-editor .cs-main-actions{align-items:center}.cs-editor .cs-collection-row>.cs-drag-handle{margin-left:-5px}
.search-settings-page .settings-section-title,.search-settings-page .settings-save-actions{flex-wrap:wrap}.cs-editor .cs-picker-footer{flex-wrap:wrap}
.cs-editor .cs-picker{width:min(620px,calc(100vw - 32px));max-height:min(680px,calc(100dvh - 32px));padding:0;border:1px solid #e6dff0;border-radius:18px;box-shadow:0 20px 80px #23103b40;color:#1e1b4b}.cs-editor .cs-picker[open]{display:flex;flex-direction:column}.cs-editor .cs-picker::backdrop{background:#170d2b66;backdrop-filter:blur(2px)}.cs-editor .cs-picker-heading{display:flex;justify-content:space-between;align-items:center;padding:20px 22px;border-bottom:1px solid #eee9f6;gap:16px}.cs-editor .cs-picker-heading h3{margin:0;font-size:17px}.cs-editor .cs-picker-heading p{margin:4px 0 0;font-size:12px}.cs-editor .cs-picker-heading button{border:0;padding:5px 10px;font-size:20px}.cs-editor .cs-picker-search{padding:14px 20px}.cs-editor .cs-picker-search input{width:100%;padding:12px!important}.cs-editor .cs-picker-results{overflow-y:auto;min-height:200px;padding:0 20px;overscroll-behavior:contain}.cs-editor .cs-picker-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid #f0edf6;cursor:pointer}.cs-editor .cs-picker-row:has(input:checked){background:#faf7ff}.cs-editor .cs-picker-row img,.cs-editor .cs-picker-row .cs-thumb{width:36px;height:46px;object-fit:cover;border-radius:5px;background:#f3eff8;flex:none}.cs-editor .cs-picker-row>span:last-child{display:grid;gap:4px;min-width:0}.cs-editor .cs-picker-row strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.cs-editor .cs-picker-row small{font-size:11px;color:#8b809a;overflow-wrap:anywhere}.cs-editor .cs-picker-footer{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;gap:12px;border-top:1px solid #eee9f6;font-size:12px;background:#fcfbfe}.cs-editor .cs-picker-footer>div{display:flex;gap:8px}.cs-editor .cs-picker-more{display:block;margin:14px auto}.cs-editor .cs-picker-row input:disabled{opacity:.4}
.search-settings-page{display:grid;gap:22px;min-width:0}.search-settings-page .settings-intro{display:flex;justify-content:space-between;gap:16px;align-items:center}.search-settings-page .settings-intro h2{font-size:23px;margin:0 0 6px}.search-settings-page .settings-intro p{margin:0}.search-settings-page .settings-badge{font-size:11px;color:#5b21b6;background:#ede9fe;border-radius:20px;padding:6px 11px;white-space:nowrap}.search-settings-page .settings-tabs{display:flex;gap:4px;padding:5px;background:#edeaf3;border-radius:12px;width:fit-content;max-width:100%}.search-settings-page .settings-tabs button{border:0;background:none;color:#776d89;padding:10px 18px}.search-settings-page .settings-tabs button[aria-selected=true]{background:white;color:#5b21b6;box-shadow:0 1px 4px #22133d12}.search-settings-page fieldset{border:0}.search-settings-page .settings-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.search-settings-page .settings-section-title h2{margin:0}.search-settings-page .settings-mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.search-settings-page button.settings-mode{display:grid;grid-template-columns:130px minmax(0,1fr) 20px;align-items:center;gap:18px;border-radius:14px;text-align:left;padding:18px;color:#1e1b4b;background:white;min-width:0}.search-settings-page button.settings-mode[aria-pressed=true]{border-color:#7c3aed;box-shadow:0 0 0 1px #7c3aed;background:#faf8ff}.search-settings-page .settings-mode-copy{display:grid;gap:7px}.search-settings-page .settings-mode-copy strong{font-size:15px}.search-settings-page .settings-mode-copy small{font-size:12px;line-height:1.6;color:#857b94;font-weight:400}.search-settings-page .settings-mode-check{width:18px;height:18px;border:1px solid #cfc7dd;border-radius:50%;display:grid;place-items:center;font-size:11px;color:transparent}.search-settings-page [aria-pressed=true] .settings-mode-check{color:white;background:#6d28d9;border-color:#6d28d9}.search-settings-page .settings-mini{height:86px;background:#f0edf6;border-radius:8px;padding:10px;display:flex;justify-content:flex-end;align-items:flex-start}.search-settings-page .settings-mini-panel{width:65%;height:66px;background:white;border-radius:7px;box-shadow:0 2px 4px #0001;padding:6px;display:grid;gap:4px;align-content:start}.search-settings-page .settings-mini-panel i{display:block;height:4px;background:#e5deef;border-radius:2px}.search-settings-page .settings-mini-panel b{display:block;height:35px;background:repeating-linear-gradient(90deg,#f1edf6 0 16px,white 16px 20px)}.search-settings-page .settings-mini[data-mode=fullscreen]{align-items:flex-start;justify-content:stretch}.search-settings-page .settings-mini[data-mode=fullscreen] .settings-mini-panel{width:100%;height:59px;border-radius:3px}.search-settings-page .settings-detail{background:#faf9fc;border:1px solid #eee9f6;border-radius:12px;padding:18px}.search-settings-page .settings-detail summary{cursor:pointer;font-weight:600;color:#5b21b6;font-size:13px}.search-settings-page .settings-detail[open] summary{margin-bottom:18px}.search-settings-page .settings-subheading{margin:10px 0 0;font-size:14px}.search-settings-page .settings-help{margin:0;font-size:12px}.search-settings-page .settings-save-bar{position:sticky;bottom:12px;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 20px;background:#fff;border:1px solid #e8e1f1;border-radius:12px;box-shadow:0 4px 18px #32145b12}.search-settings-page .settings-save-actions{display:flex;gap:10px}.search-settings-page .settings-save-state{font-size:12px;color:#84788f}.search-settings-page table th{text-align:left;padding:13px;background:#f8f6fb;font-size:12px;color:#857793}.search-settings-page table td{padding:13px;font-size:13px}.search-settings-page table td small{font-size:11px;color:#9b91a6;margin-top:4px}.search-settings-page table tbody tr:hover{background:#fdfbff}.search-settings-page select{padding:10px}.search-settings-page input[type=checkbox]{accent-color:#6d28d9}
.cs-editor{border:1px solid #e9e4f5;border-radius:16px;overflow:hidden;background:#fff;color:#1e1b4b}.cs-editor .cs-heading{padding:24px;border-bottom:1px solid #eee9f6;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;background:linear-gradient(110deg,#faf8ff,#fff)}.cs-editor .cs-heading h3{margin:0 0 6px;font-size:17px}.cs-editor .cs-heading p{margin:0;max-width:590px}.cs-editor .cs-step{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#ede9fe;color:#5b21b6;font-size:12px;margin-right:8px}.cs-editor .cs-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,420px);min-width:0}.cs-editor .cs-controls{padding:24px;min-width:0}.cs-editor .cs-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:13px;font-weight:650}.cs-editor .cs-muted{color:#8b849c;font-size:12px;font-weight:400}.cs-editor .cs-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.cs-editor .cs-tabs button{border-radius:10px;padding:10px 12px;display:flex;gap:8px;align-items:center}.cs-editor .cs-tabs button[aria-selected=true]{background:#f5f0ff;border-color:#8b5cf6;color:#5b21b6;box-shadow:0 0 0 1px #8b5cf6}.cs-editor .cs-tab-number{background:#ede9fe;border-radius:5px;padding:1px 5px;font-size:11px}.cs-editor .cs-main-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}.cs-editor .cs-main-actions button{font-size:11px;padding:6px 9px}.cs-editor .cs-group{border:1px solid #ece8f2;border-radius:12px;margin-top:12px;overflow:hidden}.cs-editor .cs-group-head{padding:12px 14px;background:#fcfbfe;display:flex;gap:10px;align-items:center;border-bottom:1px solid #f0edf5}.cs-editor .cs-group-head label{flex:1;min-width:0}.cs-editor .cs-group-head input{width:100%;min-width:0;padding:7px 9px!important;font-weight:600}.cs-editor .cs-group-head button{white-space:nowrap;font-size:11px;padding:8px}.cs-editor .cs-group ol{list-style:none;padding:0;margin:0}.cs-editor .cs-collection-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid #f4f1f8}.cs-editor .cs-collection-row:first-child{border-top:0}.cs-editor .cs-collection-row img,.cs-editor .cs-thumb{width:30px;height:40px;object-fit:cover;border-radius:5px;background:#f1eef6;flex:none}.cs-editor .cs-collection-row>span:nth-last-child(2){flex:1;min-width:0;font-size:12px;overflow-wrap:anywhere}.cs-editor .cs-row-actions{display:flex;gap:3px}.cs-editor .cs-row-actions button{padding:4px 6px;border:0;font-size:11px}.cs-editor .cs-empty{padding:16px;color:#8b849c;font-size:12px;text-align:center}.cs-editor button.cs-add-empty{width:100%;border:1px dashed #c4b5fd;background:#faf8ff;padding:30px 16px;border-radius:12px;color:#5b21b6;text-align:center;display:grid;gap:12px}.cs-editor .cs-add-empty span{font-weight:400;font-size:12px;line-height:1.6}
.cs-editor .cs-preview-area{padding:22px 16px;background:#f8f7fb;border-left:1px solid #eee9f6;min-width:0}.cs-editor .cs-preview-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px;font-size:12px;font-weight:650}.cs-editor .cs-device-buttons{display:flex;padding:3px;border:1px solid #e8e3ef;border-radius:8px;background:white}.cs-editor .cs-device-buttons button{padding:5px 8px;font-size:11px;border:0;border-radius:5px}.cs-editor .cs-device-buttons button[aria-pressed=true]{background:#ede9fe;color:#5b21b6}.cs-editor .cs-preview{background:#fff;border:1px solid #e8e5ec;border-radius:22px;box-shadow:0 3px 12px #22133d12;padding:0 14px;color:#111;max-width:100%;margin:auto;transition:width .2s;width:100%;font-family:Arial,sans-serif}.cs-editor .cs-preview[data-mobile=true]{width:320px}.cs-editor .cs-preview-search{display:flex;align-items:center;gap:8px;padding:15px 0;font-size:13px;color:#aaa}.cs-editor .cs-preview-search span:last-child{margin-left:auto;color:#555}.cs-editor .cs-preview-tabs{display:flex;gap:16px;border-bottom:1px solid #e5e5e5;min-width:0}.cs-editor .cs-preview-tabs button{font-size:11px;padding:10px 0 8px;border:0;border-bottom:3px solid transparent;border-radius:0;color:#111;background:none;min-width:0;overflow-wrap:anywhere}.cs-editor .cs-preview-tabs button[aria-selected=true]{border-bottom-color:#111}.cs-editor .cs-preview h4{font-size:12px;margin:15px 0 8px;color:#111}.cs-editor .cs-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:17px}.cs-editor .cs-chips span{padding:5px 8px;border:1px solid #e3e3e3;border-radius:18px;font-size:10px;box-shadow:0 1px 2px #0001}.cs-editor .cs-preview-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cs-editor .cs-preview-columns h4{font-size:11px;margin:0 0 6px;overflow-wrap:anywhere}.cs-editor .cs-preview-columns ol{list-style:none;margin:0;padding:0}.cs-editor .cs-preview-columns li{display:flex;align-items:center;gap:5px;border-bottom:1px solid #e5e5e5;height:67px;font-size:9px;min-width:0}.cs-editor .cs-preview-columns img,.cs-editor .cs-preview-placeholder{width:30px;height:48px;object-fit:cover;background:#f6f6f6;flex:none}.cs-editor .cs-preview-columns li>span:last-child{overflow-wrap:anywhere}.cs-editor .cs-preview-pages{display:flex;justify-content:center;align-items:center;gap:8px;padding:9px 0;font-size:10px}.cs-editor .cs-preview-pages button{border:0;background:none;font-size:10px;padding:3px;color:#111}.cs-editor .cs-preview-note{text-align:center;font-size:11px!important;margin-bottom:0}.cs-editor .cs-footer{padding:12px 24px;border-top:1px solid #eee9f6;background:#fcfbfe;font-size:12px;color:#7a728a}
@media(max-width:1200px){.search-settings-page button.settings-mode{grid-template-columns:90px minmax(0,1fr) 18px;gap:12px}.cs-editor .cs-workspace{grid-template-columns:minmax(0,1fr)}.cs-editor .cs-preview-area{border-left:0;border-top:1px solid #eee9f6}.cs-editor .cs-preview{max-width:420px}}@media(max-width:700px){.search-settings-page .settings-mode-grid{grid-template-columns:1fr}.search-settings-page .settings-intro{align-items:flex-start}.search-settings-page .settings-tabs button{padding:10px;font-size:12px}.cs-editor .cs-heading{flex-direction:column;padding:18px}.cs-editor .cs-controls{padding:16px}.cs-editor .cs-group-head{flex-wrap:wrap}.cs-editor .cs-group-head label{flex:1;min-width:140px}.cs-editor .cs-preview-columns{gap:6px}.cs-editor .cs-preview-columns img,.cs-editor .cs-preview-placeholder{width:25px}.cs-editor .cs-preview-tabs{gap:10px}}
`;

export default function SearchSettings() {
  const navigate = useNavigate();
  const loaded = useLoaderData();
  const fetcher = useFetcher();
  const indexFetcher=useFetcher();
  const [values, setValues] = useState(loaded.settings || DEFAULT_SEARCH_SETTINGS);
  const [manual, setManual] = useState((loaded.settings?.manualSuggestions || []).join('\n'));
  const [tab,setTab]=useState('instant');
  const [indexStatus,setIndexStatus]=useState(loaded.indexStatus);
  const busy = fetcher.state !== 'idle';
  useEffect(()=>{if(indexFetcher.data?.indexStatus)setIndexStatus(indexFetcher.data.indexStatus);},[indexFetcher.data]);
  useEffect(()=>{if(!['queued','building'].includes(indexStatus?.phase))return;const timer=setInterval(()=>indexFetcher.load('/app/search/settings'),5000);return ()=>clearInterval(timer);},[indexStatus?.phase]);
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setValues(fetcher.data.settings || DEFAULT_SEARCH_SETTINGS);
      setManual((fetcher.data.settings?.manualSuggestions || []).join('\n'));
      setIndexStatus(fetcher.data.indexStatus);
    }
  }, [fetcher.state, fetcher.data]);
  const field = key => {
    const [label, fallback, min, max] = SEARCH_SETTING_FIELDS[key]||ADVANCED_SEARCH_FIELDS[key];
    return <label key={key} style={{ display: 'grid', gap: 6 }}>
      {typeof fallback === 'boolean' ? <span><input name={key} type="checkbox" checked={values[key]} disabled={busy} onChange={e => setValues(v => ({ ...v, [key]: e.target.checked }))} /> {label}</span>
        : <><span>{label} ({min}–{max})</span><input name={key} type="number" min={min} max={max} step="1" required value={values[key]} disabled={busy} style={fieldStyle} onChange={e => setValues(v => ({ ...v, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} /></>}
    </label>;
  };
  const update=(key,value)=>setValues(v=>({...v,[key]:value}));
  const select=(key,label)=> <label style={{display:'grid',gap:6}}>{label}<select aria-label={label} value={values[key]} disabled={busy} onChange={e=>update(key,e.target.value)} style={fieldStyle}>{SEARCH_ENUM_FIELDS[key].map(value=><option key={value} value={value}>{key==='instantLayout'?({fullscreen:'Full screen UI',compact:'Compact UI'}[value]):value.replaceAll('-',' ')}</option>)}</select></label>;
  const textField=(key,label)=> <label style={{display:'grid',gap:6}}>{label}<input type={key==='fixedImageWidth'?'number':'text'} value={values[key]} disabled={busy} onChange={e=>update(key,key==='fixedImageWidth'?Number(e.target.value):e.target.value)} style={fieldStyle}/></label>;
  const listField=(key,label,help)=> <label style={{display:'grid',gap:6}}>{label}<textarea rows={3} value={(values[key]||[]).join('\n')} disabled={busy} onChange={e=>update(key,e.target.value.split('\n'))} style={fieldStyle}/><small>{help||'One entry per line.'}</small></label>;
  return (
    <s-page heading="Search Settings" full-width="true">
      <ui-title-bar title="Search Settings">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>
      <SearchConfigurationLayout>
      <div className="search-settings-page"><style>{settingsStyles}</style>
      <div className="settings-intro"><div><h2>Make search feel like your store</h2><p>Choose your search experience, curate collection links, and preview your changes.</p></div><span className="settings-badge">Search settings</span></div>
      <div role="tablist" aria-label="Search settings" className="settings-tabs">{[['instant','Instant search'],['results','Search results'],['index','Search index']].map(([key,label])=><button type="button" role="tab" aria-selected={tab===key} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div>
      <fetcher.Form method="post" onSubmit={e => {
        if (e.nativeEvent.submitter?.value === 'reset') return;
        e.preventDefault();
        fetcher.submit({ intent: 'save', settings: JSON.stringify({ ...values, manualSuggestions: manual.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }) }, { method: 'post' });
      }} style={{ display: 'grid', gap: 20 }}>
        {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
        {fetcher.data?.success && <p role="status">Search settings {fetcher.data.settings ? 'saved' : 'restored to defaults'}.</p>}
        {indexStatus&&['queued','building','failed'].includes(indexStatus.phase)&&<p role="status" style={{padding:12,background:indexStatus.phase==='failed'?'#fff4e5':'#eef6ff'}}>{indexStatus.phase==='failed'?indexStatus.error:`Preparing search index: ${indexStatus.processed} of ${indexStatus.total??'…'} products. The previous complete search remains available until preparation finishes.`}</p>}
        {tab==='index'&&<SearchIndexSettings value={values} onChange={setValues} disabled={busy} indexStatus={indexStatus}/>}
        {tab==='instant'&&<fieldset disabled={busy} className="search-config-card" style={{ margin: 0, display: 'grid', gap: 16 }} aria-labelledby="instant-search-heading">
          <div className="settings-section-title"><h2 id="instant-search-heading">Instant search experience</h2>{field('instantSearchEnabled')}</div>
          <p className="settings-help">Compact UI opens a small search panel at your header. Full screen UI keeps the original wide search experience.</p>
          <div className="settings-mode-grid">{[['compact','Compact UI','A small panel with collection tabs, hot searches and ranked image links.'],['fullscreen','Full screen UI','Your original wide search with product cards and suggestions.']].map(([mode,title,description])=><button key={mode} type="button" className="settings-mode" aria-pressed={values.instantLayout===mode} disabled={busy} onClick={()=>update('instantLayout',mode)}><span className="settings-mini" data-mode={mode}><span className="settings-mini-panel"><i/><i/><b/></span></span><span className="settings-mode-copy"><strong>{title}</strong><small>{description}</small></span><span className="settings-mode-check" aria-hidden="true">✓</span></button>)}</div>
          {values.instantLayout==='compact'&&<section aria-label="Compact UI settings" style={{display:'grid',gap:16}}>
            <CompactSearchSettings value={values.compactCollections||[]} suggestions={manual.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)} disabled={busy} onChange={value=>update('compactCollections',value)}/>
            <h3 className="settings-subheading">Compact hot searches</h3>
            <label style={{display:'grid',gap:6}}>Hot searches<textarea name="manualSuggestions" value={manual} onChange={e=>setManual(e.target.value)} rows={4} maxLength={1100} style={fieldStyle}/></label>
            <p className="settings-help">Enter up to 10 terms, one per line. They appear in the Compact panel before a customer starts typing. Blacklisted terms stay hidden.</p>
            <details className="settings-detail"><summary>Compact search behavior</summary><div className="search-config-fields">{['productLimit','suggestionLimit','minChars','showPopularProducts','popularProductLimit'].map(field)}{textField('searchBoxSelector','Custom search box selector')}</div></details>
          </section>}
          {values.instantLayout==='fullscreen'&&<section aria-label="Full screen UI settings" style={{display:'grid',gap:16}}>
          <h3 className="settings-subheading">Full screen search suggestions</h3>
          <div className="search-config-fields">{['productLimit', 'suggestionLimit', 'collectionLimit', 'recentLimit', 'minChars'].map(field)}</div>
          <p style={{ margin: 0 }}>A count of zero hides that suggestion section. Recent searches are stored in the customer’s browser.</p>
          <label style={{ display: 'grid', gap: 6 }}>Manual suggestions<textarea name="manualSuggestions" value={manual} onChange={e => setManual(e.target.value)} rows={5} maxLength={1100} style={fieldStyle} /></label>
          <p style={{ margin: 0 }}>Enter up to 10 search terms, one per line. They appear in this order when the search box is empty, replacing recent searches. Blacklisted terms stay hidden.</p>
          {field('showPages')}{field('pageLimit')}
          <details className="settings-detail"><summary>Full screen display settings</summary><div className="search-config-fields">{select('productColumn','Product column position')}{field('instantColumns')}{textField('searchBoxSelector','Custom search box selector')}</div></details>
          </section>}
        </fieldset>}
        {tab==='results'&&<fieldset disabled={busy} className="search-config-card" style={{ margin: 0, display: 'grid', gap: 16 }} aria-labelledby="search-results-heading">
          <h2 id="search-results-heading">Search results page</h2>
          <div className="search-config-fields">{['pageSize', 'showSearchInput', 'showVendor', 'showSale', 'showSoldOut'].map(field)}</div>
          <p style={{ margin: 0 }}>These controls require this app’s search results widget on your search template. Collection pages keep their existing settings.</p>
          {textField('searchResultsPath','Search results page URL')}{field('showCollectionSearchInput')}{field('changeBrowserUrl')}{select('pagination','Search results pagination')}{field('broadMatch')}{field('smartSkuSearch')}
          <p>SKU/model codes retain precise matching. Smart SKU search adds a punctuation-normalized, typo-tolerant fallback when no precise SKU matches.</p>
          {select('imageSizeType','Search product image size')}{textField('fixedImageWidth','Fixed image width (100–2000 pixels)')}{textField('priceUnit','Price unit, for example Per Yard')}{listField('returnedMetafields','Metafields returned with search products','Use namespace.key, one per line. Leave empty to retain all available product metafields.')}
        </fieldset>}
        <div className="settings-save-bar"><span className="settings-save-state">Changes apply after you save. Your current storefront stays active while you edit.</span><div className="settings-save-actions">
          <button type="submit" name="intent" value="save" disabled={busy} className="search-config-primary">{busy ? 'Saving…' : 'Save settings'}</button>
          <button type="submit" name="intent" value="reset" formNoValidate disabled={busy}>Restore defaults</button>
        </div></div>
      </fetcher.Form>
      </div>
      </SearchConfigurationLayout>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
