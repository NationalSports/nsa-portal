/* eslint-disable */
// Invite-only new-hire onboarding wizard. Reached at /onboarding?token=<token>.
// The hire is NOT a portal user — everything goes through the token-gated
// onboarding-public Netlify function. Sensitive fields (SSN, bank account/
// routing) are sent up and encrypted server-side; they are never persisted in
// the browser. Every section view / scroll-to-end / acknowledgment is reported
// to the audit trail so HR can prove the hire reviewed the whole packet.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NSA } from './constants';
import { HANDBOOK, HANDBOOK_SECTION_COUNT } from './onboardingHandbook';
import {
  CA_NOTICES, AT_WILL_STATEMENT, WIZARD_STEPS, FILING_STATUSES, ACCOUNT_TYPES,
  ESIGN_CONSENT, CPRA_NOTICE, formatPayComponents,
  DOCUMENT_TYPES, MAX_UPLOAD_MB, I9_NOTICE,
  W9_CLASSIFICATIONS, W9_LLC_TAX, W9_CERTIFICATION,
} from './onboardingForms';

const API = '/.netlify/functions/onboarding-public';
const nowISO = () => new Date().toISOString();
// When embedded in the marketing site (nationalsportsapparel.com/welcome) the
// page already shows the NSA header/footer, so we drop our own dark header and
// just keep a slim progress bar.
const EMBED = (() => { try { return new URLSearchParams(window.location.search).get('embed') === '1'; } catch { return false; } })();
// Pull the staff-entered commission basis (if any) to prefill the commission step.
const _commissionBasis = (invite) => { const c = (invite?.pay_components || []).find((x) => x && x.type === 'commission'); return c ? (c.basis || '') : ''; };

// ── styles ────────────────────────────────────────────────────────────────
const C = {
  ink: '#0f172a', muted: '#64748b', line: '#e2e8f0', brand: '#191919', accent: '#1e40af',
  good: '#16a34a', goodBg: '#dcfce7', bad: '#dc2626', card: '#ffffff', pageBg: '#f1f5f9',
};
const S = {
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  btn: { padding: '11px 22px', background: C.brand, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  btnGhost: { padding: '11px 22px', background: '#fff', color: C.ink, border: '1px solid #cbd5e1', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' },
};

function Field({ label, children }) {
  return (<div><label style={S.label}>{label}</label>{children}</div>);
}
function Text({ value, onChange, placeholder, type = 'text', autoComplete }) {
  return <input style={S.input} type={type} value={value || ''} placeholder={placeholder} autoComplete={autoComplete}
    onChange={(e) => onChange(e.target.value)} />;
}
function Check({ checked, onChange, children }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: '10px 0', fontSize: 13.5, color: '#334155', lineHeight: 1.5 }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
      <span>{children}</span>
    </label>
  );
}

export default function OnboardingWizard() {
  const token = (() => { try { return new URLSearchParams(window.location.search).get('token') || ''; } catch { return ''; } })();
  const [phase, setPhase] = useState('loading'); // loading | error | wizard | done
  const [errMsg, setErrMsg] = useState('');
  const [invite, setInvite] = useState(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState({});            // non-sensitive form data
  const [sensitive, setSensitive] = useState({});  // {ssn, bank_account, bank_routing} – local only, sent on save
  const [sensitiveSet, setSensitiveSet] = useState({});
  const [signatures, setSignatures] = useState({});
  const [acks, setAcks] = useState({});
  const [readSections, setReadSections] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [documents, setDocuments] = useState([]);

  const eventBuf = useRef([]);

  // Build the active step list (commission step only if eligible).
  const steps = WIZARD_STEPS.filter((s) => s.id !== 'commission' || (invite && invite.commission_eligible));
  const step = steps[stepIdx] || steps[0];

  // ── load ──
  useEffect(() => {
    if (!token) { setPhase('error'); setErrMsg('This link is missing its access token. Please use the link from your invite email.'); return; }
    (async () => {
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'load' }) });
        const j = await r.json();
        if (!j.ok) {
          setErrMsg(j.error === 'expired' ? 'This invite link has expired. Ask your hiring contact to resend it.'
            : j.error === 'void' ? 'This invite has been canceled. Contact your hiring contact.'
              : 'We couldn\'t find this invite. Please use the link from your invite email.');
          setPhase('error'); return;
        }
        setInvite(j.invite);
        setDocuments(j.documents || []);
        if (j.submission) {
          setData(j.submission.data || {});
          setSignatures(j.submission.signatures || {});
          setAcks(j.submission.acknowledgments || {});
          setSensitiveSet(j.submission.sensitive_set || {});
          if (j.submission.submitted) { setPhase('done'); return; }
          const doneKeys = Object.keys(j.submission.acknowledgments || {}).filter((k) => k.startsWith('handbook:') && k !== 'handbook:all');
          setReadSections(new Set(doneKeys.map((k) => k.slice('handbook:'.length))));
        }
        setPhase('wizard');
        track('start', null);
      } catch (e) { setPhase('error'); setErrMsg('Something went wrong loading your paperwork. Please try again.'); }
    })();
  }, [token]); // eslint-disable-line

  // ── tracking (batched) ──
  const flush = useCallback(async () => {
    if (!eventBuf.current.length) return;
    const events = eventBuf.current.splice(0, eventBuf.current.length);
    try { await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'track', events }) }); } catch {}
  }, [token]);
  const track = useCallback((kind, ref, meta) => {
    eventBuf.current.push({ kind, ref, meta: { ...(meta || {}), at: nowISO() } });
    if (eventBuf.current.length >= 6) flush();
  }, [flush]);
  useEffect(() => {
    const t = setInterval(flush, 8000);
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', onHide); flush(); };
  }, [flush]);

  // ── save ──
  const save = useCallback(async (extra = {}, action = 'save') => {
    setSaving(true);
    const completed = Array.from(new Set([...(data._completed_steps || []), ...(extra._completed_steps || [])]));
    const payload = {
      token, action,
      data: { ...data, ...(extra.data || {}) },
      sensitive: extra.sensitive || undefined,
      signatures: { ...signatures, ...(extra.signatures || {}) },
      acknowledgments: { ...acks, ...(extra.acknowledgments || {}) },
      current_step: extra.current_step || step.id,
      completed_steps: completed,
    };
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      setSaving(false);
      if (!j.ok) return false;
      setSavedAt(new Date());
      if (extra.data) setData((d) => ({ ...d, ...extra.data }));
      if (extra.acknowledgments) setAcks((a) => ({ ...a, ...extra.acknowledgments }));
      if (extra.signatures) setSignatures((s) => ({ ...s, ...extra.signatures }));
      if (extra.sensitive) setSensitiveSet((s) => { const n = { ...s }; Object.keys(extra.sensitive).forEach((k) => { if (extra.sensitive[k]) n[k] = true; }); return n; });
      return true;
    } catch { setSaving(false); return false; }
  }, [token, data, signatures, acks, step]);

  // ── document upload / delete ──
  const uploadDoc = async (kind, file) => {
    if (!file) return { ok: false };
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: `File too large (max ${MAX_UPLOAD_MB} MB)` };
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file); });
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'upload', kind, filename: file.name, content_type: file.type || 'application/octet-stream', data_base64: b64 }) });
      const j = await r.json();
      if (j.ok && j.document) { setDocuments((d) => [...d, j.document]); track('doc_upload', kind); }
      return j;
    } catch { return { ok: false, error: 'Upload failed' }; }
  };
  const deleteDoc = async (id) => {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'delete_doc', document_id: id }) });
      const j = await r.json();
      if (j.ok) setDocuments((d) => d.filter((x) => x.id !== id));
      return j;
    } catch { return { ok: false }; }
  };

  const setField = (path, value) => setData((d) => {
    const next = JSON.parse(JSON.stringify(d));
    let o = next; const parts = path.split('.');
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = value; return next;
  });
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);

  // Only send sensitive keys the hire actually entered this session (non-empty).
  const sensitivePayload = () => {
    const out = {};
    for (const k of ['ssn', 'bank_account', 'bank_routing', 'ein']) if (sensitive[k]) out[k] = sensitive[k];
    return Object.keys(out).length ? out : undefined;
  };

  const goNext = async () => {
    await flush();
    const ok = await save({ data: { _completed_steps: Array.from(new Set([...(data._completed_steps || []), step.id])) }, sensitive: sensitivePayload(), current_step: steps[Math.min(stepIdx + 1, steps.length - 1)].id });
    if (ok === false) { /* keep going; save is best-effort */ }
    setData((d) => ({ ...d, _completed_steps: Array.from(new Set([...(d._completed_steps || []), step.id])) }));
    const next = Math.min(stepIdx + 1, steps.length - 1);
    setStepIdx(next); track('step_view', steps[next].id); window.scrollTo(0, 0);
  };
  const goBack = () => { const p = Math.max(stepIdx - 1, 0); setStepIdx(p); track('step_view', steps[p].id); window.scrollTo(0, 0); };

  // ── gates per step ──
  const totalHb = HANDBOOK_SECTION_COUNT || 43;
  const handbookReadAll = readSections.size >= totalHb;
  const allCaAcked = CA_NOTICES.every((n) => acks[n.key]);

  // ── render ──
  if (phase === 'loading') return <Shell><Center><div style={{ color: C.muted }}>Loading your paperwork…</div></Center></Shell>;
  if (phase === 'error') return <Shell><Center><div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div><h2 style={{ margin: '0 0 8px', color: C.ink }}>Link problem</h2><div style={{ color: C.muted, fontSize: 14, maxWidth: 360 }}>{errMsg}</div></Center></Shell>;
  if (phase === 'done') return <Shell><Center><div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div><h2 style={{ margin: '0 0 8px', color: C.ink }}>All done — thank you!</h2><div style={{ color: C.muted, fontSize: 14, maxWidth: 420, lineHeight: 1.6 }}>Your new-hire paperwork for <strong>{invite?.full_name}</strong> has been submitted to National Sports Apparel. There's nothing else you need to do. We'll be in touch before your first day!</div></Center></Shell>;

  const progress = steps.length ? Math.min(1, (new Set([...(data._completed_steps || []), ...(stepIdx > 0 ? [steps[stepIdx - 1].id] : [])]).size) / steps.length) : 0;
  return (
    <Shell progress={progress}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 80px' }}>
        {/* progress */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '18px 0 14px' }}>
          {steps.map((s, i) => (
            <div key={s.id} onClick={() => { setStepIdx(i); track('step_view', s.id); }} style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '5px 9px', borderRadius: 20,
              background: i === stepIdx ? C.brand : (data._completed_steps || []).includes(s.id) ? C.goodBg : '#fff',
              color: i === stepIdx ? '#fff' : (data._completed_steps || []).includes(s.id) ? '#166534' : C.muted, border: '1px solid ' + (i === stepIdx ? C.brand : C.line) }}>
              {(data._completed_steps || []).includes(s.id) && i !== stepIdx ? '✓ ' : ''}{s.label}
            </div>
          ))}
        </div>

        <div key={step.id} className="onb-card" style={{ background: C.card, border: '1px solid ' + C.line, borderRadius: 14, padding: 26, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {step.id === 'welcome' && <Welcome invite={invite} />}
          {step.id === 'consent' && <Consent acks={acks} setAck={(key, v) => setAcks((a) => ({ ...a, [key]: v ? { at: nowISO() } : undefined }))} onView={(k) => track('section_view', k)} />}
          {step.id === 'personal' && <Personal get={get} setField={setField} sensitive={sensitive} setSensitive={setSensitive} sensitiveSet={sensitiveSet} invite={invite} />}
          {step.id === 'direct_deposit' && <DirectDeposit get={get} setField={setField} sensitive={sensitive} setSensitive={setSensitive} sensitiveSet={sensitiveSet} />}
          {step.id === 'emergency' && <Emergency get={get} setField={setField} />}
          {step.id === 'tax' && <Tax invite={invite} get={get} setField={setField} sensitive={sensitive} setSensitive={setSensitive} sensitiveSet={sensitiveSet} signatures={signatures} setSig={(v) => setSignatures((s) => ({ ...s, tax_form: v }))} />}
          {step.id === 'documents' && <Documents documents={documents} onUpload={uploadDoc} onDelete={deleteDoc} />}
          {step.id === 'commission' && <Commission invite={invite} get={get} setField={setField} signatures={signatures} setSig={(v) => setSignatures((s) => ({ ...s, commission_agreement: v }))} acks={acks} setAck={(v) => setAcks((a) => ({ ...a, commission_agreement: v }))} />}
          {step.id === 'handbook' && <Handbook readSections={readSections} setRead={(id) => { setReadSections((s) => { const n = new Set(s); n.add(id); return n; }); save({ acknowledgments: { ['handbook:' + id]: { at: nowISO(), scrolled: true } } }); track('scroll_complete', 'handbook:' + id); }} onView={(id) => track('section_view', 'handbook:' + id)} acks={acks} setAck={(v) => setAcks((a) => ({ ...a, 'handbook:all': v, 'policy:at_will': v }))} signatures={signatures} setSig={(v) => setSignatures((s) => ({ ...s, handbook: v }))} totalHb={totalHb} />}
          {step.id === 'ca_notices' && <CaNotices acks={acks} setAck={(key, v) => setAcks((a) => ({ ...a, [key]: v ? { at: nowISO() } : undefined }))} onView={(key) => track('section_view', key)} signatures={signatures} setSig={(v) => setSignatures((s) => ({ ...s, ca_notices: v }))} />}
          {step.id === 'review' && <Review invite={invite} data={data} acks={acks} signatures={signatures} sensitiveSet={sensitiveSet} steps={steps} totalHb={totalHb} readCount={readSections.size} />}
        </div>

        {/* nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <button style={S.btnGhost} disabled={stepIdx === 0} onClick={goBack}>← Back</button>
          <div style={{ fontSize: 11, color: C.muted }}>{saving ? 'Saving…' : savedAt ? 'Saved ✓' : ''}</div>
          {step.id === 'review'
            ? <button style={{ ...S.btn, background: C.good }} onClick={async () => { const ok = await submitAll(); if (ok) { setPhase('done'); } }}>Submit my paperwork ✓</button>
            : <button style={{ ...S.btn, opacity: stepGateOk(step, { handbookReadAll, allCaAcked, signatures, acks, invite }) ? 1 : 0.4, pointerEvents: stepGateOk(step, { handbookReadAll, allCaAcked, signatures, acks, invite }) ? 'auto' : 'none' }} onClick={goNext}>Save & continue →</button>}
        </div>
        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 11, color: C.muted }}>
          Your information is encrypted and shared only with National Sports Apparel HR. You can close this page and return anytime using your link.
        </div>
      </div>
    </Shell>
  );

  async function submitAll() {
    // Persist signatures/acks (and any entered sensitive fields) then mark submitted.
    await save({ sensitive: sensitivePayload() }, 'save');
    const ok = await save({ current_step: 'review', _completed_steps: steps.map((s) => s.id) }, 'submit');
    track('submit', null); await flush();
    return ok !== false;
  }
}

// Gate logic for the "continue" button per step.
function stepGateOk(step, ctx) {
  if (step.id === 'consent') return ctx.acks['consent:esign'] && ctx.acks['consent:privacy'];
  if (step.id === 'tax') return ctx.signatures.tax_form && ctx.signatures.tax_form.name;
  if (step.id === 'handbook') return ctx.handbookReadAll && ctx.acks['handbook:all'] && ctx.signatures.handbook && ctx.signatures.handbook.name;
  if (step.id === 'ca_notices') return ctx.allCaAcked && ctx.signatures.ca_notices && ctx.signatures.ca_notices.name;
  if (step.id === 'commission') return ctx.acks.commission_agreement && ctx.signatures.commission_agreement && ctx.signatures.commission_agreement.name;
  return true;
}

// ── shells ──
const ONB_CSS = `
.onb, .onb * { box-sizing: border-box; }
.onb { -webkit-font-smoothing: antialiased; }
.onb input, .onb select, .onb textarea { transition: border-color .15s ease, box-shadow .15s ease; font-family: inherit; }
.onb input:focus, .onb select:focus, .onb textarea:focus { border-color: #1e40af !important; box-shadow: 0 0 0 3px rgba(30,64,175,.12) !important; }
.onb button { transition: transform .08s ease, opacity .15s ease, box-shadow .15s ease, background .15s ease; }
.onb button:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(15,23,42,.14); }
.onb button:not(:disabled):active { transform: translateY(0); }
.onb .onb-row { display: flex; gap: 10px; }
.onb .onb-card { animation: onbIn .25s ease; }
@keyframes onbIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.onb .onb-acc-body { animation: onbExpand .2s ease; }
@keyframes onbExpand { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 560px) {
  .onb .onb-row { flex-direction: column; gap: 0; }
  .onb .onb-hero { font-size: 22px !important; }
}
`;

function Shell({ children, progress }) {
  return (
    <div className="onb" style={{ minHeight: EMBED ? 'auto' : '100vh', background: C.pageBg, fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: C.ink }}>
      <style>{ONB_CSS}</style>
      {EMBED ? (
        typeof progress === 'number' && (
          <div style={{ position: 'sticky', top: 0, zIndex: 5, height: 4, background: '#e2e8f0' }}>
            <div style={{ height: '100%', width: `${Math.max(2, Math.round(progress * 100))}%`, background: 'linear-gradient(90deg,#3b82f6,#22c55e)', transition: 'width .4s ease' }} />
          </div>
        )
      ) : (
        <div style={{ background: 'linear-gradient(135deg,#191919 0%,#262d3d 100%)', padding: '18px 0 16px', textAlign: 'center', position: 'relative' }}>
          <img src={NSA.logoUrl} alt="National Sports Apparel" style={{ height: 42, filter: 'brightness(0) invert(1)' }} />
          <div style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 4, fontWeight: 600 }}>New&nbsp;Hire&nbsp;Onboarding</div>
          {typeof progress === 'number' && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,.12)' }}>
              <div style={{ height: '100%', width: `${Math.max(2, Math.round(progress * 100))}%`, background: 'linear-gradient(90deg,#3b82f6,#22c55e)', transition: 'width .4s ease' }} />
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
function Center({ children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: '60vh', padding: 24 }}>{children}</div>;
}
function H({ children, sub }) {
  return (<div style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontSize: 20, color: C.ink }}>{children}</h2>{sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}</div>);
}
function SignBlock({ value, onChange, statement }) {
  return (
    <div style={{ marginTop: 16, padding: 14, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10 }}>
      {statement && <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.55, marginBottom: 10 }}>{statement}</div>}
      <label style={S.label}>Type your full legal name to sign</label>
      <input style={S.input} value={(value && value.name) || ''} placeholder="Your full legal name"
        onChange={(e) => onChange({ name: e.target.value, signed_at: e.target.value ? nowISO() : null })} />
      {value && value.name && <div style={{ fontSize: 11, color: C.good, marginTop: 6 }}>Signed {new Date(value.signed_at || Date.now()).toLocaleString()}</div>}
    </div>
  );
}

// ── steps ──
function Welcome({ invite }) {
  return (
    <div>
      <H sub={`We're glad you're joining the team. This packet collects everything we need before your first day. It takes about 15–20 minutes and you can stop and resume anytime.`}>Welcome, {invite?.full_name?.split(' ')[0] || 'there'}!</H>
      <div style={{ marginTop: 14, background: '#f8fafc', border: '1px solid ' + C.line, borderRadius: 10, padding: 16, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
        <div><strong>Position:</strong> {invite?.position_title || '—'}</div>
        <div><strong>Supervisor:</strong> {invite?.supervisor || '—'}</div>
        {invite?.hire_date && <div><strong>Start date:</strong> {new Date(invite.hire_date).toLocaleDateString()}</div>}
        {formatPayComponents(invite?.pay_components) && <div><strong>Compensation:</strong> {formatPayComponents(invite.pay_components)}</div>}
        <div><strong>Email on file:</strong> {invite?.personal_email}</div>
        {invite?.nsa_email && <div><strong>Your NSA email:</strong> {invite.nsa_email}</div>}
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
        You'll complete: personal info, direct deposit, emergency contacts, tax forms (W-4 &amp; California DE 4),
        {invite?.commission_eligible ? ' your commission agreement,' : ''} the employee handbook, and required California notices.
      </div>
    </div>
  );
}

function Consent({ acks, setAck, onView }) {
  useEffect(() => { onView('consent:view'); }, []); // eslint-disable-line
  return (
    <div>
      <H sub="Two quick things before we start — please read and agree to each.">Consent &amp; Privacy</H>
      <div style={{ background: '#f8fafc', border: '1px solid ' + C.line, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#334155', lineHeight: 1.6, marginTop: 12 }}>
        {ESIGN_CONSENT}
      </div>
      <Check checked={!!acks['consent:esign']} onChange={(v) => setAck('consent:esign', v)}>I agree to sign and complete these documents electronically.</Check>
      <div style={{ background: '#f8fafc', border: '1px solid ' + C.line, borderRadius: 10, padding: '12px 16px', marginTop: 14 }} dangerouslySetInnerHTML={{ __html: CPRA_NOTICE }} />
      <Check checked={!!acks['consent:privacy']} onChange={(v) => setAck('consent:privacy', v)}>I have read the Notice at Collection above.</Check>
    </div>
  );
}

function Personal({ get, setField, sensitive, setSensitive, sensitiveSet }) {
  return (
    <div>
      <H sub="Your legal information for payroll and HR records.">Personal Information</H>
      <Field label="Full legal name"><Text value={get('personal.full_name')} onChange={(v) => setField('personal.full_name', v)} autoComplete="name" /></Field>
      <Field label="Street address"><Text value={get('personal.street')} onChange={(v) => setField('personal.street', v)} autoComplete="address-line1" /></Field>
      <div className="onb-row">
        <div style={{ flex: 2 }}><Field label="City"><Text value={get('personal.city')} onChange={(v) => setField('personal.city', v)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="State"><Text value={get('personal.state')} onChange={(v) => setField('personal.state', v)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="ZIP"><Text value={get('personal.zip')} onChange={(v) => setField('personal.zip', v)} /></Field></div>
      </div>
      <div className="onb-row">
        <div style={{ flex: 1 }}><Field label="Phone"><Text type="tel" value={get('personal.phone')} onChange={(v) => setField('personal.phone', v)} autoComplete="tel" /></Field></div>
        <div style={{ flex: 1 }}><Field label="Date of birth"><Text type="date" value={get('personal.dob')} onChange={(v) => setField('personal.dob', v)} /></Field></div>
      </div>
      <Field label="Gender (optional, for EEO records)"><Text value={get('personal.gender')} onChange={(v) => setField('personal.gender', v)} /></Field>
      <Field label="Social Security Number">
        <Text value={sensitive.ssn} onChange={(v) => setSensitive((s) => ({ ...s, ssn: v }))} placeholder={sensitiveSet.ssn ? '•••••••••  (on file — leave blank to keep)' : '000-00-0000'} autoComplete="off" />
      </Field>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>🔒 Your SSN is encrypted and visible only to payroll. Leave blank to keep what's already on file.</div>
    </div>
  );
}

function DirectDeposit({ get, setField, sensitive, setSensitive, sensitiveSet }) {
  const optOut = !!get('direct_deposit.opt_out');
  return (
    <div>
      <H sub="Direct deposit is voluntary in California — you may choose a paper check instead.">Direct Deposit</H>
      <Check checked={optOut} onChange={(v) => setField('direct_deposit.opt_out', v)}>I'd prefer a paper check (skip direct deposit)</Check>
      {!optOut && (
        <>
          <Field label="Bank name"><Text value={get('direct_deposit.bank_name')} onChange={(v) => setField('direct_deposit.bank_name', v)} /></Field>
          <Field label="Account type">
            <select style={S.input} value={get('direct_deposit.account_type') || ''} onChange={(e) => setField('direct_deposit.account_type', e.target.value)}>
              <option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Routing number"><Text value={sensitive.bank_routing} onChange={(v) => setSensitive((s) => ({ ...s, bank_routing: v }))} placeholder={sensitiveSet.bank_routing ? '•••• (on file)' : '9 digits'} autoComplete="off" /></Field>
          <Field label="Account number"><Text value={sensitive.bank_account} onChange={(v) => setSensitive((s) => ({ ...s, bank_account: v }))} placeholder={sensitiveSet.bank_account ? '•••• (on file)' : ''} autoComplete="off" /></Field>
          <Field label="Deposit">
            <select style={S.input} value={get('direct_deposit.deposit_type') || 'entire'} onChange={(e) => setField('direct_deposit.deposit_type', e.target.value)}>
              <option value="entire">Entire net pay</option><option value="partial">A set amount</option>
            </select>
          </Field>
          {get('direct_deposit.deposit_type') === 'partial' && <Field label="Amount per pay period ($)"><Text value={get('direct_deposit.amount')} onChange={(v) => setField('direct_deposit.amount', v)} /></Field>}
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>🔒 Routing &amp; account numbers are encrypted and visible only to payroll.</div>
        </>
      )}
    </div>
  );
}

function Emergency({ get, setField }) {
  const grp = (prefix, title, full) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 4 }}>{title}</div>
      <Field label="Name"><Text value={get(prefix + '.name')} onChange={(v) => setField(prefix + '.name', v)} /></Field>
      <div className="onb-row">
        <div style={{ flex: 1 }}><Field label="Relationship"><Text value={get(prefix + '.relationship')} onChange={(v) => setField(prefix + '.relationship', v)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Phone"><Text type="tel" value={get(prefix + '.phone')} onChange={(v) => setField(prefix + '.phone', v)} /></Field></div>
      </div>
      {full && <Field label="Address"><Text value={get(prefix + '.address')} onChange={(v) => setField(prefix + '.address', v)} /></Field>}
    </div>
  );
  return (
    <div>
      <H sub="Who should we contact in an emergency?">Emergency Contacts</H>
      <Field label="Medical notes or restrictions emergency personnel should know (optional)"><Text value={get('emergency.medical_notes')} onChange={(v) => setField('emergency.medical_notes', v)} /></Field>
      {grp('emergency.primary', 'Primary contact', true)}
      {grp('emergency.secondary', 'Secondary contact', false)}
      {grp('emergency.physician', 'Physician (optional)', false)}
    </div>
  );
}

function Tax({ invite, get, setField, sensitive, setSensitive, sensitiveSet, signatures, setSig }) {
  const is1099 = invite && invite.employment_type === 'contractor_1099';
  if (is1099) {
    const cls = get('tax.w9.classification') || '';
    const tinType = get('tax.w9.tin_type') || 'ssn';
    return (
      <div>
        <H sub="As an independent contractor, we need a Form W-9 (not a W-4). This gives us your taxpayer ID for year-end 1099 reporting.">Taxpayer Information — Form W-9</H>
        <Field label="Federal tax classification">
          <select style={S.input} value={cls} onChange={(e) => setField('tax.w9.classification', e.target.value)}>
            <option value="">Select…</option>{W9_CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        {/LLC/i.test(cls) && (
          <Field label="LLC tax classification">
            <select style={S.input} value={get('tax.w9.llc_tax') || ''} onChange={(e) => setField('tax.w9.llc_tax', e.target.value)}>
              <option value="">Select…</option>{W9_LLC_TAX.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        <Field label="Business / disregarded-entity name (if different from your name)"><Text value={get('tax.w9.business_name')} onChange={(v) => setField('tax.w9.business_name', v)} /></Field>
        <Field label="Taxpayer ID number (TIN) type">
          <select style={S.input} value={tinType} onChange={(e) => setField('tax.w9.tin_type', e.target.value)}>
            <option value="ssn">SSN (the one I entered earlier)</option>
            <option value="ein">EIN (business tax ID)</option>
          </select>
        </Field>
        {tinType === 'ein' && (
          <Field label="Employer Identification Number (EIN)">
            <Text value={sensitive.ein} onChange={(v) => setSensitive((s) => ({ ...s, ein: v }))} placeholder={sensitiveSet.ein ? '•• (on file)' : '00-0000000'} autoComplete="off" />
          </Field>
        )}
        <div className="onb-row">
          <div style={{ flex: 1 }}><Field label="Exempt payee code (optional)"><Text value={get('tax.w9.exempt_payee_code')} onChange={(v) => setField('tax.w9.exempt_payee_code', v)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="FATCA exemption code (optional)"><Text value={get('tax.w9.fatca_code')} onChange={(v) => setField('tax.w9.fatca_code', v)} /></Field></div>
        </div>
        <Check checked={get('tax.w9.backup_withholding')} onChange={(v) => setField('tax.w9.backup_withholding', v)}>I have been notified by the IRS that I am currently subject to backup withholding</Check>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>🔒 Your SSN/EIN is encrypted and visible only to payroll/accounting.</div>
        <SignBlock value={signatures.tax_form} statement={W9_CERTIFICATION} onChange={setSig} />
      </div>
    );
  }
  return (
    <div>
      <H sub="Your federal (W-4) and California (DE 4) withholding elections. If unsure, the defaults withhold at the standard rate — you can update these later with payroll.">Tax Withholding</H>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, margin: '12px 0 0' }}>Federal — Form W-4</div>
      <Field label="Filing status">
        <select style={S.input} value={get('tax.federal.filing_status') || ''} onChange={(e) => setField('tax.federal.filing_status', e.target.value)}>
          <option value="">Select…</option>{FILING_STATUSES.map((f) => <option key={f}>{f}</option>)}
        </select>
      </Field>
      <Check checked={get('tax.federal.multiple_jobs')} onChange={(v) => setField('tax.federal.multiple_jobs', v)}>I have more than one job, or my spouse also works (Step 2)</Check>
      <div className="onb-row">
        <div style={{ flex: 1 }}><Field label="Dependents amount ($)"><Text value={get('tax.federal.dependents_amount')} onChange={(v) => setField('tax.federal.dependents_amount', v)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Extra withholding ($)"><Text value={get('tax.federal.extra_withholding')} onChange={(v) => setField('tax.federal.extra_withholding', v)} /></Field></div>
      </div>
      <Check checked={get('tax.federal.exempt')} onChange={(v) => setField('tax.federal.exempt', v)}>I claim exemption from federal withholding</Check>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, margin: '14px 0 0' }}>California — Form DE 4</div>
      <div className="onb-row">
        <div style={{ flex: 2 }}><Field label="Filing status">
          <select style={S.input} value={get('tax.ca_de4.filing_status') || ''} onChange={(e) => setField('tax.ca_de4.filing_status', e.target.value)}>
            <option value="">Select…</option><option>Single or Married (with two or more incomes)</option><option>Married (one income)</option><option>Head of Household</option>
          </select></Field></div>
        <div style={{ flex: 1 }}><Field label="Allowances"><Text value={get('tax.ca_de4.allowances')} onChange={(v) => setField('tax.ca_de4.allowances', v)} /></Field></div>
      </div>
      <Field label="Additional CA amount to withhold ($)"><Text value={get('tax.ca_de4.extra')} onChange={(v) => setField('tax.ca_de4.extra', v)} /></Field>
      <Check checked={get('tax.ca_de4.exempt')} onChange={(v) => setField('tax.ca_de4.exempt', v)}>I claim exemption from California withholding</Check>
      <SignBlock value={signatures.tax_form} statement="Under penalties of perjury, I declare these withholding elections are true and correct." onChange={setSig} />
    </div>
  );
}

function Documents({ documents, onUpload, onDelete }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const pick = async (kind, file) => {
    setErr(''); if (!file) return;
    setBusy(kind);
    const j = await onUpload(kind, file);
    setBusy('');
    if (!j.ok) setErr(j.error || 'Upload failed');
  };
  const fmtKb = (b) => b ? (b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB') : '';
  return (
    <div>
      <H sub="Upload anything we asked you to provide. Photos or PDFs work great. (Optional — you can skip and send these later.)">Documents</H>
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#1e3a5f', lineHeight: 1.6, margin: '12px 0 18px' }}>
        <strong>📋 About your I-9:</strong> {I9_NOTICE}
      </div>
      {DOCUMENT_TYPES.map((t) => {
        const mine = documents.filter((d) => d.kind === t.key);
        return (
          <div key={t.key} style={{ borderBottom: '1px solid ' + C.line, padding: '10px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{t.label}</div>
                {t.hint && <div style={{ fontSize: 12, color: C.muted }}>{t.hint}</div>}
              </div>
              <label style={{ ...S.btnGhost, cursor: 'pointer', fontSize: 13, padding: '8px 14px', whiteSpace: 'nowrap', opacity: busy === t.key ? 0.6 : 1 }}>
                {busy === t.key ? 'Uploading…' : '+ Upload'}
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={!!busy}
                  onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pick(t.key, f); }} />
              </label>
            </div>
            {mine.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.goodBg, border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', marginTop: 6, fontSize: 12.5 }}>
                <span style={{ color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✓ {d.filename} <span style={{ color: '#16a34a' }}>{fmtKb(d.size_bytes)}</span></span>
                <button onClick={() => onDelete(d.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, marginLeft: 8 }}>Remove</button>
              </div>
            ))}
          </div>
        );
      })}
      {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 12 }}>🔒 Files are stored securely and visible only to HR. Max {MAX_UPLOAD_MB} MB each.</div>
    </div>
  );
}

function Commission({ invite, get, setField, signatures, setSig, acks, setAck }) {
  return (
    <div>
      <H sub="California Labor Code § 2751 requires a signed written commission agreement.">Commission Agreement</H>
      <div style={{ background: '#f8fafc', border: '1px solid ' + C.line, borderRadius: 10, padding: 16, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
        <div><strong>Your compensation:</strong> {formatPayComponents(invite?.pay_components) || invite?.pay_rate || '—'}</div>
        <Field label="Commission is calculated on"><Text value={get('commission.basis') || _commissionBasis(invite)} onChange={(v) => setField('commission.basis', v)} placeholder="e.g. 30% of gross profit on your sales" /></Field>
        <Field label="Additional commission terms (as discussed with your supervisor)"><Text value={get('commission.terms')} onChange={(v) => setField('commission.terms', v)} placeholder="Draw recovery, payment timing, chargebacks, etc." /></Field>
      </div>
      <Check checked={!!acks.commission_agreement} onChange={(v) => setAck(v ? { at: nowISO() } : undefined)}>
        I have received, read, and agree to the commission terms above, and understand how my commissions are calculated and paid.
      </Check>
      <SignBlock value={signatures.commission_agreement} onChange={setSig} />
    </div>
  );
}

function Handbook({ readSections, setRead, onView, acks, setAck, signatures, setSig, totalHb }) {
  return (
    <div>
      <H sub={`Please open and read each section. We record which sections you've reviewed. You'll be able to acknowledge once all ${totalHb} sections are read.`}>Employee Handbook ({HANDBOOK.version})</H>
      <div style={{ fontSize: 12, color: readSections.size >= totalHb ? C.good : C.muted, fontWeight: 600, margin: '6px 0 12px' }}>
        {readSections.size} of {totalHb} sections read {readSections.size >= totalHb ? '✓' : ''}
      </div>
      {HANDBOOK.sections.map((sec) => (
        <div key={sec.id} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.ink, margin: '6px 0' }}>{sec.num}. {sec.title}</div>
          {sec.subsections.map((ss) => (
            <HandbookSection key={ss.id} ss={ss} read={readSections.has(ss.id)} onRead={() => setRead(ss.id)} onView={() => onView(ss.id)} />
          ))}
        </div>
      ))}
      <div style={{ marginTop: 10, borderTop: '1px solid ' + C.line, paddingTop: 14 }}>
        <Check checked={!!acks['handbook:all']} onChange={(v) => readSections.size >= totalHb && setAck(v)}>
          {AT_WILL_STATEMENT}
        </Check>
        {readSections.size < totalHb && <div style={{ fontSize: 11.5, color: C.bad, marginTop: 4 }}>Open and read all sections above to enable this acknowledgment.</div>}
        <SignBlock value={signatures.handbook} onChange={setSig} />
      </div>
    </div>
  );
}

function HandbookSection({ ss, read, onRead, onView }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef(null);
  const toggle = () => { const n = !open; setOpen(n); if (n) onView(); };
  const onScroll = () => {
    const el = bodyRef.current; if (!el || read) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) onRead();
  };
  // Short sections that don't scroll: mark read shortly after opening.
  useEffect(() => {
    if (!open || read) return;
    const el = bodyRef.current; if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 24) { const t = setTimeout(onRead, 1200); return () => clearTimeout(t); }
  }, [open]); // eslint-disable-line
  return (
    <div style={{ border: '1px solid ' + (read ? '#bbf7d0' : C.line), borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
      <div onClick={toggle} style={{ cursor: 'pointer', padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: read ? C.goodBg : '#fff' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{ss.num} {ss.title}</span>
        <span style={{ fontSize: 12, color: read ? C.good : C.muted }}>{read ? '✓ Read' : open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div ref={bodyRef} onScroll={onScroll} className="onb-acc-body" style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 14px 12px', fontSize: 13, color: '#334155', lineHeight: 1.6, borderTop: '1px solid ' + C.line }}
          dangerouslySetInnerHTML={{ __html: ss.html }} />
      )}
    </div>
  );
}

function CaNotices({ acks, setAck, onView, signatures, setSig }) {
  return (
    <div>
      <H sub="California requires that we provide these notices at hire. Open each, then acknowledge you received it.">California Required Notices</H>
      {CA_NOTICES.map((n) => <CaNotice key={n.key} n={n} acked={!!acks[n.key]} onAck={(v) => setAck(n.key, v)} onView={() => onView(n.key)} />)}
      <div style={{ marginTop: 12, borderTop: '1px solid ' + C.line, paddingTop: 12 }}>
        <SignBlock value={signatures.ca_notices} statement="By signing, I acknowledge I received and reviewed each of the California notices above." onChange={setSig} />
      </div>
    </div>
  );
}
function CaNotice({ n, acked, onAck, onView }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid ' + (acked ? '#bbf7d0' : C.line), borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => { const o = !open; setOpen(o); if (o) onView(); }} style={{ cursor: 'pointer', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', background: acked ? C.goodBg : '#fff' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{n.title}</span><span style={{ color: C.muted }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="onb-acc-body" style={{ padding: '4px 14px 10px', fontSize: 13, color: '#334155', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: n.body }} />}
      <div style={{ padding: '0 12px 8px' }}><Check checked={acked} onChange={onAck}>I received and reviewed this notice</Check></div>
    </div>
  );
}

function Review({ invite, data, acks, signatures, sensitiveSet, steps, totalHb, readCount }) {
  const row = (label, ok) => (<div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid ' + C.line, fontSize: 13.5 }}><span style={{ color: '#334155' }}>{label}</span><span style={{ color: ok ? C.good : C.bad, fontWeight: 600 }}>{ok ? '✓' : 'Incomplete'}</span></div>);
  return (
    <div>
      <H sub="Please confirm everything looks right, then submit. We'll store your packet securely.">Review &amp; Submit</H>
      {row('Personal information', !!(data.personal && data.personal.full_name))}
      {row('Direct deposit', !!(data.direct_deposit && (data.direct_deposit.opt_out || data.direct_deposit.bank_name)))}
      {row('Emergency contact', !!(data.emergency && data.emergency.primary && data.emergency.primary.name))}
      {row('Tax withholding', !!(data.tax && data.tax.federal))}
      {invite?.commission_eligible && row('Commission agreement signed', !!(signatures.commission_agreement && signatures.commission_agreement.name))}
      {row(`Handbook read (${readCount}/${totalHb}) & acknowledged`, !!acks['handbook:all'] && readCount >= totalHb && !!(signatures.handbook && signatures.handbook.name))}
      {row('California notices acknowledged', CA_NOTICES.every((n) => acks[n.key]) && !!(signatures.ca_notices && signatures.ca_notices.name))}
      <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
        By submitting, you confirm the information you provided is true and complete to the best of your knowledge.
      </div>
    </div>
  );
}
