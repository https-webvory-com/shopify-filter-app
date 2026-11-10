import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { useState, useEffect } from 'react';
import { getSearchSettings, saveSearchSettings, resetSearchSettings } from '../services/searchSettings.server.js';
import { DEFAULT_SEARCH_SETTINGS, SEARCH_SETTING_FIELDS, ADVANCED_SEARCH_FIELDS, SEARCH_ENUM_FIELDS, validateSearchSettings } from '../utils/searchSettings.js';
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import SearchConfigurationLayout from '../components/SearchConfigurationLayout';
import CompactSearchSettings from '../components/CompactSearchSettings';
import {getSearchIndexStatus} from '../services/searchIndex.server.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getSearchSettings(session.shop),indexStatus:await getSearchIndexStatus(session.shop) };
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
  try { await saveSearchSettings(session.shop, settings); return { success: true, settings,indexStatus:await getSearchIndexStatus(session.shop) }; }
  catch { return { error: 'Could not save search settings. Please retry.' }; }
};

const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };

export default function SearchSettings() {
  const navigate = useNavigate();
  const loaded = useLoaderData();
  const fetcher = useFetcher();
  const indexFetcher=useFetcher();
  const [values, setValues] = useState(loaded.settings || DEFAULT_SEARCH_SETTINGS);
  const [manual, setManual] = useState((loaded.settings?.manualSuggestions || []).join('\n'));
  const [tab,setTab]=useState('index');
  const [newField,setNewField]=useState('');
  const [newFieldType,setNewFieldType]=useState('option');
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
  const select=(key,label)=> <label style={{display:'grid',gap:6}}>{label}<select value={values[key]} disabled={busy} onChange={e=>update(key,e.target.value)} style={fieldStyle}>{SEARCH_ENUM_FIELDS[key].map(value=><option key={value} value={value}>{key==='instantLayout'?({fullscreen:'Full screen UI',compact:'Compact UI','two-columns':'Two columns',grid:'Grid'}[value]):value.replaceAll('-',' ')}</option>)}</select></label>;
  const textField=(key,label)=> <label style={{display:'grid',gap:6}}>{label}<input type={key==='fixedImageWidth'?'number':'text'} value={values[key]} disabled={busy} onChange={e=>update(key,key==='fixedImageWidth'?Number(e.target.value):e.target.value)} style={fieldStyle}/></label>;
  const listField=(key,label,help)=> <label style={{display:'grid',gap:6}}>{label}<textarea rows={3} value={(values[key]||[]).join('\n')} disabled={busy} onChange={e=>update(key,e.target.value.split('\n'))} style={fieldStyle}/><small>{help||'One entry per line.'}</small></label>;
  const updateField=(index,patch)=>setValues(v=>({...v,fields:v.fields.map((field,i)=>i===index?{...field,...patch}:field)}));
  const transformEditor=(index,key)=> <div style={{display:'grid',gap:8}}><strong>{key==='transforms'?'Transform displayed field values':'Transform values used for searching'}</strong>{values.fields[index][key].map((rule,i)=><div key={i} style={{display:'flex',gap:6,flexWrap:'wrap'}}><select aria-label="Transformation" value={rule.type} onChange={e=>updateField(index,{[key]:values.fields[index][key].map((r,j)=>j===i?{type:e.target.value,value:'',replacement:''}:r)})}>{['trim','trim-start','trim-end','lowercase','uppercase','strip-html','remove-prefix','remove-suffix','replace'].map(type=><option key={type}>{type}</option>)}</select>{['remove-prefix','remove-suffix','replace'].includes(rule.type)&&<input aria-label="Text to transform" value={rule.value} onChange={e=>updateField(index,{[key]:values.fields[index][key].map((r,j)=>j===i?{...r,value:e.target.value}:r)})}/>} {rule.type==='replace'&&<input aria-label="Replacement text" value={rule.replacement} onChange={e=>updateField(index,{[key]:values.fields[index][key].map((r,j)=>j===i?{...r,replacement:e.target.value}:r)})}/>}<button type="button" onClick={()=>updateField(index,{[key]:values.fields[index][key].filter((_,j)=>j!==i)})}>Remove</button></div>)}<button type="button" disabled={values.fields[index][key].length>=10} onClick={()=>updateField(index,{[key]:[...values.fields[index][key],{type:'trim'}]})}>Add transformation</button></div>;
  return (
    <s-page heading="Search Settings" full-width="true">
      <ui-title-bar title="Search Settings">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>
      <SearchConfigurationLayout>
      <p style={{ margin: 0 }}>Configure this app’s instant search and search results widget. Saved settings apply on new page loads. Restoring defaults returns control to your theme and app defaults.</p>
      <div role="tablist" aria-label="Search settings" style={{display:'flex',gap:8,margin:'16px 0'}}>{[['index','Search index'],['results','Search results'],['instant','Instant search']].map(([key,label])=><button type="button" role="tab" aria-selected={tab===key} key={key} onClick={()=>setTab(key)} className={tab===key?'search-config-primary':undefined}>{label}</button>)}</div>
      <fetcher.Form method="post" onSubmit={e => {
        if (e.nativeEvent.submitter?.value === 'reset') return;
        e.preventDefault();
        fetcher.submit({ intent: 'save', settings: JSON.stringify({ ...values, manualSuggestions: manual.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }) }, { method: 'post' });
      }} style={{ display: 'grid', gap: 20 }}>
        {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
        {fetcher.data?.success && <p role="status">Search settings {fetcher.data.settings ? 'saved' : 'restored to defaults'}.</p>}
        {indexStatus&&['queued','building','failed'].includes(indexStatus.phase)&&<p role="status" style={{padding:12,background:indexStatus.phase==='failed'?'#fff4e5':'#eef6ff'}}>{indexStatus.phase==='failed'?indexStatus.error:`Preparing search index: ${indexStatus.processed} of ${indexStatus.total??'…'} products. The previous complete search remains available until preparation finishes.`}</p>}
        {tab==='index'&&<>
        <fieldset disabled={busy} className="search-config-card" style={{display:'grid',gap:16,margin:0}}><legend>Searchable fields</legend><p>Choose fields independently for product results and suggestions. Higher weights give fields higher search priority; a weight of zero disables the field. Index changes prepare in the background before becoming active.</p>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>Field</th><th>Weight (0–1)</th><th>Results</th><th>Suggestions</th><th>Advanced</th></tr></thead><tbody>{values.fields.map((row,index)=><tr key={row.key} style={{borderBottom:'1px solid #ddd'}}><td>{row.label}<small style={{display:'block'}}>{row.key}</small></td><td><input type="number" min="0" max="1" step="0.05" value={row.weight} style={{width:80}} aria-label={row.label+' weight'} onChange={e=>updateField(index,{weight:e.target.value===''?'':Number(e.target.value)})}/></td>{['search','suggest'].map(key=><td key={key}><input type="checkbox" checked={row[key]} aria-label={row.label+' '+key} onChange={e=>updateField(index,{[key]:e.target.checked})}/></td>)}<td><details><summary>Settings</summary><div style={{display:'grid',gap:12,padding:12,minWidth:250}}><label>Split values by <input value={row.delimiter} maxLength={10} onChange={e=>updateField(index,{delimiter:e.target.value})}/></label><label><input type="checkbox" checked={row.numeric} onChange={e=>updateField(index,{numeric:e.target.checked})}/> Treat values as numbers</label>{transformEditor(index,'transforms')}{transformEditor(index,'indexTransforms')}<button type="button" onClick={()=>update('fields',values.fields.filter((_,i)=>i!==index))}>Remove field</button></div></details></td></tr>)}</tbody></table></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><select aria-label="New field type" value={newFieldType} onChange={e=>setNewFieldType(e.target.value)}><option value="option">Product option</option><option value="productMetafield">Product metafield</option><option value="variantMetafield">Variant metafield</option></select><input aria-label="New field name" value={newField} onChange={e=>setNewField(e.target.value)} placeholder={newFieldType==='option'?'Color':'namespace.key'}/><button type="button" onClick={()=>{const key=newFieldType+':'+newField.trim();if(!newField.trim()||values.fields.some(f=>f.key===key))return;update('fields',[...values.fields,{key,label:newField.trim(),weight:.5,search:true,suggest:false,numeric:false,delimiter:'',transforms:[],indexTransforms:[]}]);setNewField('');}}>Add search field</button></div>
        </fieldset>
        <fieldset disabled={busy} className="search-config-card" style={{display:'grid',gap:16,margin:0}}><legend>Index and tokenization</legend>{listField('stopwords','Stopwords','Words ignored during text matching, one per line.')}{listField('tokenDelimiters','Token delimiters','One character per line. These always separate words.')}{listField('tentativeDelimiters','Tentative delimiters','One character per line. These separate words when next to whitespace.')}{select('productDateType','Product date used for date sorting')}{['hideUnavailableVariants','omitProductMetafields','omitProductMetaobjects','omitVariantMetafields','omitVariantMetaobjects'].map(field)}</fieldset>
        </>}
        {tab==='instant'&&<fieldset disabled={busy} className="search-config-card" style={{ margin: 0, display: 'grid', gap: 16 }} aria-labelledby="instant-search-heading">
          <h2 id="instant-search-heading">Instant search</h2>
          {field('instantSearchEnabled')}{select('instantLayout','Instant search layout')}{select('productColumn','Product column position')}{field('instantColumns')}{textField('searchBoxSelector','Custom search box selector')}
          {values.instantLayout==='compact'&&<CompactSearchSettings value={values.compactCollections||[]} disabled={busy} onChange={value=>update('compactCollections',value)}/>}
          <div className="search-config-fields">{['productLimit', 'suggestionLimit', 'collectionLimit', 'recentLimit', 'minChars'].map(field)}</div>
          <p style={{ margin: 0 }}>A count of zero hides that suggestion section. Recent searches are stored in the customer’s browser.</p>
          <label style={{ display: 'grid', gap: 6 }}>Manual suggestions<textarea name="manualSuggestions" value={manual} onChange={e => setManual(e.target.value)} rows={5} maxLength={1100} style={fieldStyle} /></label>
          <p style={{ margin: 0 }}>Enter up to 10 search terms, one per line. They appear in this order when the search box is empty, replacing recent searches. Blacklisted terms stay hidden.</p>
          {field('showPages')}{field('pageLimit')}{field('showPopularProducts')}{field('popularProductLimit')}
        </fieldset>}
        {tab==='results'&&<fieldset disabled={busy} className="search-config-card" style={{ margin: 0, display: 'grid', gap: 16 }} aria-labelledby="search-results-heading">
          <h2 id="search-results-heading">Search results page</h2>
          <div className="search-config-fields">{['pageSize', 'showSearchInput', 'showVendor', 'showSale', 'showSoldOut'].map(field)}</div>
          <p style={{ margin: 0 }}>These controls require this app’s search results widget on your search template. Collection pages keep their existing settings.</p>
          {textField('searchResultsPath','Search results page URL')}{field('showCollectionSearchInput')}{field('changeBrowserUrl')}{select('pagination','Search results pagination')}{field('broadMatch')}{field('smartSkuSearch')}
          <p>SKU/model codes retain precise matching. Smart SKU search adds a punctuation-normalized, typo-tolerant fallback when no precise SKU matches.</p>
          {select('imageSizeType','Search product image size')}{textField('fixedImageWidth','Fixed image width (100–2000 pixels)')}{textField('priceUnit','Price unit, for example Per Yard')}{listField('returnedMetafields','Metafields returned with search products','Use namespace.key, one per line. Leave empty to retain all available product metafields.')}
        </fieldset>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="submit" name="intent" value="save" disabled={busy} className="search-config-primary">{busy ? 'Saving…' : 'Save settings'}</button>
          <button type="submit" name="intent" value="reset" formNoValidate disabled={busy}>Restore defaults</button>
        </div>
      </fetcher.Form>
      </SearchConfigurationLayout>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
