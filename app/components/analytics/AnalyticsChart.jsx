import { useState } from 'react';

const colors = ['#6d28d9', '#2563eb', '#0d9488', '#ea8a23', '#c2418c'];
const format = value => Number(value || 0).toLocaleString();

function saveFile(name, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AnalyticsChart({ chart, keys, rows, group, tab }) {
  const [hidden, setHidden] = useState([]);
  const [zoom, setZoom] = useState(1);
  const labels = new Map(rows.map(row => [row.key, row.label]));
  const visible = chart.slice(Math.max(0, chart.length - Math.ceil(chart.length / zoom)));
  const active = keys.filter(key => !hidden.includes(key));
  const peak = Math.max(1, ...visible.flatMap(point => active.map(key => point.values[key] || 0)));
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const stepSize = Math.max(1, [1, 2, 5, 10].find(value => value * magnitude >= peak / 4) * magnitude);
  const maximum = stepSize * 4;
  const width = 960, height = 310, left = 45, top = 15, plotWidth = 895, plotHeight = 250;
  const x = index => left + (visible.length < 2 ? plotWidth / 2 : index * plotWidth / (visible.length - 1));
  const y = value => top + plotHeight * (1 - value / maximum);
  const exportSvg = () => saveFile(`analytics-${tab}.svg`,
    new XMLSerializer().serializeToString(document.querySelector('.cfp-chart-svg svg')), 'image/svg+xml');
  const exportPng = () => {
    const markup = new XMLSerializer().serializeToString(document.querySelector('.cfp-chart-svg svg'));
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) saveFile(`analytics-${tab}.png`, blob, 'image/png'); URL.revokeObjectURL(url); });
    };
    image.src = url;
  };
  const csv = ['Date,' + keys.map(key => JSON.stringify(labels.get(key) || key)).join(','),
    ...chart.map(point => [point.bucket, ...keys.map(key => point.values[key] || 0)].join(','))].join('\n');
  return <div className="cfp-chart">
    <div className="cfp-chart-toolbar">
      <button type="button" title="Zoom in" onClick={() => setZoom(Math.min(8, zoom * 2))}>+</button>
      <button type="button" title="Zoom out" onClick={() => setZoom(Math.max(1, zoom / 2))}>-</button>
      <button type="button" title="Reset zoom" onClick={() => setZoom(1)}>Reset</button>
      <details><summary>Export</summary><div className="cfp-chart-menu">
        <button type="button" onClick={() => saveFile(`analytics-${tab}.csv`, csv, 'text/csv')}>Download CSV</button>
        <button type="button" onClick={exportSvg}>Download SVG</button>
        <button type="button" onClick={exportPng}>Download PNG</button>
      </div></details>
    </div>
    <div className="cfp-chart-svg"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${tab} chart`}>
      <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="#cbd5e1" />
      <line x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} stroke="#cbd5e1" />
      {[0, 1, 2, 3, 4].map(step => <g key={step}>
        <line x1={left} x2={left + plotWidth} y1={top + step * plotHeight / 4} y2={top + step * plotHeight / 4} stroke="#e7edf4" />
        <text x={left - 8} y={top + step * plotHeight / 4 + 4} textAnchor="end" fontSize="11" fill="#68778d">{format(maximum - stepSize * step)}</text>
      </g>)}
      {visible.map((point, index) => index % Math.max(1, Math.ceil(visible.length / 8)) === 0 || index === visible.length - 1
        ? <text key={point.bucket} x={x(index)} y={height - 15} textAnchor="middle" fontSize="11" fill="#68778d">
          {group === 'day_of_week' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Number(point.bucket)] : point.bucket}
        </text> : null)}
      {keys.map((key, series) => hidden.includes(key) ? null : <g key={key}>
        {visible.length === 1 && <line x1={x(0)} x2={x(0)} y1={y(0)} y2={y(visible[0].values[key] || 0)}
          stroke={colors[series % colors.length]} strokeWidth="2.5" strokeLinecap="round" />}
        {visible.length > 1 && <polygon opacity="0.07" fill={colors[series % colors.length]}
          points={`${x(0)},${y(0)} ${visible.map((point, index) => `${x(index)},${y(point.values[key] || 0)}`).join(' ')} ${x(visible.length - 1)},${y(0)}`} />}
        <polyline fill="none" stroke={colors[series % colors.length]} strokeWidth="2.5" strokeLinejoin="round"
          points={visible.map((point, index) => `${x(index)},${y(point.values[key] || 0)}`).join(' ')} />
        {visible.map((point, index) => <circle key={point.bucket} cx={x(index)} cy={y(point.values[key] || 0)} r="4" fill={colors[series % colors.length]} stroke="#fff" strokeWidth="1.5">
          <title>{`${labels.get(key) || key}: ${format(point.values[key] || 0)} on ${point.bucket}`}</title>
        </circle>)}
      </g>)}
    </svg></div>
    {keys.length > 1 && <div className="cfp-chart-legend">{keys.map((key, index) => <button type="button" key={key}
      aria-pressed={!hidden.includes(key)} onClick={() => setHidden(hidden.includes(key) ? hidden.filter(value => value !== key) : [...hidden, key])}>
      <span style={{ background: colors[index % colors.length] }} />{labels.get(key) || key}
    </button>)}</div>}
  </div>;
}
