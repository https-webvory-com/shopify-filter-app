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
const redirectStyles = `
  .redirect-page { --rd-purple: #5b21b6; --rd-border: #e8e5ef; color: #242033; padding: 8px 0 32px; font-size: 14px; }
  .redirect-page * { box-sizing: border-box; }
  .redirect-page button, .redirect-page input, .redirect-page textarea, .redirect-page select { font: inherit; }
  .rd-intro { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
  .rd-eyebrow { color: var(--rd-purple); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; margin: 0 0 8px; }
  .rd-intro h2 { font-size: 25px; letter-spacing: -.6px; margin: 0 0 8px; font-weight: 650; }
  .rd-description { color: #716b7e; line-height: 1.6; margin: 0; max-width: 600px; }
  .rd-summary { display: flex; gap: 22px; flex-shrink: 0; padding: 14px 20px; background: #fff; border: 1px solid var(--rd-border); border-radius: 12px; }
  .rd-stat { display: grid; gap: 4px; color: #716b7e; font-size: 12px; }
  .rd-stat strong { color: #30253e; font-size: 22px; line-height: 1; font-weight: 650; }
  .rd-stat + .rd-stat { border-left: 1px solid var(--rd-border); padding-left: 22px; }
  .rd-layout { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 22px; align-items: start; }
  .rd-card { background: #fff; border: 1px solid var(--rd-border); border-radius: 14px; overflow: hidden; box-shadow: 0 2px 5px #20103004; min-width: 0; }
  .rd-card-heading { padding: 21px 22px 18px; border-bottom: 1px solid #f0edf5; }
  .rd-card-heading h3 { font-size: 16px; margin: 0 0 6px; font-weight: 650; }
  .rd-card-heading p { color: #797282; font-size: 12px; line-height: 1.6; margin: 0; }
  .rd-form { padding: 22px; display: grid; gap: 21px; }
  .rd-field { display: grid; gap: 8px; }
  .rd-field label { font-size: 13px; font-weight: 600; }
  .rd-field-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .rd-counter { color: #8a8195; font-size: 11px; }
  .rd-input { width: 100%; border: 1px solid #dcd6e5; background: #fff; color: #30253e; border-radius: 8px; padding: 11px 12px; line-height: 1.5; transition: border-color .15s, box-shadow .15s; }
  .rd-input::placeholder { color: #a29aa9; }
  textarea.rd-input { resize: vertical; min-height: 116px; }
  .rd-page-search { max-width: 310px; }
  .rd-input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px #7c3aed14; }
  .rd-help { font-size: 12px; color: #82798c; line-height: 1.6; margin: 0; }
  .rd-enabled { display: flex; gap: 11px; align-items: flex-start; border: 1px solid #ece7f5; border-radius: 9px; padding: 13px; background: #fcfaff; cursor: pointer; }
  .rd-enabled input { accent-color: var(--rd-purple); width: 16px; height: 16px; margin: 2px 0 0; flex-shrink: 0; }
  .rd-enabled strong { display: block; font-size: 13px; margin-bottom: 4px; font-weight: 600; }
  .rd-enabled span { color: #82798c; font-size: 12px; line-height: 1.5; }
  .rd-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .rd-button { border: 1px solid #dfd9e8; border-radius: 8px; background: #fff; padding: 9px 13px; color: #51465f; font-weight: 550; cursor: pointer; transition: background .15s; }
  .rd-button:hover { background: #f7f4fc; }
  .rd-button:focus-visible, .rd-filter:focus-visible { outline: 3px solid #c4b5fd; outline-offset: 2px; }
  .rd-button:disabled { opacity: .5; cursor: not-allowed; }
  .rd-primary { background: var(--rd-purple); border-color: var(--rd-purple); color: #fff; flex: 1; }
  .rd-primary:hover { background: #4c1d95; }
  .rd-enable { color: #166534; border-color: #86c99c; background: #ecfdf3; }
  .rd-enable:hover { background: #dcfce7; border-color: #4aa76b; }
  .rd-disable { color: #9f2929; border-color: #edaaaa; background: #fff1f0; }
  .rd-disable:hover { background: #ffe2df; border-color: #d97878; }
  .rd-danger { color: #b14747; border-color: transparent; }
  .rd-danger:hover { background: #fff3f2; }
  .rd-note { display: flex; gap: 10px; align-items: flex-start; margin-top: 15px; padding: 0 4px; color: #82798c; font-size: 12px; line-height: 1.6; }
  .rd-note svg { flex-shrink: 0; margin-top: 2px; }
  .rd-toolbar { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; padding: 16px 22px; border-bottom: 1px solid #f0edf5; }
  .rd-filters { display: flex; align-items: center; gap: 4px; }
  .rd-filter { border: 0; border-radius: 7px; color: #847b90; padding: 8px 11px; background: transparent; cursor: pointer; font-size: 12px !important; }
  .rd-filter[aria-pressed=true] { color: var(--rd-purple); background: #f0e9fc; font-weight: 600; }
  .rd-rule { padding: 20px 22px; border-bottom: 1px solid #f0edf5; }
  .rd-rule:last-child { border-bottom: 0; }
  .rd-rule-editing { background: #fcfaff; box-shadow: inset 3px 0 var(--rd-purple); }
  .rd-rule-top { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; margin-bottom: 13px; }
  .rd-queries { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
  .rd-query { font-size: 12px; font-weight: 500; color: #51425f; background: #f5f2f9; border: 1px solid #ebe5f1; border-radius: 6px; padding: 5px 8px; overflow-wrap: anywhere; min-width: 0; max-width: 100%; }
  .rd-badge { font-size: 11px; font-weight: 600; white-space: nowrap; border-radius: 20px; padding: 5px 9px; background: #edf7f0; color: #287345; }
  .rd-badge-disabled { background: #f1eff4; color: #83788d; }
  .rd-destination { display: flex; gap: 9px; align-items: flex-start; color: #71647e; font-size: 12px; line-height: 1.6; margin-bottom: 16px; }
  .rd-destination svg { flex-shrink: 0; margin-top: 2px; color: #a595b7; }
  .rd-url { overflow-wrap: anywhere; min-width: 0; }
  .rd-rule .rd-button { padding: 6px 11px; font-size: 12px; }
  .rd-empty { padding: 48px 24px; text-align: center; }
  .rd-empty-icon { width: 48px; height: 48px; display: grid; place-items: center; margin: 0 auto 16px; border-radius: 14px; color: var(--rd-purple); background: #f2ebfc; }
  .rd-empty h4 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
  .rd-empty p { color: #8a8094; font-size: 12px; line-height: 1.7; margin: 0 auto; max-width: 300px; }
  .rd-feedback { border-radius: 9px; padding: 12px 16px; margin-bottom: 18px; font-size: 13px; line-height: 1.5; }
  .rd-error { background: #fff1f0; border: 1px solid #f5d0cc; color: #a8322a; }
  .rd-success { background: #edf7f0; border: 1px solid #d1e9d8; color: #287345; }
  @media (max-width: 1000px) { .rd-layout { grid-template-columns: 1fr; } .rd-form { grid-template-columns: 1fr 1fr; } .rd-enabled, .rd-form > .rd-actions { grid-column: 1 / -1; } }
  @media (max-width: 600px) { .rd-intro { flex-direction: column; gap: 16px; } .rd-summary { width: 100%; } .rd-stat { flex: 1; } .rd-form { grid-template-columns: 1fr; padding: 18px; } .rd-card-heading, .rd-rule { padding: 18px; } .rd-toolbar { padding: 14px 18px; } .rd-page-search { max-width: none; } .rd-toolbar > label { width: 100%; } .rd-rule-top { flex-direction: column-reverse; gap: 10px; } }
`;

function RedirectIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6v6a4 4 0 0 0 4 4h12M15 11l5 5-5 5" /></svg>;
}
export default function SearchRedirects() {
  const { redirects } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [queries, setQueries] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [active, setActive] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const busy = fetcher.state !== 'idle';
  const queryCount = queries.split('\n').filter(query => query.trim()).length;
  const enabledCount = redirects.filter(rule => rule.isActive).length;
  const visibleRedirects = redirects.filter(rule => {
    const matchesStatus = status === 'all' || (status === 'enabled' ? rule.isActive : !rule.isActive);
    const term = search.trim().toLowerCase();
    return matchesStatus && (!term || rule.targetUrl.toLowerCase().includes(term) || rule.queries.some(query => query.query.toLowerCase().includes(term)));
  });
  const reset = () => { setEditing(null); setQueries(''); setTargetUrl(''); setActive(true); };
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setEditing(null); setQueries(''); setTargetUrl(''); setActive(true);
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <s-page heading="Page Redirects">
      <ui-title-bar title="Page Redirects"><button variant="breadcrumb" onClick={() => navigate('/app/search')}>Search</button></ui-title-bar>
      <div className="redirect-page">
        <style>{redirectStyles}</style>
        <div className="rd-intro">
          <div><p className="rd-eyebrow">Search experience</p><h2>A direct route to the right page</h2><p className="rd-description">Turn specific searches into helpful shortcuts. Send customers straight to a collection, policy, or landing page.</p></div>
          <div className="rd-summary" aria-label="Redirect summary"><div className="rd-stat"><strong>{redirects.length}</strong>Total redirects</div><div className="rd-stat"><strong>{enabledCount}</strong>Enabled</div></div>
        </div>
        {fetcher.data?.error && <div role="alert" className="rd-feedback rd-error">{fetcher.data.error}</div>}
        {fetcher.data?.success && <div role="status" className="rd-feedback rd-success">Redirect changes saved.</div>}
        <div className="rd-layout">
        <div>
        <section className="rd-card" aria-labelledby="redirect-editor-title">
          <div className="rd-card-heading"><h3 id="redirect-editor-title">{editing ? 'Edit page redirect' : 'Create page redirect'}</h3><p>Choose what customers search for and where they go.</p></div>
          <fetcher.Form method="post" className="rd-form" aria-busy={busy}>
            <input type="hidden" name="intent" value={editing ? 'update' : 'create'} />
            {editing && <input type="hidden" name="id" value={editing} />}
            <div className="rd-field"><div className="rd-field-top"><label htmlFor="redirect-queries">Search queries</label><span className="rd-counter">{queryCount} / 50 queries</span></div><textarea id="redirect-queries" name="queries" value={queries} onChange={e => setQueries(e.target.value)} required rows={4} maxLength={11000} placeholder={'shipping information\nshipping policy'} className="rd-input" aria-describedby="redirect-queries-help" /><p id="redirect-queries-help" className="rd-help">One complete search query per line. Up to 50 queries.</p></div>
            <div className="rd-field"><label htmlFor="redirect-target">Destination URL</label><input id="redirect-target" name="targetUrl" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} required maxLength={2048} placeholder="/policies/shipping-policy" className="rd-input" aria-describedby="redirect-target-help" /><p id="redirect-target-help" className="rd-help">Use a store path or a full HTTPS URL. Search pages cannot be destinations.</p></div>
            <label className="rd-enabled"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><div><strong>Enabled</strong><span>Apply this redirect when a matching search is submitted.</span></div></label>
            <input type="hidden" name="isActive" value={String(active)} />
            <div className="rd-actions">
              {editing && <button disabled={busy} type="button" onClick={reset} className="rd-button">Cancel</button>}
              <button disabled={busy} type="submit" className="rd-button rd-primary">{busy ? 'Saving...' : editing ? 'Update redirect' : 'Create redirect'}</button>
            </div>
          </fetcher.Form>
        </section>
        <p className="rd-note"><RedirectIcon size={16} /><span>Queries match exactly, ignoring case and extra spaces. Other searches continue to show normal results.</span></p>
        </div>
        <section className="rd-card" aria-labelledby="redirect-list-title">
          <div className="rd-card-heading"><h3 id="redirect-list-title">Your redirects</h3><p>Manage the shortcuts available to your customers.</p></div>
          {redirects.length > 0 && <div className="rd-toolbar"><div className="rd-filters" aria-label="Filter redirects by status">{['all', 'enabled', 'disabled'].map(value => <button key={value} type="button" className="rd-filter" aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'all' ? 'All redirects' : value === 'enabled' ? 'Enabled' : 'Disabled'}</button>)}</div><label><input className="rd-input rd-page-search" type="search" placeholder="Search queries or URLs" aria-label="Search redirects" value={search} onChange={e => setSearch(e.target.value)} /></label></div>}
          {!redirects.length && <div className="rd-empty"><div className="rd-empty-icon"><RedirectIcon size={25} /></div><h4>Your first shortcut starts here</h4><p>Create a redirect to help customers find the right page with a simple search.</p></div>}
          {redirects.length > 0 && !visibleRedirects.length && <div className="rd-empty" role="status"><h4>No matching redirects</h4><p>Try another search or show all redirects.</p><button className="rd-button" style={{ marginTop: 16 }} onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</button></div>}
          {visibleRedirects.map(rule => (
            <article key={rule.id} className={`rd-rule${editing === rule.id ? ' rd-rule-editing' : ''}`}>
              <div className="rd-rule-top"><div className="rd-queries">{rule.queries.map(q => <span key={q.id || q.query} className="rd-query">{q.query}</span>)}</div><span className={`rd-badge${rule.isActive ? '' : ' rd-badge-disabled'}`}>{rule.isActive ? 'Enabled' : 'Disabled'}</span></div>
              <div className="rd-destination"><RedirectIcon size={16} /><span className="rd-url"><span style={{ color: '#9a8fa5' }}>Destination </span>{rule.targetUrl}</span></div>
              <div className="rd-actions">
              <button disabled={busy} className="rd-button" onClick={() => { setEditing(rule.id); setQueries(rule.queries.map(q => q.query).join('\n')); setTargetUrl(rule.targetUrl); setActive(rule.isActive); document.getElementById('redirect-editor-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('redirect-queries')?.focus({ preventScroll: true }); }}>Edit</button>
              <button disabled={busy} className={`rd-button ${rule.isActive ? 'rd-disable' : 'rd-enable'}`} onClick={() => fetcher.submit({ intent: 'toggle', id: rule.id, isActive: String(!rule.isActive) }, { method: 'post' })}>{rule.isActive ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} className="rd-button rd-danger" onClick={() => { if (window.confirm('Delete this redirect?')) fetcher.submit({ intent: 'delete', id: rule.id }, { method: 'post' }); }}>Delete</button>
              </div>
            </article>
          ))}
        </section>
        </div>
      </div>
    </s-page>
  );
}
export const headers = args => boundary.headers(args);
