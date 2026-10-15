import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { useState, useEffect } from 'react';
import { getSearchSettings, saveSearchSettings, resetSearchSettings } from '../services/searchSettings.server.js';
import { DEFAULT_SEARCH_SETTINGS, SEARCH_SETTING_FIELDS, validateSearchSettings } from '../utils/searchSettings.js';
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getSearchSettings(session.shop) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get('intent') === 'reset') {
    try { await resetSearchSettings(session.shop); return { success: true, settings: null }; }
    catch { return { error: 'Could not restore defaults. Please retry.' }; }
  }
  if (form.get('intent') !== 'save') return { error: 'Unknown settings action.' };
  let settings;
  try { settings = validateSearchSettings(JSON.parse(String(form.get('settings') || ''))); }
  catch (error) { return { error: error instanceof SyntaxError ? 'Invalid search settings.' : error.message }; }
  try { await saveSearchSettings(session.shop, settings); return { success: true, settings }; }
  catch { return { error: 'Could not save search settings. Please retry.' }; }
};

const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };

export default function SearchSettings() {
  const navigate = useNavigate();
  const loaded = useLoaderData();
  const fetcher = useFetcher();
  const [values, setValues] = useState(loaded.settings || DEFAULT_SEARCH_SETTINGS);
  const [manual, setManual] = useState((loaded.settings?.manualSuggestions || []).join('\n'));
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setValues(fetcher.data.settings || DEFAULT_SEARCH_SETTINGS);
      setManual((fetcher.data.settings?.manualSuggestions || []).join('\n'));
    }
  }, [fetcher.state, fetcher.data]);
  const field = key => {
    const [label, fallback, min, max] = SEARCH_SETTING_FIELDS[key];
    return <label key={key} style={{ display: 'grid', gap: 6 }}>
      {typeof fallback === 'boolean' ? <span><input name={key} type="checkbox" checked={values[key]} disabled={busy} onChange={e => setValues(v => ({ ...v, [key]: e.target.checked }))} /> {label}</span>
        : <><span>{label} ({min}–{max})</span><input name={key} type="number" min={min} max={max} step="1" required value={values[key]} disabled={busy} style={fieldStyle} onChange={e => setValues(v => ({ ...v, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} /></>}
    </label>;
  };
  return (
    <s-page heading="Search Settings">
      <ui-title-bar title="Search Settings">
        <button variant="breadcrumb" onClick={() => navigate("/app/search")}>
          Search
        </button>
      </ui-title-bar>
      <p>Configure this app’s instant search and search results widget. Saved settings apply on new page loads. Restoring defaults returns control to your theme and app defaults.</p>
      <fetcher.Form method="post" onSubmit={e => {
        if (e.nativeEvent.submitter?.value === 'reset') return;
        e.preventDefault();
        fetcher.submit({ intent: 'save', settings: JSON.stringify({ ...values, manualSuggestions: manual.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }) }, { method: 'post' });
      }} style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
        {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
        {fetcher.data?.success && <p role="status">Search settings {fetcher.data.settings ? 'saved' : 'restored to defaults'}.</p>}
        <fieldset disabled={busy} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20, display: 'grid', gap: 16 }}>
          <legend>Instant search</legend>
          {['instantEnabled', 'productLimit', 'suggestionLimit', 'collectionLimit', 'recentLimit', 'minChars'].map(field)}
          <p style={{ margin: 0 }}>A count of zero hides that suggestion section. Recent searches are stored in the customer’s browser.</p>
          <label style={{ display: 'grid', gap: 6 }}>Manual suggestions<textarea name="manualSuggestions" value={manual} onChange={e => setManual(e.target.value)} rows={5} maxLength={1100} style={fieldStyle} /></label>
          <p style={{ margin: 0 }}>Enter up to 10 search terms, one per line. They appear in this order when the search box is empty, replacing recent searches. Blacklisted terms stay hidden.</p>
        </fieldset>
        <fieldset disabled={busy} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20, display: 'grid', gap: 16 }}>
          <legend>Search results page</legend>
          {['pageSize', 'showSearchInput', 'showVendor', 'showSale', 'showSoldOut'].map(field)}
          <p style={{ margin: 0 }}>These controls require this app’s search results widget on your search template. Collection pages keep their existing settings.</p>
        </fieldset>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="submit" name="intent" value="save" disabled={busy} style={{ padding: '10px 18px' }}>{busy ? 'Saving…' : 'Save settings'}</button>
          <button type="submit" name="intent" value="reset" formNoValidate disabled={busy} style={{ padding: '10px 18px' }}>Restore defaults</button>
        </div>
      </fetcher.Form>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
