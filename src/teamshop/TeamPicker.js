import React, { useState, useEffect, useCallback } from 'react';
import useCoachSession from './useCoachSession';

// Which team (customer) a signed-in coach is acting for, in this order flow.
// Fetches the coach's linked customers from netlify/functions/teamshop-context.js
// (JWT-authed — see useCoachSession for the bearer token). Auto-selects when
// there's exactly one; otherwise shows a simple picker. The selection persists
// in localStorage so a returning coach skips the picker next time.
export const STORAGE_KEY = 'nts_customer';

export function loadSavedCustomer() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCustomer(customer) {
  try {
    if (customer) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(customer));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* localStorage unavailable — selection just won't persist */ }
}

export default function TeamPicker({ onSelect }) {
  const { accessToken } = useCoachSession();
  const [state, setState] = useState('loading'); // loading|ready|error
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/teamshop-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: '{}',
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) { setError(json.error || 'Could not load your teams'); setState('error'); return; }
        setCustomers(Array.isArray(json.customers) ? json.customers : []);
        setState('ready');
      } catch (e) {
        if (alive) { setError('Network error — try again'); setState('error'); }
      }
    })();
    return () => { alive = false; };
  }, [accessToken]);

  // Auto-select: a previously-saved customer (if still in the allowed list) wins,
  // else exactly-one customer auto-selects, else the coach picks below.
  useEffect(() => {
    if (state !== 'ready' || !customers.length) return;
    const saved = loadSavedCustomer();
    const stillAllowed = saved && customers.find((c) => c.id === saved.id);
    if (stillAllowed) { onSelect && onSelect(stillAllowed); return; }
    if (customers.length === 1) { saveCustomer(customers[0]); onSelect && onSelect(customers[0]); }
  }, [state, customers, onSelect]);

  const choose = useCallback((c) => { saveCustomer(c); onSelect && onSelect(c); }, [onSelect]);

  if (state === 'loading') return <p style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Loading your teams…</p>;
  if (state === 'error') return <p style={{ color: '#dc2626', textAlign: 'center', padding: 24 }}>{error}</p>;
  if (!customers.length) return <p style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>No teams linked to your account yet — contact your rep.</p>;
  if (customers.length === 1) return null; // auto-selected above

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '32px 20px', textAlign: 'center' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>Choose a team</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {customers.map((c) => (
          <button
            key={c.id}
            onClick={() => choose(c)}
            style={{ padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
          >
            {c.name || c.id}
          </button>
        ))}
      </div>
    </div>
  );
}
