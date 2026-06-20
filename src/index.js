import React from 'react';
import ReactDOM from 'react-dom/client';
import LoginGate from './LoginGate';
import {
  supabase, sbSignIn, sbSignUp, sbResendSignup, sbResetPassword,
  sbGetSession, sbLinkTeamAuth, sbGetMyProfile, sbGetTeam,
} from './lib/auth';
import { DEFAULT_REPS } from './constants';

// The full portal (App.js, ~2.6MB) is code-split out so a visitor who isn't
// logged in gets the login screen instantly without downloading it. App loads
// only once a session exists (see MainApp below). Retry once on a transient
// chunk-load failure; the ErrorBoundary's "Clear Cache & Hard Reload" is the
// final fallback for a hard failure (e.g. a stale deploy).
const App = React.lazy(() =>
  import('./App').catch(
    () => new Promise((res, rej) => setTimeout(() => import('./App').then(res, rej), 500))
  )
);

// Public club storefront lives at /shop/<slug>. Shoppers should never load the
// full portal bundle or hit the login gate, so we branch on the path here.
const Storefront = React.lazy(() => import('./storefront/Storefront'));
// Public, login-free order tracker at /shop/order/<status_token>. Kept separate
// from the storefront because it loads an order by token regardless of store
// status (OMG shadow stores are archived) — see src/storefront/OrderTrack.js.
const OrderTrack = React.lazy(() => import('./storefront/OrderTrack'));
// Public coach-facing adidas inventory reference at /adidas — login-free like
// the storefront; joins the adidas catalog with live Cowork availability.
const AdidasInventory = React.lazy(() => import('./storefront/AdidasInventory'));
const _path = typeof window !== 'undefined' ? window.location.pathname : '';
const isOrderTrack = _path.startsWith('/shop/order/');
const isStorefront = _path.startsWith('/shop/') && !isOrderTrack;
// /adidas is the canonical path. /livelook is the same catalog, served at
// nationalsportsapparel.com/livelook via a Netlify proxy rewrite from the
// marketing site — the proxy keeps the browser URL at /livelook, so the
// client-side router must recognize it here too.
const isAdidasInventory = _path === '/adidas' || _path === '/adidas/' || _path === '/livelook' || _path === '/livelook/';
// /auth/setup and /auth/reset complete the magic-link / password-reset flow.
// App short-circuits these to its own landing page BEFORE any login gate, so
// they must load App directly rather than the pre-auth gate below.
const isAuthFlow = _path === '/auth/setup' || _path === '/auth/reset';

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

// Dark loading screen shown while the App chunk downloads — matches
// LoginGate's own loading state so the gate→portal handoff is seamless.
const AppFallback = () => (
  <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ fontSize: 13, color: '#94a3b8', letterSpacing: 3 }}>Loading…</div>
  </div>
);

const _readJSON = (key, fallback) => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};

// Portal entry point. While logged out, renders the lightweight LoginGate
// WITHOUT loading App.js. On login (or an auto-restored Supabase session) it
// writes nsa_user and swaps in the lazy App, which reads that same nsa_user on
// mount. Already-logged-in visitors (nsa_user present) skip straight to App —
// behavior identical to before the split, just delivered as a separate chunk.
function MainApp() {
  const [authed, setAuthed] = React.useState(() => !!_readJSON('nsa_user', null));
  // Seed reps from the same cache App.js uses (nsa_reps) so first-time-setup and
  // admin modes work offline; refresh from the live roster in the background.
  const [reps, setReps] = React.useState(() => _readJSON('nsa_reps', DEFAULT_REPS));

  React.useEffect(() => {
    if (authed) return; // only the gate needs the roster
    let alive = true;
    sbGetTeam().then((t) => { if (alive && t && t.length) setReps(t); }).catch(() => {});
    return () => { alive = false; };
  }, [authed]);

  // Mirror App.handleLogin: persist the user, then reveal the portal. App's own
  // `cu` state reads nsa_user on mount, so the session carries across the swap.
  const handleLogin = (user) => {
    try { localStorage.setItem('nsa_user', JSON.stringify(user)); } catch {}
    setAuthed(true);
  };

  if (!authed) {
    return (
      <LoginGate
        onLogin={handleLogin} reps={reps} supabase={supabase}
        sbSignIn={sbSignIn} sbSignUp={sbSignUp} sbResendSignup={sbResendSignup}
        sbResetPassword={sbResetPassword} sbGetSession={sbGetSession}
        sbLinkTeamAuth={sbLinkTeamAuth} sbGetMyProfile={sbGetMyProfile}
      />
    );
  }
  return <React.Suspense fallback={<AppFallback />}><App /></React.Suspense>;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {isAdidasInventory
        ? <React.Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>Loading inventory…</div>}><AdidasInventory /></React.Suspense>
        : isOrderTrack
        ? <React.Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>Loading your order…</div>}><OrderTrack /></React.Suspense>
        : isStorefront
        ? <React.Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>Loading store…</div>}><Storefront /></React.Suspense>
        : isAuthFlow
        ? <React.Suspense fallback={<AppFallback />}><App /></React.Suspense>
        : <MainApp />}
    </ErrorBoundary>
  </React.StrictMode>
);
