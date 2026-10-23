import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { saveSuggestionBlacklist } from '../services/suggestionBlacklist.server.js';
import { SuggestionBlacklistValidationError } from '../utils/suggestionBlacklist.js';
import SearchConfigurationLayout from '../components/SearchConfigurationLayout';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { rules: await prisma.searchSuggestionBlacklist.findMany({ where: { shop: session.shop }, orderBy: { createdAt: 'desc' } }) };
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const form = await request.formData();
    await saveSuggestionBlacklist(session.shop, form);
    return { success: true, intent: form.get('intent'), id: form.get('id'), isActive: form.get('isActive') === 'true' };
  } catch (error) {
    if (error.code === 'P2002') return { error: 'This term and operator already exist. Edit the existing blacklist rule.' };
    if (error.code === 'P2025') return { error: 'Blacklist rule not found.' };
    return { error: error instanceof SuggestionBlacklistValidationError ? error.message : 'Could not save the blacklist rule. Please retry.' };
  }
};
const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };
export default function SearchBlacklist() {
  const { rules } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [term, setTerm] = useState('');
  const [operator, setOperator] = useState('contains');
  const [active, setActive] = useState(true);
  const busy = fetcher.state !== 'idle';
  const reset = () => { setEditing(null); setTerm(''); setOperator('contains'); setActive(true); };
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      const result = fetcher.data;
      if (result.intent === 'create' || result.intent === 'update' || (result.intent === 'delete' && result.id === editing)) {
        setEditing(null); setTerm(''); setOperator('contains'); setActive(true);
      } else if (result.intent === 'toggle' && result.id === editing) {
        setActive(result.isActive);
      }
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <s-page heading="Blacklist Suggestions" full-width="true">
      <ui-title-bar title="Blacklist Suggestions"><button variant="breadcrumb" onClick={() => navigate('/app/search')}>Search</button></ui-title-bar>
      <SearchConfigurationLayout>
        <div className="search-config-card">
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit blacklist rule' : 'Create blacklist rule'}</h2>
          <p>Hide matching phrases from autocomplete suggestions. Matching ignores case and extra spaces. Product results stay available.</p>
          {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
          {fetcher.data?.success && <p role="status">Blacklist changes saved.</p>}
          <fetcher.Form method="post" style={{ display: 'grid', gap: 16 }}>
            <input type="hidden" name="intent" value={editing ? 'update' : 'create'} />
            {editing && <input type="hidden" name="id" value={editing} />}
            <label>Suggestion term<input disabled={busy} name="term" value={term} onChange={e => setTerm(e.target.value)} required maxLength={200} placeholder="e.g. clearance" style={fieldStyle} /></label>
            <label>Matching operator<select disabled={busy} name="operator" value={operator} onChange={e => setOperator(e.target.value)} style={fieldStyle}><option value="contains">Contains</option><option value="exact">Exact match</option></select></label>
            <span>Contains hides suggestions containing the phrase. Exact match hides only the complete phrase.</span>
            <label><input disabled={busy} type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Enabled</label>
            <input type="hidden" name="isActive" value={String(active)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} type="submit" className="search-config-primary">{busy ? 'Saving...' : editing ? 'Update rule' : 'Create rule'}</button>
              {editing && <button disabled={busy} type="button" onClick={reset}>Cancel</button>}
            </div>
          </fetcher.Form>
        </div>
        <div className="search-config-card">
          <h2 style={{ marginTop: 0 }}>Blacklist rules</h2>
          {!rules.length && <p>No blacklist rules yet. Create a rule above.</p>}
          {rules.map(rule => (
            <div key={rule.id} style={{ padding: '16px 0', borderTop: '1px solid #e1e3e5', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{rule.term}</strong>
                <div>{rule.operator === 'contains' ? 'Contains' : 'Exact match'}</div><span className="search-config-status" data-active={rule.isActive}>{rule.isActive ? 'Enabled' : 'Disabled'}</span>
              </div>
              <button disabled={busy} onClick={() => { setEditing(rule.id); setTerm(rule.term); setOperator(rule.operator); setActive(rule.isActive); }}>Edit</button>
              <button disabled={busy} onClick={() => fetcher.submit({ intent: 'toggle', id: rule.id, isActive: String(!rule.isActive) }, { method: 'post' })}>{rule.isActive ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} className="search-config-danger" onClick={() => { if (window.confirm('Delete this blacklist rule?')) fetcher.submit({ intent: 'delete', id: rule.id }, { method: 'post' }); }}>Delete</button>
            </div>
          ))}
        </div>
      </SearchConfigurationLayout>
    </s-page>
  );
}
export const headers = args => boundary.headers(args);
