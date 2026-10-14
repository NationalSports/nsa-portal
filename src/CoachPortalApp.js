// Public coach portal entry (/?portal=<alpha_tag>), mounted by index.js INSTEAD of the staff App.
//
// The portal used to boot the whole staff App as the anonymous role — the ~2.6 MB App bundle
// plus every customer's orders/estimates/invoices (~10 MB, ~9 s on 2026-10-13) — and then show
// one team. This loads only that team's data (src/lib/coachPortalData.js) and renders the same
// CoachPortal. Coach writes were already server-side (portal-action), so no save function is
// passed: CoachPortal then applies its post-write echoes to local state, which is all the old
// App save (an anon write the database rejects) ever achieved.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CoachPortal from './CoachPortal';
import { loadCoachPortal } from './lib/coachPortalData';
import { NSA, companyInfoFrom, PORTAL_SETTINGS_DEFAULTS } from './constants';

// A tab brought back after this long re-fetches (App's poll kept the old portal fresh).
const REFRESH_AFTER_MS = 60000;

const Screen = ({ children, dark }) => (
  <div style={dark
    ? { minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }
    : { minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
    <div style={{ fontSize: 48, fontWeight: 900, color: dark ? 'white' : '#1e3a5f', letterSpacing: dark ? -2 : undefined }}>NSA</div>
    {children}
  </div>
);

export default function CoachPortalApp({ alphaTag }) {
  const [status, setStatus] = useState('loading'); // loading | ok | not_found | ambiguous | error
  const [data, setData] = useState(null);
  const [sos, setSOs] = useState([]);
  const [ests, setEsts] = useState([]);
  const [invs, setInvs] = useState([]);
  const loadedAt = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async (quiet) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const r = await loadCoachPortal(alphaTag);
      if (r.status !== 'ok') { if (!quiet) setStatus(r.status); return; }
      if (r.appState.company_info) Object.assign(NSA, companyInfoFrom(r.appState.company_info));
      setData(r); setSOs(r.sos); setEsts(r.ests); setInvs(r.invs);
      loadedAt.current = Date.now();
      setStatus('ok');
    } catch (e) {
      console.error('[CoachPortal] load failed:', e.message);
      if (!quiet) setStatus('error'); // a failed background refresh keeps what is on screen
    } finally { loading.current = false; }
  }, [alphaTag]);

  const portalSettings = useMemo(() => ({ ...PORTAL_SETTINGS_DEFAULTS, ...((data && data.appState.portal_settings) || {}) }), [data]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const onVis = () => { if (!document.hidden && loadedAt.current && Date.now() - loadedAt.current >= REFRESH_AFTER_MS) load(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  if (status === 'loading') return <Screen dark><div style={{ fontSize: 13, color: '#94a3b8', letterSpacing: 3 }}>Loading portal...</div></Screen>;
  if (status === 'ambiguous') return <Screen>
    <div style={{ fontSize: 16, color: '#64748b' }}>This portal code matches more than one account.</div>
    <div style={{ fontSize: 13, color: '#94a3b8' }}>Please contact your NSA rep for an updated portal link.</div>
  </Screen>;
  if (status === 'not_found') return <Screen>
    <div style={{ fontSize: 16, color: '#64748b' }}>Portal not found for "<strong>{alphaTag}</strong>"</div>
    <div style={{ fontSize: 13, color: '#94a3b8' }}>Please check the link with your NSA rep.</div>
  </Screen>;
  if (status === 'error') return <Screen>
    <div style={{ fontSize: 16, color: '#64748b' }}>We couldn't load your portal just now.</div>
    <button onClick={() => { setStatus('loading'); load(false); }} style={{ padding: '10px 20px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Try again</button>
  </Screen>;

  return <CoachPortal customer={data.customer} allCustomers={data.customers} sos={sos} ests={ests} invs={invs}
    REPS={data.reps} prod={data.products} onUpdateInvs={setInvs} onUpdateSOs={setSOs} onUpdateEsts={setEsts}
    portalSettings={portalSettings} />;
}
