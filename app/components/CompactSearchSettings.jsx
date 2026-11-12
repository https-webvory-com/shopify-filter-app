import { useState, useRef, useEffect } from 'react';
import { useFetcher } from 'react-router';
import CompactSearchSortable from './CompactSearchSortable';

const groupNames = ['Top Searches', 'Trending', 'Occasion'];
const emptyGroups = () => groupNames.map(title => ({ title, collections: [] }));
const fromResource = item => ({ id: item.id, title: item.title, handle: item.handle, image: typeof item.image === 'string' ? item.image : item.image?.originalSrc || item.image?.src || item.image?.url || '' });

export default function CompactSearchSettings({ value = [], onChange, disabled, suggestions = [] }) {
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState('');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({hasMore:false,nextCursor:''});
  const collectionFetcher = useFetcher();
  const dialog = useRef(null);
  const groupKeys = useRef(new WeakMap());
  const groupKeySequence = useRef(0);
  const groupKey = group => {
    if (!groupKeys.current.has(group)) groupKeys.current.set(group, 'compact-column-' + ++groupKeySequence.current);
    return groupKeys.current.get(group);
  };
  const [activeId, setActiveId] = useState('');
  const [page, setPage] = useState(0);
  const [mobile, setMobile] = useState(false);
  const busy = disabled || !!picker;
  useEffect(() => {
    if (!picker) { if(dialog.current?.open)dialog.current.close(); return; }
    if(!dialog.current.open)dialog.current.showModal();
    const timer = setTimeout(() => collectionFetcher.load('/app/search/settings?collectionPicker=1&q=' + encodeURIComponent(query.trim()) + '&after=' + encodeURIComponent(cursor)), 200);
    return () => clearTimeout(timer);
  }, [picker, query, cursor]);
  useEffect(() => {
    const data = collectionFetcher.data;
    if (!picker || !data || data.query !== query.trim() || data.after !== cursor) return;
    setError(data.collectionPickerError || '');
    setRows(previous => cursor ? [...previous, ...(data.collections || []).filter(item => !previous.some(row => row.id === item.id))] : data.collections || []);
    setPagination({hasMore:!!data.hasMore,nextCursor:data.nextCursor||''});
  }, [collectionFetcher.data, picker, query, cursor]);
  const activeIndex = Math.max(0, value.findIndex(item => (item.id || item.handle) === activeId));
  const active = value[activeIndex];
  const groups = active?.groups?.length ? active.groups : emptyGroups();
  const maxPage = Math.max(0, ...groups.map(group => Math.ceil(group.collections.length / 4) - 1));
  const currentPage = Math.min(page, maxPage);
  const selectTab = item => { setActiveId(item.id || item.handle); setPage(0); };
  const pick = (items, limit, done) => {
    setError(''); setSelected(items); setQuery(''); setCursor(''); setRows([]);setPagination({hasMore:false,nextCursor:''});
    setPicker({limit,done});
  };
  const chooseMain = () => pick(value, 4, selected => { onChange(selected.map(item => ({ ...value.find(c => c.id === item.id), ...item, groups: value.find(c => c.id === item.id)?.groups || emptyGroups() }))); setPage(0); });
  const update = patch => onChange(value.map((item, i) => i === activeIndex ? { ...item, ...patch } : item));
  const updateGroup = (groupIndex, patch) => update({ groups: groups.map((group, i) => {
    if (i !== groupIndex) return group;
    const next = { ...group, ...patch }; groupKeys.current.set(next, groupKey(group)); return next;
  }) });
  const chips = suggestions.filter(Boolean).slice(0, 6);
  return <section className="cs-editor" aria-label="Compact UI collections" id="compact-collection-settings">
    <dialog ref={dialog} className="cs-picker" aria-labelledby="cs-picker-title" onCancel={()=>setPicker(null)} onClose={()=>setPicker(null)} onClick={event=>{if(event.target===dialog.current){const rect=dialog.current.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)setPicker(null);}}}>
      <div className="cs-picker-heading"><div><h3 id="cs-picker-title">{picker?.limit===4?'Choose main collections':'Choose related collections'}</h3><p>Collections saved in your app catalog</p></div><button type="button" aria-label="Close collection picker" onClick={()=>setPicker(null)}>×</button></div>
      <div className="cs-picker-search"><input autoFocus type="search" aria-label="Search saved collections" placeholder="Search collections by name or handle" value={query} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} onChange={e=>{setQuery(e.target.value);setCursor('');setRows([]);}}/></div>
      <div className="cs-picker-results" aria-busy={collectionFetcher.state!=='idle'}>
        {error?<div role="alert">{error}<button type="button" onClick={()=>collectionFetcher.load('/app/search/settings?collectionPicker=1&q='+encodeURIComponent(query.trim())+'&after='+encodeURIComponent(cursor))}>Retry</button></div>:null}
        {rows.map(item=>{const checked=selected.some(s=>s.id===item.id);return <label className="cs-picker-row" key={item.id}><input type="checkbox" checked={checked} disabled={!checked&&selected.length>=(picker?.limit||0)} onChange={()=>setSelected(items=>checked?items.filter(s=>s.id!==item.id):[...items,item])}/>{item.image?<img src={item.image} alt=""/>:<span className="cs-thumb"/>}<span><strong>{item.title}</strong><small>{item.handle}{typeof item.productCount==='number'?' · '+item.productCount+' products':''}</small></span></label>;})}
        {!rows.length&&!error&&collectionFetcher.state==='idle'&&collectionFetcher.data?.query===query.trim()?<div className="cs-empty">{query?'No saved collections match this search. Try another name.':'No collections are saved for this store yet.'}</div>:null}
        {collectionFetcher.state!=='idle'||(!rows.length&&!collectionFetcher.data)?<div className="cs-empty">Loading saved collections…</div>:null}
        {pagination.hasMore&&<button type="button" className="cs-picker-more" disabled={collectionFetcher.state!=='idle'} onClick={()=>setCursor(pagination.nextCursor)}>Load more collections</button>}
      </div>
      <div className="cs-picker-footer"><span>{selected.length}/{picker?.limit} selected</span><div><button type="button" onClick={()=>setPicker(null)}>Cancel</button><button type="button" className="search-config-primary" onClick={()=>{picker.done(selected.map(fromResource));setPicker(null);}}>Select collections</button></div></div>
    </dialog>
    <div className="cs-heading"><div><h3><span className="cs-step">1</span>Choose collections for Compact UI</h3><p>Choose your four main collection tabs, then add the collections shoppers see beneath each tab.</p></div><button type="button" className="search-config-primary" disabled={busy} onClick={chooseMain}>Choose main collections ({value.length}/4)</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="cs-workspace"><div className="cs-controls">
      <div className="cs-label">Main collection tabs <span className="cs-muted">{value.length} of 4 selected</span></div>
      {!active ? <button type="button" className="cs-add-empty" disabled={busy} onClick={chooseMain}><strong>+ Select main collections</strong><span>Choose collections from your Shopify catalog to build your search menu.</span></button> : <>
        <CompactSearchSortable items={value} getId={item=>'main-'+(item.id||item.handle)} disabled={busy} horizontal className="cs-tabs" itemClassName="cs-sortable-tab" role="tablist" aria-label="Edit main collection" onChange={next=>{setActiveId(active.id||active.handle);onChange(next);}} renderItem={(item,index,handle)=><>{handle}<button type="button" role="tab" aria-selected={index===activeIndex} disabled={busy} onClick={()=>selectTab(item)}><span className="cs-tab-number">{index+1}</span>{item.tabLabel?.trim() || item.title}</button></>}/>
        <div className="cs-main-actions"><span className="cs-muted">Drag the handles to reorder tabs.</span><button type="button" disabled={busy} className="search-config-danger" aria-label={'Remove main collection '+active.title} onClick={()=>onChange(value.filter((_,i)=>i!==activeIndex))}>Remove tab</button></div>
        <label className="cs-tab-text"><span>Tab text</span><input aria-label="Main collection tab text" value={active.tabLabel || ''} placeholder={active.title} maxLength={60} disabled={busy} onChange={e=>update({tabLabel:e.target.value})}/><small className="cs-muted">Text shown for {active.title}. Leave blank to use the collection name.</small></label>
        <div className="cs-label"><span><span className="cs-step">2</span>Collections shown in {active.title}</span></div><p>Choose links for each column. Rename headings and reorder links to arrange your menu.</p>
        <CompactSearchSortable items={groups} getId={groupKey} disabled={busy} onChange={next=>update({groups:next})} renderItem={(group,groupIndex,handle)=><div className="cs-group">
          <div className="cs-group-head">{handle}<label><span className="cs-muted">Column {groupIndex+1}</span><input aria-label={active.title+' column '+(groupIndex+1)+' heading'} value={group.title} maxLength={60} required disabled={busy} onChange={e=>updateGroup(groupIndex,{title:e.target.value})}/></label><button type="button" disabled={busy} onClick={()=>pick(group.collections,12,collections=>updateGroup(groupIndex,{collections}))}>Choose related collections ({group.collections.length}/12)</button></div>
          {!group.collections.length ? <div className="cs-empty">No collections added to this column yet.</div> : <CompactSearchSortable items={group.collections} getId={child=>groupKey(group)+'-'+child.handle} disabled={busy} listTag="ol" itemTag="li" itemClassName="cs-collection-row" onChange={collections=>updateGroup(groupIndex,{collections})} renderItem={(child,index,childHandle)=><>{childHandle}<span className="cs-muted">{index+1}</span>{child.image?<img src={child.image} alt=""/>:<span className="cs-thumb"/>}<span>{child.title}</span><div className="cs-row-actions"><button type="button" className="search-config-danger" disabled={busy} aria-label={'Remove related collection '+child.title} onClick={()=>updateGroup(groupIndex,{collections:group.collections.filter((_,i)=>i!==index)})}>×</button></div></>}/>}
        </div>}/>
      </>}
    </div><aside className="cs-preview-area" aria-label="Compact UI live preview">
      <div className="cs-preview-tools"><span>Live preview</span><div className="cs-device-buttons"><button type="button" aria-pressed={!mobile} onClick={()=>setMobile(false)}>Desktop</button><button type="button" aria-pressed={mobile} onClick={()=>setMobile(true)}>Mobile</button></div></div>
      <div className="cs-preview" data-mobile={mobile}><div className="cs-preview-search"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><span>Search</span><span>×</span></div>
        <div className="cs-preview-tabs" role="tablist" aria-label="Preview main collections">{(value.length?value:Array.from({length:4},(_,i)=>({title:'Tab '+(i+1),handle:'placeholder-'+i}))).map((item,index)=><button key={item.id||item.handle} type="button" role="tab" aria-selected={index===activeIndex} disabled={!value.length} onClick={()=>selectTab(item)}>{item.tabLabel?.trim() || item.title}</button>)}</div>
        <h4>Hot Searches</h4><div className="cs-chips">{(chips.length?chips:['Your popular searches','Search suggestions']).map((term,i)=><span key={i}>{term}</span>)}</div>
        <div className="cs-preview-columns">{groups.map((group,i)=><div key={i}><h4>{group.title}</h4><ol>{(group.collections.length?group.collections.slice(currentPage*4,currentPage*4+4):Array.from({length:4},(_,j)=>({title:'Collection '+(j+1),handle:'placeholder-'+j}))).map((child,j)=><li key={child.handle}><span>{currentPage*4+j+1}</span>{child.image?<img src={child.image} alt=""/>:<span className="cs-preview-placeholder"/>}<span>{child.title}</span></li>)}</ol></div>)}</div>
        <div className="cs-preview-pages"><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>‹ Previous</button><span>{currentPage+1} / {maxPage+1}</span><button type="button" disabled={currentPage>=maxPage} onClick={()=>setPage(currentPage+1)}>Next ›</button></div>
      </div><p className="cs-preview-note">Click a tab to preview its collections. Preview updates as you edit.</p>
    </aside></div><div className="cs-footer">Four image links per column appear at a time. Save settings to apply your changes to the storefront.</div>
  </section>;
}
