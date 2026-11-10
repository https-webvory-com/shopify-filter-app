import { useState } from 'react';

const groupNames = ['Top Searches', 'Trending', 'Occasion'];
const inputStyle = { width: '100%', padding: 8, border: '1px solid #c9cccf', borderRadius: 6, boxSizing: 'border-box' };
const fromResource = item => ({ id: item.id, title: item.title, handle: item.handle, image: item.image?.originalSrc || item.image?.src || item.image?.url || '' });

export default function CompactSearchSettings({ value = [], onChange, disabled }) {
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const busy = disabled || picking;
  const pick = async (selected, multiple, done) => {
    setError(''); setPicking(true);
    try {
      if (!window.shopify?.resourcePicker) throw Error('Open these settings inside Shopify admin to choose collections.');
      const result = await window.shopify.resourcePicker({ type: 'collection', action: 'select', multiple, selectionIds: selected.filter(c => c.id).map(c => ({ id: c.id })) });
      if (result) done(result.map(fromResource));
    } catch (e) { setError(e.message || 'Could not open the collection picker. Please retry.'); }
    finally { setPicking(false); }
  };
  const update = (index, patch) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const updateGroup = (index, groupIndex, patch) => update(index, { groups: value[index].groups.map((g, i) => i === groupIndex ? { ...g, ...patch } : g) });
  return <section aria-label="Compact UI collections" style={{ display: 'grid', gap: 16 }}>
    <div><h3 style={{ marginBottom: 6 }}>Compact UI collections</h3><p style={{ margin: 0 }}>Choose up to four main collections for the tabs. For each tab, choose the related collections shown under Top Searches, Trending and Occasion. You can rename these headings. Typed searches keep your current search behavior.</p></div>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => pick(value, 4, selected => onChange(selected.map(item => ({ ...item, groups: value.find(c => c.id === item.id)?.groups || groupNames.map(title => ({ title, collections: [] })) }))))}>Choose main collections ({value.length}/4)</button>
    {value.length === 0 && <p>No main collections selected. Compact UI will show your existing suggestions and products until you configure tabs.</p>}
    {value.map((item, index) => <fieldset key={item.id || item.handle} disabled={busy} style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16, minWidth: 0 }}>
      <legend>{index + 1}. {item.title}</legend>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" disabled={index === 0} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>Move left</button>
        <button type="button" disabled={index === value.length - 1} onClick={() => { const next = [...value]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }}>Move right</button>
        <button type="button" aria-label={'Remove main collection ' + item.title} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
        {item.groups.map((group, groupIndex) => <div key={groupIndex} style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
          <label>Column {groupIndex + 1} heading<input aria-label={item.title + ' column ' + (groupIndex + 1) + ' heading'} value={group.title} maxLength={60} required style={inputStyle} onChange={e => updateGroup(index, groupIndex, { title: e.target.value })}/></label>
          <button type="button" onClick={() => pick(group.collections, 12, collections => updateGroup(index, groupIndex, { collections }))}>Choose related collections ({group.collections.length}/12)</button>
          <ol style={{ paddingLeft: 22, margin: 0 }}>{group.collections.map((child, childIndex) => <li key={child.handle} style={{ marginBottom: 8 }}>
            {child.title} <button type="button" disabled={childIndex === 0} aria-label={'Move ' + child.title + ' up'} onClick={() => { const collections = [...group.collections]; [collections[childIndex - 1], collections[childIndex]] = [collections[childIndex], collections[childIndex - 1]]; updateGroup(index, groupIndex, { collections }); }}>↑</button> <button type="button" aria-label={'Remove related collection ' + child.title} onClick={() => updateGroup(index, groupIndex, { collections: group.collections.filter((_, i) => i !== childIndex) })}>Remove</button>
          </li>)}</ol>
        </div>)}
      </div>
    </fieldset>)}
    <small>Links use the selected collection’s image and title. Four links per column appear at a time, with Previous and Next controls for additional links. Changes apply after Save settings.</small>
  </section>;
}
