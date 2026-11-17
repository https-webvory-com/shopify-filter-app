import AdminNoSearchResults from '../components/ui/AdminNoSearchResults';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { saveSearchBanner } from '../services/searchBanner.server.js';
import { BannerValidationError, validateBannerUrl } from '../utils/searchBanner.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { rules: await prisma.searchBanner.findMany({ where: { shop: session.shop }, orderBy: { createdAt: 'desc' } }) };
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const form = await request.formData();
    await saveSearchBanner(session.shop, form);
    return { success: true, intent: form.get('intent'), id: form.get('id') || null, isActive: form.get('isActive') === 'true' };
  } catch (error) {
    if (error.code === 'P2002') return { error: 'A banner already uses this query, placement and position. Edit it or choose another position.' };
    if (error.code === 'P2025') return { error: 'Banner not found.' };
    return { error: error instanceof BannerValidationError ? error.message : 'Could not save the banner. Please retry.' };
  }
};
const bannerStyles = `
  .sb-page { --sb-purple:#5b21b6; --sb-border:#e8e3ee; padding:8px 0 32px; color:#282033; font-size:14px; }
  .sb-page * { box-sizing:border-box; }
  .sb-page button,.sb-page input,.sb-page select,.sb-page textarea { font:inherit; }
  .sb-intro { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:24px; }
  .sb-eyebrow { margin:0 0 8px; color:var(--sb-purple); font-size:11px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
  .sb-intro h2 { font-size:25px; font-weight:650; letter-spacing:-.6px; margin:0 0 8px; }
  .sb-intro p:last-child { margin:0; color:#7c7188; line-height:1.6; max-width:580px; }
  .sb-counts { display:flex; gap:22px; flex-shrink:0; background:#fff; padding:15px 22px; border:1px solid var(--sb-border); border-radius:12px; }
  .sb-counts div { display:grid; gap:5px; font-size:12px; color:#82758e; }
  .sb-counts div + div { border-left:1px solid var(--sb-border); padding-left:22px; }
  .sb-counts strong { font-size:22px; color:#392b47; font-weight:650; }
  .sb-workspace { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:24px; align-items:start; }
  .sb-card { background:#fff; border:1px solid var(--sb-border); border-radius:14px; overflow:hidden; min-width:0; }
  .sb-card-head { padding:21px 24px; border-bottom:1px solid #f0ecf5; }
  .sb-card-head h3 { font-size:16px; font-weight:650; margin:0 0 6px; }
  .sb-card-head p { font-size:12px; color:#897d94; margin:0; line-height:1.6; }
  .sb-section { padding:23px 24px; border-bottom:1px solid #f0ecf5; display:grid; gap:18px; }
  .sb-section h4 { display:flex; gap:9px; align-items:center; margin:0 0 2px; font-size:13px; font-weight:650; }
  .sb-step { display:grid; place-items:center; width:23px; height:23px; border-radius:7px; background:#f3edfc; color:var(--sb-purple); font-size:11px; }
  .sb-fields { display:grid; grid-template-columns:1fr 1fr; gap:18px; min-width:0; }
  .sb-field { display:grid; gap:8px; min-width:0; align-content:start; }
  .sb-field label { font-size:12px; font-weight:600; }
  .sb-input { width:100%; border:1px solid #dcd5e5; border-radius:8px; background:#fff; color:#3c2e49; padding:10px 12px; line-height:1.5; transition:border-color .15s,box-shadow .15s; }
  .sb-input::placeholder { color:#a298ad; }
  .sb-input:focus { outline:none; border-color:#8b5cf6; box-shadow:0 0 0 3px #7c3aed14; }
  textarea.sb-input { resize:vertical; min-height:86px; }
  .sb-help { font-size:12px; color:#8b8096; line-height:1.6; margin:0; }
  .sb-placement { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sb-placement-option { display:flex; gap:10px; align-items:flex-start; padding:13px; border:1px solid var(--sb-border); border-radius:9px; cursor:pointer; }
  .sb-placement-option:has(input:checked) { border-color:#a78bce; background:#faf7ff; }
  .sb-placement-option input { accent-color:var(--sb-purple); margin:2px 0 0; }
  .sb-placement-option strong { display:block; font-size:12px; margin-bottom:5px; font-weight:600; }
  .sb-placement-option span { display:block; color:#8b8096; font-size:11px; line-height:1.5; }
  .sb-colors { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .sb-color { display:flex; align-items:center; gap:9px; border:1px solid var(--sb-border); border-radius:8px; padding:7px 10px; }
  .sb-color input { border:0; padding:0; width:30px; height:30px; background:transparent; cursor:pointer; flex-shrink:0; }
  .sb-color span { font-size:12px; color:#887a94; }
  .sb-enabled { display:flex; align-items:flex-start; gap:11px; background:#faf8fe; border:1px solid #eee6f7; border-radius:9px; padding:13px; cursor:pointer; }
  .sb-enabled input { accent-color:var(--sb-purple); margin:2px 0 0; width:16px; height:16px; flex-shrink:0; }
  .sb-enabled strong { display:block; margin-bottom:4px; font-size:12px; }
  .sb-enabled span { color:#887a94; font-size:12px; line-height:1.5; }
  .sb-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .sb-form-actions { padding:17px 24px; justify-content:flex-end; background:#fdfcfe; }
  .sb-button { cursor:pointer; border:1px solid #dfd7e8; background:#fff; color:#584765; border-radius:8px; padding:9px 14px; font-weight:550; }
  .sb-button:hover { background:#f6f2fb; }
  .sb-button:focus-visible { outline:3px solid #c4b5fd; outline-offset:2px; }
  .sb-button:disabled { opacity:.5; cursor:not-allowed; }
  .sb-primary { background:var(--sb-purple); color:#fff; border-color:var(--sb-purple); }
  .sb-primary:hover { background:#4c1d95; }
  .sb-danger { color:#b04747; border-color:transparent; }
  .sb-danger:hover { background:#fff2f1; }
  .sb-preview-panel { position:sticky; top:20px; min-width:0; }
  .sb-preview-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .sb-preview-label { border-radius:20px; font-size:10px; color:var(--sb-purple); background:#f1eafb; padding:5px 8px; font-weight:600; white-space:nowrap; }
  .sb-canvas { padding:22px; background:#f8f7fa; }
  .sb-store { border:1px solid #e9e3ef; border-radius:10px; background:#fff; padding:16px; overflow:hidden; }
  .sb-store-header { padding-bottom:14px; border-bottom:1px solid #f0edf4; display:flex; gap:8px; align-items:center; font-size:11px; color:#7f728c; }
  .sb-search-dot { width:7px; height:7px; background:#bba9d1; border-radius:50%; }
  .sb-store-query { margin:16px 0; font-size:12px; font-weight:600; overflow-wrap:anywhere; }
  .sb-products { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; margin-top:12px; }
  .sb-product-placeholder { min-width:0; }
  .sb-product-placeholder div:first-child { height:85px; border-radius:5px; background:linear-gradient(145deg,#f3f0f6,#e9e3ef); }
  .sb-product-placeholder div:last-child { height:5px; background:#eae5f0; border-radius:3px; width:65%; margin-top:9px; }
  .sb-promotion { overflow:hidden; border-radius:7px; min-width:0; }
  .sb-promotion img { width:100%; height:auto; max-height:220px; object-fit:contain; display:block; }
  .sb-promotion-copy { padding:18px; overflow-wrap:anywhere; }
  .sb-promotion-copy h4 { font-size:18px; line-height:1.3; margin:0 0 8px; }
  .sb-promotion-copy p { font-size:12px; line-height:1.6; margin:0; white-space:pre-wrap; }
  .sb-preview-cta { display:inline-block; margin-top:14px; border:1px solid currentColor; border-radius:5px; padding:7px 11px; font-size:11px; font-weight:600; }
  .sb-image-placeholder { min-height:130px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:20px; background:linear-gradient(135deg,#eee6f8,#f8f5fc); color:#9c88b4; text-align:center; font-size:11px; }
  .sb-grid-promotion { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin:12px 0; }
  .sb-grid-promotion .sb-promotion-copy { padding:14px; }
  .sb-grid-promotion .sb-promotion-copy h4 { font-size:15px; }
  .sb-preview-foot { padding:14px 22px; color:#94879f; font-size:11px; line-height:1.6; border-top:1px solid #eee9f4; }
  .sb-tip { margin-top:16px; padding:16px 18px; background:#f8f4ff; border:1px solid #eee5fa; border-radius:10px; color:#887296; font-size:12px; line-height:1.7; }
  .sb-tip strong { display:block; color:#655074; margin-bottom:4px; font-size:12px; }
  .sb-library { margin-top:26px; }
  .sb-library-head { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  .sb-library-tools { display:flex; gap:10px; flex-wrap:wrap; }
  .sb-library-tools input { width:230px; }
  .sb-library-tools select { width:auto; }
  .sb-banner-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sb-saved { display:flex; align-items:flex-start; gap:16px; padding:22px 24px; border-bottom:1px solid #eee9f4; min-width:0; }
  .sb-saved:nth-child(odd) { border-right:1px solid #eee9f4; }
  .sb-saved-editing { background:#fcf9ff; box-shadow:inset 3px 0 var(--sb-purple); }
  .sb-thumbnail { width:90px; flex-shrink:0; border:1px solid #eee8f4; border-radius:8px; overflow:hidden; }
  .sb-thumbnail .sb-promotion img { height:75px; object-fit:cover; }
  .sb-thumbnail .sb-promotion { border-radius:0; }
  .sb-thumbnail .sb-promotion-copy { padding:8px; min-height:75px; display:grid; place-items:center; }
  .sb-thumbnail .sb-promotion-copy h4 { font-size:11px; margin:0; }
  .sb-thumbnail .sb-promotion-copy p,.sb-thumbnail .sb-preview-cta { display:none; }
  .sb-thumbnail .sb-image-placeholder { min-height:75px; padding:8px; }
  .sb-saved-body { min-width:0; flex:1; }
  .sb-saved-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .sb-saved h4 { margin:2px 0 7px; font-size:13px; font-weight:600; overflow-wrap:anywhere; }
  .sb-meta { color:#94869e; font-size:11px; line-height:1.6; margin:0 0 13px; overflow-wrap:anywhere; }
  .sb-saved .sb-button { font-size:11px; padding:6px 9px; }
  .sb-status { border-radius:20px; padding:4px 8px; background:#edf7f0; color:#287345; font-size:10px; font-weight:600; white-space:nowrap; }
  .sb-status-off { background:#f1eef4; color:#8a7e94; }
  .sb-empty { padding:42px 24px; text-align:center; grid-column:1/-1; color:#94859f; font-size:12px; line-height:1.7; }
  .sb-empty strong { display:block; color:#574165; font-size:15px; margin-bottom:7px; }
  .sb-feedback { padding:12px 16px; margin-bottom:18px; font-size:13px; border-radius:9px; }
  .sb-feedback-error { background:#fff1f0; border:1px solid #f4d0cb; color:#a8322a; }
  .sb-feedback-success { background:#edf7f0; border:1px solid #d1e9d8; color:#287345; }
  @media(max-width:1000px) { .sb-workspace { grid-template-columns:1fr; } .sb-preview-panel { position:static; } .sb-banner-list { grid-template-columns:1fr; } .sb-saved:nth-child(odd) { border-right:0; } }
  @media(max-width:600px) { .sb-intro { flex-direction:column; gap:16px; } .sb-counts { width:100%; } .sb-counts div { flex:1; } .sb-fields,.sb-colors,.sb-placement { grid-template-columns:1fr; } .sb-card-head,.sb-section,.sb-saved { padding:18px; } .sb-canvas { padding:14px; } .sb-thumbnail { width:64px; } .sb-saved { gap:12px; } .sb-saved-top { flex-direction:column-reverse; gap:8px; } .sb-library-tools,.sb-library-tools input { width:100%; } .sb-library-tools select { flex:1; } .sb-form-actions .sb-primary { flex:1; } }
`;

function ImageIcon() {
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>;
}

function BannerPreview({ values, thumbnail = false }) {
  const [failedUrl, setFailedUrl] = useState('');
  let imageUrl = '';
  try { imageUrl = validateBannerUrl(values.imageUrl, true); } catch { /* Incomplete URLs remain a placeholder while editing. */ }
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(values.backgroundColor) ? values.backgroundColor : '#f4f4f5';
  const textColor = /^#[0-9a-f]{6}$/i.test(values.textColor) ? values.textColor : '#18181b';
  const showImage = imageUrl && imageUrl !== failedUrl;
  const hasCopy = values.heading || values.content || (values.buttonLabel && values.targetUrl);
  return <div className="sb-promotion" style={{ backgroundColor, color: textColor }}>
    {showImage && <img src={imageUrl} alt={values.description || ''} onError={() => setFailedUrl(imageUrl)} loading={thumbnail ? 'lazy' : 'eager'} />}
    {!showImage && (!hasCopy || values.placement === 'top') && <div className="sb-image-placeholder"><ImageIcon />{!thumbnail && <span>{imageUrl === failedUrl && imageUrl ? 'Image could not be loaded. Check the URL.' : 'Your banner image will appear here'}</span>}</div>}
    {hasCopy && (!thumbnail || !showImage) && <div className="sb-promotion-copy">{values.heading && <h4>{values.heading}</h4>}{values.content && <p>{values.content}</p>}{values.buttonLabel && values.targetUrl && <span className="sb-preview-cta">{values.buttonLabel}</span>}</div>}
  </div>;
}

function ProductPlaceholders() {
  return <div className="sb-products" aria-hidden="true">{[1, 2, 3].map(i => <div key={i} className="sb-product-placeholder"><div /><div /></div>)}</div>;
}
export default function SearchBanners() {
  const { rules } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const defaults = { query: '', placement: 'top', position: 1, imageUrl: '', targetUrl: '', description: '', heading: '', content: '', buttonLabel: '', backgroundColor: '#f4f4f5', textColor: '#18181b' };
  const [values, setValues] = useState(defaults);
  const change = key => e => setValues(v => ({ ...v, [key]: e.target.value }));
  const field = (key, label, maxLength, extra = {}) => <div className="sb-field"><label htmlFor={`banner-${key}`}>{label}</label><input id={`banner-${key}`} name={key} value={values[key]} onChange={change(key)} maxLength={maxLength} className="sb-input" {...extra} /></div>;
  const [active, setActive] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const visibleRules = rules.filter(rule => (status === 'all' || (status === 'enabled' ? rule.isActive : !rule.isActive)) && `${rule.query} ${rule.heading || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const busy = fetcher.state !== 'idle';
  const reset = () => { setEditing(null); setValues(defaults); setActive(true); };
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data?.success) return;
    const { intent, id, isActive } = fetcher.data;
    if (intent === 'create' || intent === 'update' || (intent === 'delete' && id === editing)) {
      setEditing(null); setValues(defaults); setActive(true);
    } else if (intent === 'toggle' && id === editing) setActive(isActive);
  }, [fetcher.state, fetcher.data]);
  return (
    <s-page heading="Search Banners">
      <ui-title-bar title="Search Banners"><button variant="breadcrumb" onClick={() => navigate('/app/search')}>Search</button></ui-title-bar>
      <div className="sb-page">
        <style>{bannerStyles}</style>
        <div className="sb-intro"><div><p className="sb-eyebrow">Search merchandising</p><h2>Make every search an opportunity</h2><p>Put relevant promotions in front of customers, right where they search.</p></div><div className="sb-counts" aria-label="Banner summary"><div><strong>{rules.length}</strong>Total banners</div><div><strong>{rules.filter(rule => rule.isActive).length}</strong>Enabled</div></div></div>
        {fetcher.data?.error && <div role="alert" className="sb-feedback sb-feedback-error">{fetcher.data.error}</div>}
        {fetcher.state === 'idle' && fetcher.data?.success && <div role="status" className="sb-feedback sb-feedback-success">Banner changes saved.</div>}
        <div className="sb-workspace">
        <section className="sb-card" aria-labelledby="banner-editor-title">
          <div className="sb-card-head"><h3 id="banner-editor-title">{editing ? 'Edit banner' : 'Create banner'}</h3><p>Set your audience, add your creative, and preview your promotion.</p></div>
          <fetcher.Form method="post" aria-busy={busy}>
            <fieldset disabled={busy} aria-label="Banner editor" style={{ border:0, margin:0, padding:0, minWidth:0 }}>
            <input type="hidden" name="intent" value={editing ? 'update' : 'create'} />
            {editing && <input type="hidden" name="id" value={editing} />}
            <div className="sb-section">
            <h4><span className="sb-step">1</span>Search targeting</h4>
            {field('query', 'Search query', 200, {required:true, placeholder:'e.g. summer dresses', 'aria-describedby':'banner-query-help'})}
            <p id="banner-query-help" className="sb-help">Appears on the full search results page for a matching submitted query, ignoring case and extra spaces.</p>
            <div className="sb-field"><span id="banner-placement-label" style={{ fontSize:12, fontWeight:600 }}>Banner placement</span><div className="sb-placement" role="radiogroup" aria-labelledby="banner-placement-label"><label className="sb-placement-option"><input type="radio" name="placement" value="top" checked={values.placement === 'top'} onChange={change('placement')} /><div><strong>Top of results</strong><span>A wide image banner above products.</span></div></label><label className="sb-placement-option"><input type="radio" name="placement" value="grid" checked={values.placement === 'grid'} onChange={change('placement')} /><div><strong>Product grid</strong><span>A promotional tile between products.</span></div></label></div></div>
            {values.placement === 'grid' && field('position','Product grid position',undefined,{type:'number',required:true,min:1,max:10000,step:1})}
            {values.placement === 'grid' && <p className="sb-help">Position 1 appears before the first product. Positions beyond the results are hidden. Banners do not replace products.</p>}
            </div>
            <div className="sb-section">
            <h4><span className="sb-step">2</span>Banner content</h4>
            {field('imageUrl',values.placement === 'top' ? 'Banner image URL' : 'Banner image URL (optional)',2048,{type:'url',required:values.placement==='top',placeholder:'https://cdn.shopify.com/...', 'aria-describedby':'banner-image-help'})}
            <p id="banner-image-help" className="sb-help">Use an HTTPS image link from Shopify Content / Files. Grid banners can use text without an image.</p>
            {field('description','Description / image alternative text',300)}
            {field('heading','Banner heading (optional)',200)}
            <div className="sb-field"><label htmlFor="banner-content">Banner content (optional)</label><textarea id="banner-content" name="content" value={values.content} onChange={change('content')} maxLength={2000} rows={3} className="sb-input" /></div>
            <div className="sb-fields">{field('targetUrl','Banner target URL (optional)',2048,{placeholder:'/collections/summer'})}{field('buttonLabel','Button label (optional)',80,{placeholder:'e.g. Shop collection'})}</div>
            <p className="sb-help">Add a target URL to make the banner clickable. A button label also needs a target URL.</p>
            </div>
            <div className="sb-section">
            <h4><span className="sb-step">3</span>Appearance & status</h4>
            <div className="sb-colors">{[['backgroundColor','Background color'],['textColor','Text color']].map(([key,label]) => <div key={key} className="sb-field"><label htmlFor={`banner-${key}`}>{label}</label><div className="sb-color"><input id={`banner-${key}`} name={key} type="color" value={values[key]} onChange={change(key)} /><span>{values[key].toUpperCase()}</span></div></div>)}</div>
            <label className="sb-enabled"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><span><strong>Enabled</strong>Show this banner for matching searches.</span></label>
            <input type="hidden" name="isActive" value={String(active)} />
            </div>
            <div className="sb-actions sb-form-actions">
              {editing && <button disabled={busy} type="button" onClick={reset} className="sb-button">Cancel</button>}
              <button disabled={busy} type="submit" className="sb-button sb-primary">{busy ? 'Saving...' : editing ? 'Update banner' : 'Create banner'}</button>
            </div>
          </fieldset>
          </fetcher.Form>
        </section>
        <aside className="sb-preview-panel" aria-label="Banner preview">
          <div className="sb-card"><div className="sb-card-head sb-preview-head"><div><h3>Live preview</h3><p>See your creative as you edit.</p></div><span className="sb-preview-label">{values.placement === 'top' ? 'Top of results' : 'Product grid'}</span></div><div className="sb-canvas"><div className="sb-store"><div className="sb-store-header"><span className="sb-search-dot" />Your storefront</div><div className="sb-store-query">Results for “{values.query || 'your search query'}”</div>{values.placement === 'top' ? <><BannerPreview values={values} /><ProductPlaceholders /></> : <><ProductPlaceholders /><div className="sb-grid-promotion"><BannerPreview values={values} /><ProductPlaceholders /></div></>}</div></div><div className="sb-preview-foot">Creative preview only. Your theme controls the final size and layout.{values.placement === 'grid' && ` Grid position: ${values.position || 1}.`}</div></div>
          <div className="sb-tip"><strong>{values.placement === 'top' ? 'Give your promotion room to shine' : 'Blend your promotion into the browse'}</strong>{values.placement === 'top' ? 'Choose a wide image with a clear focal point. Add alternative text so everyone can understand your banner.' : 'Keep your heading short and your message focused. Text and background colors work well without an image.'}</div>
        </aside>
        </div>
        <section className="sb-card sb-library" aria-labelledby="banner-library-title">
          <div className="sb-card-head sb-library-head"><div><h3 id="banner-library-title">Your banners</h3><p>Find and manage your search promotions.</p></div>{rules.length > 0 && <div className="sb-library-tools"><input type="search" className="sb-input" aria-label="Search banners" placeholder="Search queries or headings" value={search} onChange={e => setSearch(e.target.value)} /><select className="sb-input" aria-label="Filter banner status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div>}</div>
          <div className="sb-banner-list">
          {!rules.length && <div className="sb-empty"><strong>No banners yet.</strong>Create your first promotion with the editor above.</div>}
          {rules.length > 0 && !visibleRules.length && <div className="sb-empty" role="status"><strong><AdminNoSearchResults query={search}>No matching banners.</AdminNoSearchResults></strong>Try a different search or status.<div style={{ marginTop:14 }}><button className="sb-button" onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</button></div></div>}
          {visibleRules.map(rule => (
            <article key={rule.id} className={`sb-saved${editing === rule.id ? ' sb-saved-editing' : ''}`}>
              <div className="sb-thumbnail" aria-hidden="true"><BannerPreview values={rule} thumbnail /></div>
              <div className="sb-saved-body"><div className="sb-saved-top"><h4>{rule.query}</h4><span className={`sb-status${rule.isActive ? '' : ' sb-status-off'}`}>{rule.isActive ? 'Enabled' : 'Disabled'}</span></div><p className="sb-meta">{rule.placement === 'top' ? 'Top of results' : 'Product grid · Position '+rule.position}{rule.heading && <> · {rule.heading}</>}</p><div className="sb-actions">
              <button disabled={busy} className="sb-button" onClick={() => { setEditing(rule.id); setValues({...defaults,...rule}); setActive(rule.isActive); document.getElementById('banner-editor-title')?.scrollIntoView({ behavior:'smooth', block:'start' }); document.getElementById('banner-query')?.focus({ preventScroll:true }); }}>Edit</button>
              <button disabled={busy} className="sb-button" onClick={() => fetcher.submit({ intent: 'toggle', id: rule.id, isActive: String(!rule.isActive) }, { method: 'post' })}>{rule.isActive ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} className="sb-button sb-danger" onClick={() => { if (window.confirm('Delete this banner?')) fetcher.submit({ intent: 'delete', id: rule.id }, { method: 'post' }); }}>Delete</button>
              </div></div>
            </article>
          ))}
          </div>
        </section>
      </div>
    </s-page>
  );
}
export const headers = args => boundary.headers(args);
