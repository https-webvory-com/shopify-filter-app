import { importSummary } from '../../utils/csvImportReport.js';

export default function CsvImportReport({ report, preview = false }) {
  if (!report) return null;
  const issues = [...(report.errors || []).map(e => ({ ...e, type: e.status === 'unconfirmed' ? 'Unconfirmed' : 'Skipped' })), ...(report.warnings || []).map(e => ({ ...e, type: 'Warning' }))];
  return <section role={report.skipped || report.unconfirmed || report.error ? 'alert' : 'status'} aria-label="CSV import results" style={{ margin: '16px 0', padding: 16, border: '1px solid #d4c5a0', borderRadius: 8, background: '#fffcf4', color: '#202223', overflowWrap: 'anywhere' }}>
    <strong>{preview ? 'CSV needs attention' : report.error ? 'Import could not be completed' : 'Import results'}</strong>
    <p>{preview ? `${report.skipped} rule(s) have CSV errors and will be skipped. Fix the source file or continue to import the other rules.` : report.error || importSummary(report)}</p>
    {report.unconfirmed > 0 && <p>Some requests failed before results could be confirmed. Check existing rules before importing those rows again.</p>}
    {!!issues.length && <div style={{ maxHeight: 240, overflowY: 'auto' }}><ul style={{ paddingLeft: 20, margin: 0 }}>{issues.map((issue, index) => <li key={index} style={{ marginBottom: 10 }}><strong>{issue.type}{issue.row ? ` — CSV row ${issue.row}` : ''}: {issue.name || issue.id || 'Rule'}</strong><div>{issue.reason}</div></li>)}</ul></div>}
  </section>;
}
