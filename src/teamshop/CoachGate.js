import React, { useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import useCoachSession from './useCoachSession';

// Coach OTP magic-link sign-in for the Team Shop storefront. COPIES the
// working pattern from src/storefront/AdidasInventory.js (~line 1523-1532):
// the isolated supabaseCoach client + signInWithOtp with emailRedirectTo back
// to the current origin/path (must be allow-listed in Supabase Auth redirects).
//
// Renders the sign-in form when signed out; once signed in, shows the signed-in
// state (email + sign out) and renders `children` — callers (TeamShopApp) put
// the rest of the coach-only flow (TeamPicker → Catalog) inside.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function CoachGate({ children }) {
  const { loading, signedIn, email, signOut } = useCoachSession();
  const [signInEmail, setSignInEmail] = useState('');
  const [signInState, setSignInState] = useState('idle'); // idle|sending|sent|error

  const sendMagicLink = async () => {
    const em = signInEmail.trim();
    if (!EMAIL_RE.test(em) || signInState === 'sending') return;
    setSignInState('sending');
    const { error } = await supabaseCoach.auth.signInWithOtp({
      email: em,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    setSignInState(error ? 'error' : 'sent');
  };

  if (loading) return null;

  if (signedIn) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: '#f1f5f9', borderRadius: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, color: '#334155' }}>Signed in as <b>{email}</b></span>
          <button
            onClick={signOut}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Sign out
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '32px 20px', textAlign: 'center' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Coach sign-in</h2>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
        Enter your email — we'll send you a sign-in link, no password needed.
      </p>
      {signInState === 'sent' ? (
        <p style={{ fontSize: 14, color: '#16a34a', fontWeight: 600 }}>Check your email for the sign-in link.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            value={signInEmail}
            onChange={(e) => setSignInEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendMagicLink(); }}
            placeholder="coach@school.org"
            type="email"
            autoFocus
            style={{ padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
          />
          <button
            onClick={sendMagicLink}
            disabled={signInState === 'sending'}
            style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {signInState === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {signInState === 'error' && <span style={{ fontSize: 12.5, color: '#dc2626' }}>Couldn't send — try again.</span>}
        </div>
      )}
    </div>
  );
}
