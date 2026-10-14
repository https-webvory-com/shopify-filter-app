import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { saveSearchBanner } from '../services/searchBanner.server.js';
import { BannerValidationError } from '../utils/searchBanner.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { rules: await prisma.searchBanner.findMany({ where: { shop: session.shop }, orderBy: { createdAt: 'desc' } }) };
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    await saveSearchBanner(session.shop, await request.formData());
    return { success: true };
  } catch (error) {
    if (error.code === 'P2002') return { error: 'A banner already uses this query, placement and position. Edit it or choose another position.' };
    if (error.code === 'P2025') return { error: 'Banner not found.' };
    return { error: error instanceof BannerValidationError ? error.message : 'Could not save the banner. Please retry.' };
  }
};
const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #c9cccf', borderRadius: 6, font: 'inherit' };
const buttonStyle = { padding: '8px 14px', borderRadius: 6, border: '1px solid #c9cccf', background: '#fff', cursor: 'pointer' };
export default function SearchBanners() {
  const { rules } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const defaults = { query: '', placement: 'top', position: 1, imageUrl: '', targetUrl: '', description: '', heading: '', content: '', buttonLabel: '', backgroundColor: '#f4f4f5', textColor: '#18181b' };
  const [values, setValues] = useState(defaults);
  const change = key => e => setValues(v => ({ ...v, [key]: e.target.value }));
  const field = (key, label, maxLength, extra = {}) => <label>{label}<input name={key} value={values[key]} onChange={change(key)} maxLength={maxLength} style={fieldStyle} {...extra} /></label>;
  const [active, setActive] = useState(true);
  const busy = fetcher.state !== 'idle';
  const reset = () => { setEditing(null); setValues(defaults); setActive(true); };
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setEditing(null); setValues(defaults); setActive(true);
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <s-page heading="Search Banners">
      <ui-title-bar title="Search Banners"><button variant="breadcrumb" onClick={() => navigate('/app/search')}>Search</button></ui-title-bar>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #e1e3e5', borderRadius: 10, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit banner' : 'Create banner'}</h2>
          <p>Show a promotion when a customer submits this exact search query. Matching ignores case and extra spaces.</p>
          {fetcher.data?.error && <p role="alert" style={{ color: '#b42318' }}>{fetcher.data.error}</p>}
          {fetcher.data?.success && <p role="status">Banner changes saved.</p>}
          <fetcher.Form method="post" style={{ display: 'grid', gap: 16 }}>
            <input type="hidden" name="intent" value={editing ? 'update' : 'create'} />
            {editing && <input type="hidden" name="id" value={editing} />}
            {field('query', 'Search query', 200, {required:true, placeholder:'e.g. summer dresses'})}
            <label>Banner placement<select name="placement" value={values.placement} onChange={change('placement')} style={fieldStyle}><option value="top">Top</option><option value="grid">Product grid</option></select></label>
            {values.placement === 'grid' && field('position','Product grid position',undefined,{type:'number',required:true,min:1,max:10000,step:1})}
            {values.placement === 'grid' && <span>Position 1 appears before the first product. Positions beyond the results are hidden. Banners do not replace products.</span>}
            {field('imageUrl','Banner image URL',2048,{type:'url',required:values.placement==='top',placeholder:'https://cdn.shopify.com/...'})}
            <span>Paste an HTTPS image URL, such as an image link from Shopify Content / Files. Grid banners can use text and a background color without an image.</span>
            {field('description','Description / image alternative text',300)}
            {field('targetUrl','Banner target URL (optional)',2048,{placeholder:'/collections/summer'})}
            {field('heading','Banner heading (optional)',200)}
            <label>Banner content (optional)<textarea name="content" value={values.content} onChange={change('content')} maxLength={2000} rows={3} style={fieldStyle}/></label>
            {field('buttonLabel','Button label (optional)',80)}
            <div style={{display:'flex',flexWrap:'wrap',gap:16}}>{field('backgroundColor','Background color',undefined,{type:'color'})}{field('textColor','Text color',undefined,{type:'color'})}</div>
            <label><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Enabled</label>
            <input type="hidden" name="isActive" value={String(active)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} type="submit" style={{ ...buttonStyle, background: '#5B21B6', color: '#fff' }}>{busy ? 'Saving...' : editing ? 'Update banner' : 'Create banner'}</button>
              {editing && <button disabled={busy} type="button" onClick={reset} style={buttonStyle}>Cancel</button>}
            </div>
          </fetcher.Form>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e1e3e5', borderRadius: 10, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Your banners</h2>
          {!rules.length && <p>No banners yet. Create a banner above.</p>}
          {rules.map(rule => (
            <div key={rule.id} style={{ padding: '16px 0', borderTop: '1px solid #e1e3e5', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{rule.query}</strong>
                <div>{rule.placement === 'top' ? 'Top' : 'Product grid - position '+rule.position}</div><div>{rule.isActive ? 'Enabled' : 'Disabled'}</div>
              </div>
              <button disabled={busy} style={buttonStyle} onClick={() => { setEditing(rule.id); setValues({...defaults,...rule}); setActive(rule.isActive); }}>Edit</button>
              <button disabled={busy} style={buttonStyle} onClick={() => fetcher.submit({ intent: 'toggle', id: rule.id, isActive: String(!rule.isActive) }, { method: 'post' })}>{rule.isActive ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} style={buttonStyle} onClick={() => { if (window.confirm('Delete this banner?')) fetcher.submit({ intent: 'delete', id: rule.id }, { method: 'post' }); }}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </s-page>
  );
}
export const headers = args => boundary.headers(args);
