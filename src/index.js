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
      return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: 'white', padding: 40, fontFamily: 'monospace' }}>
          <h1 style={{ color: '#f87171', fontSize: 24 }}>NSA Portal — Runtime Error</h1>
          <p style={{ color: '#94a3b8', marginBottom: 20 }}>The app crashed. Details below:</p>
          <pre style={{ background: '#1e293b', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 13, color: '#fbbf24', maxHeight: 300 }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <pre style={{ background: '#1e293b', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 11, color: '#94a3b8', marginTop: 12, maxHeight: 400 }}>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </pre>
          <button onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{ marginTop: 20, padding: '10px 24px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            Clear Cache & Reload
          </button>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 20, marginLeft: 12, padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
