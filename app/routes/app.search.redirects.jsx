import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { saveSearchRedirect } from '../services/searchRedirect.server.js';
import { RedirectValidationError } from '../utils/searchRedirect.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { redirects: await prisma.searchRedirect.findMany({ where: { shop: session.shop }, include: { queries: true }, orderBy: { createdAt: 'desc' } }) };
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    await saveSearchRedirect(session.shop, await request.formData());
    return { success: true };
  } catch (error) {
    if (error.code === 'P2002') return { error: 'A search query already belongs to another redirect. Edit that redirect or use a different query.' };
    if (error.code === 'P2025') return { error: 'Redirect not found.' };
    return { error: error instanceof RedirectValidationError ? error.message : 'Could not save the redirect. Please retry.' };
  }
};
const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };
const buttonStyle = { padding: '8px 14px', borderRadius: 6, border: '1px solid #c9cccf', background: '#fff', cursor: 'pointer' };
export default function SearchRedirects() {
  const { redirects } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [queries, setQueries] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [active, setActive] = useState(true);
  const busy = fetcher.state !== 'idle';
  const reset = () => { setEditing(null); setQueries(''); setTargetUrl(''); setActive(true); };
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setEditing(null); setQueries(''); setTargetUrl(''); setActive(true);
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <s-page heading="Page Redirects">
      <ui-title-bar title="Page Redirects"><button variant="breadcrumb" onClick={() => navigate('/app/search')}>Search</button></ui-title-bar>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #e1e3e5', borderRadius: 10, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit page redirect' : 'Create page redirect'}</h2>
          <p>Send customers to a page or collection when they submit a matching search. Queries match exactly, ignoring case and extra spaces.</p>
          {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
          {fetcher.data?.success && <p role="status">Redirect changes saved.</p>}
          <fetcher.Form method="post" style={{ display: 'grid', gap: 16 }}>
            <input type="hidden" name="intent" value={editing ? 'update' : 'create'} />
            {editing && <input type="hidden" name="id" value={editing} />}
            <label>Search queries<textarea name="queries" value={queries} onChange={e => setQueries(e.target.value)} required rows={4} maxLength={11000} placeholder={'shipping information\nshipping policy'} style={fieldStyle} /></label>
            <span>One complete search query per line. Up to 50 queries.</span>
            <label>Destination URL<input name="targetUrl" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} required maxLength={2048} placeholder="/policies/shipping-policy" style={fieldStyle} /></label>
            <span>Use a store path or a full HTTPS URL. Search-page destinations are excluded to prevent loops.</span>
            <label><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Enabled</label>
            <input type="hidden" name="isActive" value={String(active)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} type="submit" style={{ ...buttonStyle, background: '#5B21B6', color: '#fff' }}>{busy ? 'Saving...' : editing ? 'Update redirect' : 'Create redirect'}</button>
              {editing && <button disabled={busy} type="button" onClick={reset} style={buttonStyle}>Cancel</button>}
            </div>
          </fetcher.Form>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e1e3e5', borderRadius: 10, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Your redirects</h2>
          {!redirects.length && <p>No redirects yet. Create a redirect above.</p>}
          {redirects.map(rule => (
            <div key={rule.id} style={{ padding: '16px 0', borderTop: '1px solid #e1e3e5', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{rule.queries.map(q => q.query).join(', ')}</strong>
                <div>{rule.targetUrl}</div><div>{rule.isActive ? 'Enabled' : 'Disabled'}</div>
              </div>
              <button disabled={busy} style={buttonStyle} onClick={() => { setEditing(rule.id); setQueries(rule.queries.map(q => q.query).join('\n')); setTargetUrl(rule.targetUrl); setActive(rule.isActive); }}>Edit</button>
              <button disabled={busy} style={buttonStyle} onClick={() => fetcher.submit({ intent: 'toggle', id: rule.id, isActive: String(!rule.isActive) }, { method: 'post' })}>{rule.isActive ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} style={buttonStyle} onClick={() => { if (window.confirm('Delete this redirect?')) fetcher.submit({ intent: 'delete', id: rule.id }, { method: 'post' }); }}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </s-page>
  );
}
export const headers = args => boundary.headers(args);
