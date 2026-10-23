import { useEffect, useState } from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { GET_THEME } from '../graphql/queries';
import { getCustomization, saveCustomization, resetCustomization } from '../services/customization.server.js';
import { CustomizationValidationError, DEFAULT_CUSTOMIZATION, normalizeThemeId } from '../utils/customization.js';

async function readThemes(admin) {
  const response = await admin.graphql(GET_THEME), result = await response.json();
  if (result.errors || !result.data?.themes?.edges) throw Error('Could not load themes. Please reload and retry.');
  return result.data.themes.edges.map(({ node }) => ({ id: normalizeThemeId(node.id), name: node.name, role: node.role }));
}
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const themes = await readThemes(admin);
  const requested = new URL(request.url).searchParams.get('themeId');
  const themeId = requested ? normalizeThemeId(requested) : (themes.find(t => t.role === 'MAIN') || themes[0])?.id || '';
  if (themeId && !themes.some(t => t.id === themeId)) throw new Response('Theme not found.', { status: 404 });
  return { themes, themeId, shop: session.shop, customization: themeId ? await getCustomization(session.shop, themeId) : null };
};
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  let themeId;
  try {
    themeId = normalizeThemeId(form.get('themeId'));
    const themes = await readThemes(admin);
    if (!themes.some(t => t.id === themeId)) return { error: 'This theme no longer exists in your store.' };
    if (form.get('intent') === 'reset') {
      await resetCustomization(session.shop, themeId);
      return { success: true, themeId, customization: null };
    }
    if (form.get('intent') !== 'save') return { error: 'Unknown customization action.' };
    let config;
    try { config = JSON.parse(String(form.get('customization') || '')); }
    catch { return { error: 'Invalid customization data.' }; }
    const customization = await saveCustomization(session.shop, themeId, config);
    return { success: true, themeId, customization };
  } catch (error) {
    // Validation errors are actionable; persistence errors must not expose server details.
    return { error: error instanceof CustomizationValidationError ? error.message : 'Could not save customization. Please retry.' };
  }
};

const normalizeHex = value => /^#?[\da-f]{6}$/i.test(value.trim()) ? '#' + value.trim().replace(/^#/, '').toLowerCase() : value;
const isHex = value => /^#[\da-f]{6}$/i.test(value);
const editorTabs = [['css', 'Stylesheets'], ['javascript', 'JavaScript'], ['swatches', 'Filter swatches']];
const customizationStyles = `
  .cfp-customization { --cx-accent:#5b21b6; --cx-border:#e8e2ef; max-width:1240px; margin:0 auto; color:#30253e; font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .cfp-customization * { box-sizing:border-box; }
  .cx-intro { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:24px; }
  .cx-intro h2 { margin:0 0 7px; font-size:24px; line-height:1.3; font-weight:650; letter-spacing:-.5px; }
  .cx-intro p { max-width:650px; margin:0; color:#766c82; }
  .cx-layout { display:grid; grid-template-columns:285px minmax(0,1fr); gap:22px; align-items:start; }
  .cx-sidebar { display:grid; gap:16px; min-width:0; }
  .cx-card { border:1px solid var(--cx-border); border-radius:12px; background:#fff; min-width:0; overflow:hidden; }
  .cx-card-body { padding:22px; }
  .cx-card h3 { font-size:15px; margin:0 0 7px; font-weight:650; }
  .cx-help { color:#80748d; font-size:12px; line-height:1.65; margin:6px 0 0; }
  .cx-field { display:grid; gap:7px; min-width:0; font-size:13px; font-weight:550; }
  .cx-input { width:100%; min-width:0; padding:10px 12px; border:1px solid #dcd4e6; border-radius:8px; background:#fff; color:#30253e; font:inherit; }
  .cx-input:focus { border-color:#8b5cf6; outline:0; box-shadow:0 0 0 3px #7c3aed14; }
  .cx-theme-info { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:14px 0; font-size:12px; color:#80748d; }
  .cx-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 9px; border-radius:20px; background:#f2eef8; color:#736380; font-size:11px; font-weight:600; white-space:nowrap; }
  .cx-badge.is-enabled { background:#edf8f0; color:#24683c; }
  .cx-preview-links { display:grid; gap:9px; margin-top:18px; }
  .cx-preview-links a { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid var(--cx-border); border-radius:8px; color:var(--cx-accent); text-decoration:none; font-size:12px; font-weight:550; }
  .cx-preview-links a:hover { background:#f8f5fc; }
  .cx-note { background:#f8f5fc; border:1px solid #eee7f7; border-radius:10px; padding:17px 20px; }
  .cx-note strong { font-size:12px; font-weight:650; }
  .cx-note p { color:#80748d; font-size:12px; margin:6px 0 0; line-height:1.7; }
  .cx-editor { min-width:0; }
  .cx-editor fieldset { border:0; padding:0; margin:0; min-width:0; }
  .cx-switch-row { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:21px 22px; border-bottom:1px solid var(--cx-border); }
  .cx-switch-label { display:flex; align-items:center; gap:13px; cursor:pointer; min-width:0; }
  .cx-switch-label strong { display:block; font-size:13px; font-weight:600; }
  .cx-switch-label small { display:block; font-size:12px; color:#82768e; font-weight:400; margin-top:3px; }
  .cx-switch { appearance:none; width:38px; height:22px; margin:0; border:1px solid #b5aabd; background:#c9c0d0; border-radius:20px; position:relative; flex-shrink:0; cursor:pointer; transition:background .15s; }
  .cx-switch:before { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:white; box-shadow:0 1px 3px #0002; transition:transform .15s; }
  .cx-switch:checked { background:var(--cx-accent); border-color:var(--cx-accent); }
  .cx-switch:checked:before { transform:translateX(16px); }
  .cx-tabs { display:flex; gap:22px; padding:0 22px; border-bottom:1px solid var(--cx-border); overflow-x:auto; }
  .cx-tab { background:none; border:0; border-bottom:2px solid transparent; padding:16px 0 14px; font:inherit; font-size:13px; font-weight:550; color:#877b93; cursor:pointer; white-space:nowrap; }
  .cx-tab[aria-selected=true] { color:var(--cx-accent); border-bottom-color:var(--cx-accent); }
  .cx-panel { padding:22px; min-width:0; }
  .cx-panel-heading { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
  .cx-panel-heading h3 { margin:0; }
  .cx-counter { color:#94869e; font-size:11px; font-weight:400; }
  .cx-description { color:#82748d; font-size:12px; margin:0 0 18px; line-height:1.7; }
  .cx-description code { color:#694b84; overflow-wrap:anywhere; }
  .cx-code { display:block; width:100%; min-height:330px; padding:16px; border:1px solid #e0d8e9; border-radius:9px; background:#fbfaff; color:#382547; font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace; resize:vertical; tab-size:2; }
  .cx-editor-label { display:flex; justify-content:space-between; gap:10px; margin-bottom:8px; font-size:12px; font-weight:600; }
  .cx-js-toggle { padding:13px 15px; border:1px solid var(--cx-border); border-radius:8px; margin:0 0 17px; background:#fcfaff; }
  .cx-empty { text-align:center; padding:28px 16px; border:1px dashed #dfd6e8; border-radius:9px; background:#fcfaff; }
  .cx-empty strong { display:block; font-size:13px; }
  .cx-empty p { margin:5px 0 0; color:#92839d; font-size:12px; }
  .cx-swatches { display:grid; gap:10px; margin-top:15px; }
  .cfp-customization .swatch-row { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:12px 14px; border:1px solid var(--cx-border); border-radius:9px; }
  .cx-swatch-dot { width:30px; height:30px; border:1px solid #0002; border-radius:50%; flex-shrink:0; }
  .cx-swatch-name { flex:1 1 120px; min-width:0; overflow-wrap:anywhere; font-size:13px; font-weight:550; }
  .cx-color-input { width:36px; height:36px; padding:3px; border:1px solid #ddd4e7; border-radius:7px; background:#fff; cursor:pointer; }
  .cx-hex { width:98px; padding:8px 10px; font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  .cx-add-swatch { display:flex; flex-wrap:wrap; gap:12px; padding:18px; border-radius:9px; background:#f8f5fc; margin-top:18px; align-items:end; }
  .cx-add-swatch .cx-field:first-child { flex:1 1 180px; }
  .cx-color-fields { display:flex; gap:8px; align-items:center; }
  .cx-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:9px 14px; border:1px solid #dcd4e6; border-radius:8px; background:#fff; color:#62506f; font:inherit; font-size:12px; font-weight:550; cursor:pointer; text-decoration:none; }
  .cx-button:hover { background:#f5f0fb; }
  .cx-button.cx-primary { background:var(--cx-accent); border-color:var(--cx-accent); color:#fff; }
  .cx-button.cx-primary:hover { background:#4c1d95; }
  .cx-button.cx-remove { color:#ac4343; border:0; padding:6px 8px; }
  .cx-button.cx-remove:hover { background:#fff1f0; }
  .cfp-customization button:disabled,.cfp-customization fieldset:disabled { opacity:.55; }
  .cfp-customization button:disabled { cursor:not-allowed; }
  .cfp-customization :is(button,input,textarea,select,a):focus-visible { outline:3px solid #c4b5fd; outline-offset:3px; }
  .cx-savebar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px; padding:16px 20px; margin-top:22px; border:1px solid var(--cx-border); border-radius:11px; background:#fff; position:sticky; bottom:12px; z-index:5; box-shadow:0 3px 18px #36204f0a; }
  .cx-save-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
  .cx-save-state { font-size:12px; color:#8c7d98; }
  .cx-save-state.is-dirty { color:#946000; }
  .cx-feedback { padding:12px 16px; border-radius:8px; margin:0 0 18px; font-size:13px; }
  .cx-feedback.is-error { color:#a8322a; background:#fff1f0; border:1px solid #f5d0cc; }
  .cx-feedback.is-success { color:#287345; background:#edf7f0; border:1px solid #d1e9d8; }
  @media(max-width:960px) { .cx-layout { grid-template-columns:1fr; } .cx-sidebar { grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:start; } .cx-preview-links { grid-template-columns:1fr 1fr; } }
  @media(max-width:600px) { .cx-intro { flex-direction:column; gap:12px; } .cx-intro h2 { font-size:21px; } .cx-sidebar { grid-template-columns:1fr; } .cx-card-body,.cx-panel { padding:18px; } .cx-switch-row { padding:18px; } .cx-tabs { padding:0 18px; gap:20px; } .cx-switch-row>.cx-badge { display:none; } .cx-preview-links { grid-template-columns:1fr; } .cx-code { min-height:280px; font-size:12px; } .cx-savebar { bottom:0; padding:14px; } .cx-save-actions { width:100%; } .cx-save-actions .cx-primary { flex:1; } .cx-swatches .cx-hex { width:92px; } }
`;
export default function Customization() {
  const loaded = useLoaderData(), navigate = useNavigate(), fetcher = useFetcher();
  const initial = loaded.customization || DEFAULT_CUSTOMIZATION;
  const [values, setValues] = useState(initial), [saved, setSaved] = useState(initial);
  const [submittedTheme, setSubmittedTheme] = useState('');
  const [tab, setTab] = useState('css'), [color, setColor] = useState(''), [hex, setHex] = useState('#000000'), [localError, setLocalError] = useState('');
  const invalidHex = values.swatches.some(s => !isHex(s.hex));
  const busy = fetcher.state !== 'idle', dirty = JSON.stringify(values) !== JSON.stringify(saved);
  useEffect(() => { const value = loaded.customization || DEFAULT_CUSTOMIZATION; setValues(value); setSaved(value); setColor(''); setLocalError(''); }, [loaded.themeId, loaded.customization]);
  useEffect(() => {
    if (!busy && fetcher.data?.success && fetcher.data.themeId === loaded.themeId) {
      const value = fetcher.data.customization || DEFAULT_CUSTOMIZATION;
      setValues(value); setSaved(value); setLocalError('');
    }
  }, [busy, fetcher.data, loaded.themeId]);
  useEffect(() => {
    const prevent = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const update = (key, value) => setValues(v => ({ ...v, [key]: value }));
  const changeTheme = event => {
    if (dirty && !window.confirm('Discard unsaved customization changes and switch themes?')) return;
    navigate('/app/settings/customization?themeId=' + encodeURIComponent(event.target.value));
  };
  const submit = intent => {
    if (intent === 'reset' && !window.confirm('Restore this theme’s customization defaults? Other themes are unchanged.')) return;
    if (intent === 'save' && invalidHex) { setLocalError('Use a six-digit hex color, such as #123456.'); return; }
    setSubmittedTheme(loaded.themeId); setLocalError(''); fetcher.submit({ intent, themeId: loaded.themeId, customization: JSON.stringify(values) }, { method: 'post' });
  };
  const addSwatch = () => {
    const name = color.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!isHex(hex)) { setLocalError('Use a six-digit hex color, such as #123456.'); return; }
    if (!name || name.length > 100) { setLocalError('Enter a color name of 1–100 characters.'); return; }
    if (values.swatches.some(v => v.color.toLowerCase() === name.toLowerCase())) { setLocalError('This filter swatch already exists.'); return; }
    if (values.swatches.length >= 200) { setLocalError('Use at most 200 filter swatches.'); return; }
    update('swatches', [...values.swatches, { color: name, hex }]); setColor(''); setLocalError('');
  };
  const theme = loaded.themes.find(t => t.id === loaded.themeId);
  const preview = `https://${loaded.shop}/collections/all?preview_theme_id=${loaded.themeId}`;
  return <s-page heading="Customization">
    <ui-title-bar title="Customization"><button variant="breadcrumb" onClick={() => { if (!dirty || window.confirm('Discard unsaved customization changes?')) navigate('/app/settings'); }}>Settings</button></ui-title-bar>
    <style>{customizationStyles}</style>
    <div className="cfp-customization">
      <div className="cx-intro"><div><h2>Make it your own</h2><p>Customize the app's appearance for each theme with stylesheets, JavaScript, and filter colors.</p></div><span className="cx-badge">Theme customization</span></div>
      {(localError || (submittedTheme === loaded.themeId && fetcher.data?.error)) && <div role="alert" className="cx-feedback is-error">{localError || fetcher.data.error}</div>}
      {!busy && !dirty && fetcher.data?.success && fetcher.data.themeId === loaded.themeId && <div role="status" className="cx-feedback is-success">Customization {fetcher.data.customization ? 'saved' : 'restored to defaults'} for this theme.</div>}
      {invalidHex && !localError && <div role="alert" className="cx-feedback is-error">Use a six-digit hex color in Filter swatches, such as #123456.</div>}
      <div className="cx-layout">
        <aside className="cx-sidebar" aria-label="Theme and preview">
          <section className="cx-card cx-card-body"><h3>Choose a theme</h3><p className="cx-help" style={{marginBottom:16}}>Each theme has its own customization.</p><label className="cx-field">Theme<select className="cx-input" aria-label="Theme" value={loaded.themeId} disabled={busy || !loaded.themes.length} onChange={changeTheme}>{loaded.themes.map(t => <option key={t.id} value={t.id}>{t.name}{t.role === 'MAIN' ? ' (Published)' : ''}</option>)}</select></label>
          {!loaded.themes.length && <p role="status" className="cx-help">No themes are available.</p>}
          {loaded.themeId && <><div className="cx-theme-info"><span>Selected theme</span><span className={`cx-badge ${theme?.role === 'MAIN' ? 'is-enabled' : ''}`}>{theme?.role === 'MAIN' ? 'Published' : 'Unpublished'}</span></div><div className="cx-preview-links"><a href={preview} target="_blank" rel="noreferrer">Preview {theme?.name}<span aria-hidden="true">&#8599;</span></a><a href={preview + '&cfp_disable_customization=1'} target="_blank" rel="noreferrer">Preview without customization<span aria-hidden="true">&#8599;</span></a></div></>}
          </section>
          <div className="cx-note"><strong>Preview before you save</strong><p>Changes apply on the next storefront page load after saving. Install the app widget on the selected theme to see them.</p></div>
        </aside>
        {loaded.themeId && <section className="cx-card cx-editor" aria-label="Theme customization">
          <fieldset disabled={busy} aria-label="Theme customization editors">
            <div className="cx-switch-row"><label className="cx-switch-label"><input className="cx-switch" type="checkbox" name="enabled" role="switch" checked={values.enabled} onChange={e => update('enabled', e.target.checked)} /><span><strong>Enable customization for this theme</strong><small>Turn your saved styles, scripts, and colors on or off.</small></span></label><span className={`cx-badge ${values.enabled ? 'is-enabled' : ''}`}>{values.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <div role="tablist" aria-label="Customization editors" className="cx-tabs">{editorTabs.map(([id, label]) => <button className="cx-tab" key={id} type="button" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={'customization-' + id} id={'tab-' + id} onClick={() => setTab(id)} onKeyDown={e => { const index = editorTabs.findIndex(t => t[0] === tab); const next = e.key === 'ArrowRight' ? (index + 1) % 3 : e.key === 'ArrowLeft' ? (index + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1; if (next >= 0) { e.preventDefault(); setTab(editorTabs[next][0]); document.getElementById('tab-' + editorTabs[next][0])?.focus(); } }}>{label}</button>)}</div>
            <div role="tabpanel" className="cx-panel" id={'customization-' + tab} aria-labelledby={'tab-' + tab}>
              {tab === 'css' && <><div className="cx-panel-heading"><h3>Custom styles</h3><span className="cx-counter">CSS</span></div><p className="cx-description">Style filters, product cards, or instant search using the app's <code>.cfp-</code> classes. For example: <code>.cfp-product-card__title {'{ color: #5b21b6; }'}</code></p><label><span className="cx-editor-label"><span>Custom CSS</span><span className="cx-counter">{values.css.length.toLocaleString()} / 100,000 characters</span></span><textarea className="cx-code" name="css" aria-label="Custom CSS" spellCheck={false} rows={18} maxLength={100000} placeholder="/* Add your custom styles here */" value={values.css} onChange={e => update('css', e.target.value)} /></label></>}
              {tab === 'javascript' && <><div className="cx-panel-heading"><h3>Custom JavaScript</h3><span className="cx-counter">JavaScript</span></div><p className="cx-description">Scripts run once after the document is ready. Use <code>cfp:customization-ready</code> to initialize and <code>cfp:search-products-rendered</code> after results update. Test on an unpublished theme first.</p><label className="cx-switch-label cx-js-toggle"><input className="cx-switch" type="checkbox" name="javascriptEnabled" role="switch" checked={values.javascriptEnabled} onChange={e => update('javascriptEnabled', e.target.checked)} /><span><strong>Run custom JavaScript</strong><small>Keep your code saved while controlling when it runs.</small></span></label><label><span className="cx-editor-label"><span>JavaScript code</span><span className="cx-counter">{values.javascript.length.toLocaleString()} / 100,000 characters</span></span><textarea className="cx-code" name="javascript" aria-label="Custom JavaScript" spellCheck={false} rows={18} maxLength={100000} placeholder="// Add your custom JavaScript here" value={values.javascript} onChange={e => update('javascript', e.target.value)} /></label></>}
              {tab === 'swatches' && <><div className="cx-panel-heading"><h3>Filter colors</h3><span className="cx-counter">{values.swatches.length} / 200 swatches</span></div><p className="cx-description">Choose a display color for an exact filter value, such as Navy Blue. Matching ignores case and extra spaces. Product images and filter rules stay the same.</p>
                {!values.swatches.length && <div className="cx-empty"><strong>No filter swatches yet</strong><p>Add a color name and hex code below to create your first swatch.</p></div>}
                <div className="cx-swatches">{values.swatches.map((s, index) => <div className="swatch-row" key={s.color}><span aria-hidden="true" className="cx-swatch-dot" style={{background:isHex(s.hex) ? s.hex : '#e5e7eb'}} /><span className="cx-swatch-name">{s.color}</span><input className="cx-color-input" aria-label={'Color for ' + s.color} type="color" value={isHex(s.hex) ? s.hex : '#000000'} onChange={e => update('swatches', values.swatches.map((v, i) => i === index ? {...v, hex:e.target.value} : v))} /><input className="cx-input cx-hex" aria-label={'Hex code for ' + s.color} aria-invalid={!isHex(s.hex)} value={s.hex} maxLength={7} onChange={e => update('swatches', values.swatches.map((v,i) => i === index ? {...v,hex:normalizeHex(e.target.value)} : v))} /><button type="button" className="cx-button cx-remove" aria-label={'Remove ' + s.color} onClick={() => update('swatches', values.swatches.filter((_,i) => i !== index))}>Remove</button></div>)}</div>
                <div className="cx-add-swatch"><label className="cx-field">Color name<input className="cx-input" placeholder="e.g. Navy Blue" value={color} maxLength={100} onChange={e => setColor(e.target.value)} /></label><div className="cx-field"><span>Color</span><div className="cx-color-fields"><input className="cx-color-input" aria-label="New swatch color" type="color" value={isHex(hex) ? hex : '#000000'} onChange={e => setHex(e.target.value)} /><input className="cx-input cx-hex" aria-label="New swatch hex code" value={hex} maxLength={7} onChange={e => setHex(normalizeHex(e.target.value))} /></div></div><button type="button" className="cx-button" onClick={addSwatch}>Add swatch</button></div>
              </>}
            </div>
          </fieldset>
        </section>}
      </div>
      {loaded.themeId && <div className="cx-savebar"><span className={`cx-save-state ${dirty ? 'is-dirty' : ''}`} role="status">{busy ? 'Saving changes...' : dirty ? 'Unsaved changes' : 'No unsaved changes'}</span><div className="cx-save-actions"><button type="button" className="cx-button" disabled={busy} onClick={() => submit('reset')}>Restore defaults</button><button type="button" className="cx-button cx-primary" disabled={busy || !dirty || invalidHex} onClick={() => submit('save')}>{busy ? 'Saving...' : 'Save customization'}</button></div></div>}
    </div>
  </s-page>;
}
export const headers = args => boundary.headers(args);
