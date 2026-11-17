export default function AdminNoSearchResults({ query = '', children = 'No results found.', style }) {
  const searched = String(query).trim();
  return <span role="status" data-admin-no-results="true" style={{ display: 'block', maxWidth: '100%', overflowWrap: 'anywhere', background: 'transparent', padding: 0, color: '#64748b', ...style }}>
    {searched ? <>No results found for “{query}”</> : children}
  </span>;
}
