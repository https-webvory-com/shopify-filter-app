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

const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };
const button = { padding: '10px 16px', border: '1px solid #c9cccf', borderRadius: 6, background: '#fff', cursor: 'pointer' };
export default function Customization() {
  const loaded = useLoaderData(), navigate = useNavigate(), fetcher = useFetcher();
  const initial = loaded.customization || DEFAULT_CUSTOMIZATION;
  const [values, setValues] = useState(initial), [saved, setSaved] = useState(initial);
  const [tab, setTab] = useState('css'), [color, setColor] = useState(''), [hex, setHex] = useState('#000000'), [localError, setLocalError] = useState('');
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
    setLocalError(''); fetcher.submit({ intent, themeId: loaded.themeId, customization: JSON.stringify(values) }, { method: 'post' });
  };
  const addSwatch = () => {
    const name = color.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) { setLocalError('Enter a color name of 1–100 characters.'); return; }
    if (values.swatches.some(v => v.color.toLowerCase() === name.toLowerCase())) { setLocalError('This filter swatch already exists.'); return; }
    if (values.swatches.length >= 200) { setLocalError('Use at most 200 filter swatches.'); return; }
    update('swatches', [...values.swatches, { color: name, hex }]); setColor(''); setLocalError('');
  };
  const theme = loaded.themes.find(t => t.id === loaded.themeId);
  const preview = `https://${loaded.shop}/collections/all?preview_theme_id=${loaded.themeId}`;
  return <s-page heading="Customization">
    <ui-title-bar title="Customization"><button variant="breadcrumb" onClick={() => { if (!dirty || window.confirm('Discard unsaved customization changes?')) navigate('/app/settings'); }}>Settings</button></ui-title-bar>
    <style>{`.cfp-customization{max-width:1100px;display:grid;gap:20px}.cfp-customization *{box-sizing:border-box}.cfp-customization textarea{tab-size:2;resize:vertical}.cfp-customization label{display:grid;gap:8px}.cfp-customization fieldset{min-width:0;border:1px solid #ddd;border-radius:10px;padding:20px;display:grid;gap:16px}.cfp-customization .swatch-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px;border:1px solid #eee;border-radius:8px}.cfp-customization .swatch-name{flex:1;min-width:0;overflow-wrap:anywhere}.cfp-customization button:focus-visible,.cfp-customization textarea:focus-visible{outline:2px solid #5b21b6;outline-offset:3px}`}</style>
    <div className="cfp-customization">
      <p>Customize this app’s collection filters, results grid and instant search for a selected theme. Save applies on the next storefront page load. The app widget must be installed on that theme.</p>
      <label>Theme<select aria-label="Theme" style={field} value={loaded.themeId} disabled={busy || !loaded.themes.length} onChange={changeTheme}>{loaded.themes.map(t => <option key={t.id} value={t.id}>{t.name}{t.role === 'MAIN' ? ' (Published)' : ''}</option>)}</select></label>
      {!loaded.themes.length && <p role="status">No themes are available.</p>}
      {loaded.themeId && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}><a href={preview} target="_blank" rel="noreferrer">Preview {theme?.name}</a><a href={preview + '&cfp_disable_customization=1'} target="_blank" rel="noreferrer">Preview without customization</a></div>
        {(localError || fetcher.data?.error) && <p role="alert" style={{ color: '#b42318' }}>{localError || fetcher.data.error}</p>}
        {!busy && fetcher.data?.success && fetcher.data.themeId === loaded.themeId && <p role="status">Customization {fetcher.data.customization ? 'saved' : 'restored to defaults'} for this theme.</p>}
        <fieldset disabled={busy}>
          <legend>Theme customization</legend>
          <label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" name="enabled" checked={values.enabled} onChange={e => update('enabled', e.target.checked)} /> Enable customization for this theme</label>
          <div role="tablist" aria-label="Customization editors" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{[['css', 'Stylesheets'], ['javascript', 'JavaScript'], ['swatches', 'Filter swatches']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={'customization-' + id} id={'tab-' + id} onClick={() => setTab(id)} style={{ ...button, background: tab === id ? '#ede9fe' : '#fff' }}>{label}</button>)}</div>
          <div role="tabpanel" id={'customization-' + tab} aria-labelledby={'tab-' + tab}>
            {tab === 'css' && <><p>Use this app’s <code>.cfp-</code> classes to style filters, product cards or instant search. CSS is applied only to this selected theme. Example: <code>.cfp-product-card__title {'{ color: #5b21b6; }'}</code></p><label>Custom CSS<textarea name="css" spellCheck={false} rows={18} maxLength={100000} style={{ ...field, fontFamily: 'monospace' }} value={values.css} onChange={e => update('css', e.target.value)} /></label></>}
            {tab === 'javascript' && <><label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" name="javascriptEnabled" checked={values.javascriptEnabled} onChange={e => update('javascriptEnabled', e.target.checked)} /> Run custom JavaScript</label><p>For developers: scripts run once per page after the document is ready. Use <code>document.addEventListener('cfp:customization-ready', …)</code> for initialization and <code>cfp:search-products-rendered</code> after collection/search results update. This app uses its own markup and events; SoBooster SDK templates are not compatible. Test on an unpublished theme first.</p><label>Custom JavaScript<textarea name="javascript" spellCheck={false} rows={18} maxLength={100000} style={{ ...field, fontFamily: 'monospace' }} value={values.javascript} onChange={e => update('javascript', e.target.value)} /></label></>}
            {tab === 'swatches' && <><p>Override the displayed color of exact filter values, such as “Navy Blue”. Matching ignores case and extra spaces. These overrides do not change product images or filtering rules.</p><div style={{ display: 'grid', gap: 12 }}>{values.swatches.map((s, index) => <div className="swatch-row" key={s.color}><span aria-hidden="true" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: s.hex, border: '1px solid #aaa' }} /><span className="swatch-name">{s.color}</span><input aria-label={'Color for ' + s.color} type="color" value={s.hex} onChange={e => update('swatches', values.swatches.map((v, i) => i === index ? { ...v, hex: e.target.value } : v))} /><button type="button" style={button} aria-label={'Remove ' + s.color} onClick={() => update('swatches', values.swatches.filter((_, i) => i !== index))}>Remove</button></div>)}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, alignItems: 'end' }}><label style={{ flex: '1 1 180px', minWidth: 0 }}>Color name<input value={color} maxLength={100} style={field} onChange={e => setColor(e.target.value)} /></label><label>Color<input type="color" value={hex} onChange={e => setHex(e.target.value)} /></label><button type="button" style={button} onClick={addSwatch}>Add swatch</button></div></>}
          </div>
        </fieldset>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}><button type="button" disabled={busy || !dirty} style={{ ...button, background: '#5b21b6', color: '#fff' }} onClick={() => submit('save')}>{busy ? 'Saving…' : 'Save customization'}</button><button type="button" disabled={busy} style={button} onClick={() => submit('reset')}>Restore defaults</button><span role="status">{dirty ? 'Unsaved changes' : ''}</span></div>
      </>}
    </div>
  </s-page>;
}
export const headers = args => boundary.headers(args);
