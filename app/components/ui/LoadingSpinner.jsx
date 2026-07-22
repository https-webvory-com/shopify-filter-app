export default function LoadingSpinner({ text = "Loading...", size = "40px" }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
      <div className="custom-spinner" style={{
        width: size,
        height: size,
        border: '4px solid rgba(91, 33, 182, 0.1)',
        borderTop: '4px solid #5B21B6',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }}></div>
      {text && <div style={{ marginTop: '16px', color: '#64748b', fontSize: '14px', fontWeight: '500' }}>{text}</div>}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
