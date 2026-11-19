import {useEffect,useState} from 'react';
import {COLLECTION_SPACING_LIMITS,isValidCollectionSpacing} from '../utils/collectionLayoutSettings.js';

export default function PageWidthSettings({value,onApply,disabled,retry=false}) {
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value.collectionPageWidth,value.collectionSideSpacing,value.mobileCollectionSideSpacing]);
  const custom=draft.collectionPageWidth==='custom';
  const valid=!custom||Object.keys(COLLECTION_SPACING_LIMITS).every(key=>isValidCollectionSpacing(key,draft[key]));
  const changed=Object.keys(value).some(key=>String(value[key])!==String(draft[key]));
  const canApply=valid&&(changed||retry);
  const inputStyle={width:'100%',minWidth:0,padding:'10px 12px',border:'1px solid #d8d0e2',borderRadius:8,font:'inherit',background:'#fff',boxSizing:'border-box'};
  return <section aria-label="Page width settings" style={{padding:20,border:'1px solid #e5dfed',borderRadius:14,margin:'16px 0'}}>
    <label style={{display:"block",marginBottom:8,fontSize:15,fontWeight:700,color:"#1e1b4b"}} htmlFor="page-width">Page width</label>
    <p style={{margin:0,fontSize:13,lineHeight:1.6,color:"#4b5563"}}>Keep your theme's content width and side spacing, or choose custom spacing for collection and search results pages. Reload the storefront after saving.</p>
    <fieldset disabled={disabled} style={{border:0,padding:0,margin:'16px 0 0',minWidth:0,display:'grid',gap:16}}>
      <select id="page-width" aria-label="Page width" value={draft.collectionPageWidth} onChange={e=>setDraft({...draft,collectionPageWidth:e.target.value})} style={inputStyle}>
        <option value="theme">Use theme width and spacing</option><option value="custom">Custom side spacing</option>
      </select>
      {custom&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,180px),1fr))',gap:16}}>
        {Object.entries(COLLECTION_SPACING_LIMITS).map(([key,limits])=><label key={key} style={{display:'grid',gap:7,fontSize:13}}>
          {key==='collectionSideSpacing'?'Desktop side spacing (px)':'Small-screen side spacing (px)'}
          <input type="number" aria-label={key==='collectionSideSpacing'?'Desktop side spacing (px)':'Small-screen side spacing (px)'} min={limits.min} max={limits.max} step="1" value={draft[key]} aria-invalid={!isValidCollectionSpacing(key,draft[key])} onChange={e=>setDraft({...draft,[key]:e.target.value})} style={inputStyle}/>
          <small>{limits.min}–{limits.max} px on each side{key==='mobileCollectionSideSpacing'?' at screen widths up to 768 px':''}.</small>
        </label>)}
      </div>}
      {!valid&&<p role="alert" style={{color:'#b42318',margin:0}}>Enter whole numbers within the spacing ranges shown above.</p>}
      <button type="button" disabled={disabled||!canApply} onClick={()=>onApply(custom?{...draft,...Object.fromEntries(Object.keys(COLLECTION_SPACING_LIMITS).map(key=>[key,Number(draft[key])]))}:{...value,collectionPageWidth:'theme'})} style={{justifySelf:'start',padding:'10px 14px',border:0,borderRadius:8,background:'#5b21b6',color:'#fff',fontWeight:600,cursor:'pointer',opacity:(disabled||!canApply)?0.5:1}}>Apply page width</button>
    </fieldset>
  </section>;
}
