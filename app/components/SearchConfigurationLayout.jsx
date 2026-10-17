import { useNavigate } from 'react-router';

export default function SearchConfigurationLayout({ children }) {
  const navigate = useNavigate();
  return <div className="search-config">
    <style>{`
      .search-config { font-family: Inter, sans-serif; color: #1e1b4b; padding-bottom: 32px; }
      .search-config * { box-sizing: border-box; }
      .search-config .search-config-back { display: inline-flex; align-items: center; gap: 8px; color: #5B21B6; font-size: 13px; font-weight: 600; text-decoration: none; margin-bottom: 20px; }
      .search-config .search-config-back:hover { text-decoration: underline; }
      .search-config .search-config-content { background: #f8f9fa; padding: 20px; border-radius: 12px; display: grid; gap: 20px; }
      .search-config .search-config-card { background: #fff; border: 1px solid #ede9fe; border-radius: 16px; padding: 24px; min-width: 0; box-shadow: 0 1px 3px rgba(91,33,182,.06); }
      .search-config h2 { font-size: 17px; font-weight: 650; margin: 0 0 12px; }
      .search-config p { color: #6b7280; font-size: 13px; line-height: 1.6; }
      .search-config form { min-width: 0; }
      .search-config label { font-size: 13px; font-weight: 500; line-height: 1.5; }
      .search-config label > input:not([type=checkbox]), .search-config label > select { margin-top: 6px; }
      .search-config input:not([type=hidden]):not([type=checkbox]), .search-config select, .search-config textarea { background: #fff; color: #1e1b4b; border: 1px solid #e5e7eb !important; border-radius: 8px !important; font: inherit; }
      .search-config input[type=checkbox] { accent-color: #5B21B6; width: 16px; height: 16px; vertical-align: middle; margin-right: 6px; }
      .search-config button { font: inherit; font-size: 13px; font-weight: 600; padding: 10px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; color: #5B21B6; cursor: pointer; }
      .search-config button:hover { background: #f5f3ff; border-color: #c4b5fd; }
      .search-config button.search-config-primary { background: #5B21B6; border-color: #5B21B6; color: #fff; }
      .search-config button.search-config-primary:hover { background: #4c1d95; }
      .search-config button.search-config-danger { color: #b42318; }
      .search-config button:disabled { opacity: .55; cursor: not-allowed; }
      .search-config :is(a,button,input,select,textarea):focus-visible { outline: 2px solid #7c3aed; outline-offset: 3px; }
      .search-config [role=alert] { color: #b42318; background: #fef3f2; padding: 12px 16px; border-radius: 8px; }
      .search-config [role=status] { color: #166534; background: #f0fdf4; padding: 12px 16px; border-radius: 8px; }
      .search-config .search-config-fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 20px; }
      .search-config .search-config-status { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 20px; background: #f3f4f6; color: #6b7280; margin-top: 6px; }
      .search-config .search-config-status[data-active=true] { background: #ecfdf5; color: #047857; }
      @media (max-width: 640px) { .search-config .search-config-content { padding: 12px; } .search-config .search-config-card { padding: 18px; } .search-config .search-config-fields { grid-template-columns: 1fr; } }
    `}</style>
    <a className="search-config-back" href="/app/search" onClick={e => { e.preventDefault(); navigate('/app/search'); }}>
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
      Back to Search
    </a>
    <div className="search-config-content">{children}</div>
  </div>;
}
