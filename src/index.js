import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[NSA ErrorBoundary]', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const stack = err && err.stack ? err.stack : 'No stack trace available';
      return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: 'white', padding: 40, fontFamily: 'monospace' }}>
          <h1 style={{ color: '#f87171', fontSize: 24 }}>NSA Portal — Runtime Error</h1>
          <p style={{ color: '#94a3b8', marginBottom: 20 }}>The app crashed. Details below:</p>
          <pre style={{ background: '#1e293b', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 13, color: '#fbbf24', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {err && err.toString()}
          </pre>
          <h3 style={{ color: '#94a3b8', fontSize: 14, marginTop: 16 }}>Full Stack Trace:</h3>
          <pre style={{ background: '#1e293b', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 11, color: '#60a5fa', marginTop: 8, maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {stack}
          </pre>
          {this.state.errorInfo && this.state.errorInfo.componentStack && (
            <>
              <h3 style={{ color: '#94a3b8', fontSize: 14, marginTop: 16 }}>Component Stack:</h3>
              <pre style={{ background: '#1e293b', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 11, color: '#94a3b8', marginTop: 8, maxHeight: 200 }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </>
          )}
          <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.href = window.location.pathname; }}
              style={{ padding: '10px 24px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              Clear Cache & Hard Reload
            </button>
            <button onClick={() => { window.location.href = window.location.pathname; }}
              style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              Hard Reload
            </button>
          </div>
          <p style={{ color: '#475569', fontSize: 11, marginTop: 20 }}>Build: {new Date().toISOString().split('T')[0]} | If this persists, screenshot this page and send to your admin.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
