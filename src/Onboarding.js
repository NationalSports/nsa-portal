/* eslint-disable */
// Staff-facing onboarding admin (portal page id: 'onboarding'). Admins invite a
// new hire (role, name, personal email, future NSA email + position details),
// track their progress and review-audit trail, and download the completed
// packet as a ZIP. All calls hit the onboarding-admin function with the current
// user's Supabase JWT (admin-gated server-side).
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { ONBOARDING_ROLES, EMPLOYMENT_TYPES, PAY_TYPES } from './onboardingForms';

const FN = '/.netlify/functions/onboarding-admin';

const STATUS = {
  invited: { label: 'Invited', bg: '#fef3c7', color: '#b45309' },
  in_progress: { label: 'In progress', bg: '#dbeafe', color: '#1e40af' },
  completed: { label: 'Completed', bg: '#dcfce7', color: '#166534' },
  void: { label: 'Canceled', bg: '#f1f5f9', color: '#64748b' },
};

async function authToken() {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ''; } catch { return ''; }
}
async function call(action, payload = {}) {
  const token = await authToken();
  const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ action, ...payload }) });
  return r.json();
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', margin: '0 0 4px' };
const inp = { width: '100%', padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13.5, boxSizing: 'border-box', outline: 'none' };

export default function OnboardingAdmin({ cu }) {
  const [invites, setInvites] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    const j = await call('list');
    if (j.ok) setInvites(j.invites); else { setInvites([]); flash(j.error || 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const completed = (invites || []).filter((i) => i.status === 'completed').length;
  const pending = (invites || []).filter((i) => i.status === 'invited' || i.status === 'in_progress').length;

  return (
    <div>
      {toast && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 90, background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>{toast}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>New-Hire Onboarding</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Invite a new hire and they'll complete their entire packet online — forms, handbook, and California notices.</div>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <Stat n={pending} label="In progress" />
            <Stat n={completed} label="Completed" />
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Invite a hire</button>
          </div>
        </div>
      </div>

      {invites === null ? <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        : invites.length === 0 ? (
          <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📨</div>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>No invites yet</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Send your first new-hire onboarding invite to get started.</div>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Invite a hire</button>
          </div></div>
        ) : (
          <div className="card"><div className="card-body" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: .4 }}>
                <th style={{ padding: '12px 16px' }}>Name</th><th>Role</th><th>Status</th><th>Progress</th><th>Last activity</th><th></th>
              </tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{i.full_name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{i.personal_email}</div>
                    </td>
                    <td style={{ color: '#475569' }}>{(ONBOARDING_ROLES.find((r) => r.key === i.role) || {}).label || i.role || '—'}</td>
                    <td><Chip s={i.status} /></td>
                    <td style={{ color: '#475569' }}>{i.submitted ? 'Submitted' : `${i.steps_done} step${i.steps_done === 1 ? '' : 's'}`}</td>
                    <td style={{ color: '#94a3b8', fontSize: 12.5 }}>{i.last_activity ? new Date(i.last_activity).toLocaleDateString() : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-light" style={{ marginRight: 6 }} onClick={() => setDetail(i.id)}>View</button>
                      {i.status === 'completed' && <DownloadBtn id={i.id} name={i.full_name} flash={flash} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}

      {showNew && <NewInvite cu={cu} onClose={() => setShowNew(false)} onCreated={(msg) => { setShowNew(false); flash(msg); load(); }} />}
      {detail && <DetailModal id={detail} onClose={() => setDetail(null)} flash={flash} onChanged={load} />}
    </div>
  );
}

function Stat({ n, label }) {
  return <div style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{n}</div><div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div></div>;
}
function Chip({ s }) {
  const m = STATUS[s] || STATUS.invited;
  return <span style={{ background: m.bg, color: m.color, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>{m.label}</span>;
}

function DownloadBtn({ id, name, flash }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const j = await call('generate_zip', { id });
    setBusy(false);
    if (!j.ok) { flash(j.error || 'Could not build packet'); return; }
    try {
      const bin = atob(j.zip_base64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: 'application/zip' }));
      const a = document.createElement('a'); a.href = url; a.download = j.filename || (name + '_packet.zip'); a.click();
      URL.revokeObjectURL(url);
    } catch { flash('Download failed'); }
  };
  return <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Building…' : '⬇ Packet'}</button>;
}

function NewInvite({ cu, onClose, onCreated }) {
  const [f, setF] = useState({ full_name: '', personal_email: '', nsa_email: '', role: '', position_title: '', supervisor: cu?.name || '', hire_date: '', employment_type: 'w2_employee', pay_type: 'hourly', pay_rate: '', commission_eligible: false, work_state: 'CA' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    setErr('');
    if (!f.full_name.trim()) return setErr('Enter the hire\'s full name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.personal_email)) return setErr('Enter a valid personal email.');
    setBusy(true);
    const j = await call('create_invite', { ...f, created_by_name: cu?.name || '' });
    setBusy(false);
    if (!j.ok) return setErr(j.error || 'Could not create invite.');
    onCreated(j.emailed ? `Invite emailed to ${f.personal_email}` : `Invite created — email not sent (${j.emailError || 'email off'}). Copy the link from View.`);
  };
  return (
    <Modal title="Invite a new hire" onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label style={lbl}>Full legal name *</label><input style={inp} value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></div>
        <div><label style={lbl}>Role</label>
          <select style={inp} value={f.role} onChange={(e) => set('role', e.target.value)}><option value="">Select…</option>{ONBOARDING_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        </div>
        <div><label style={lbl}>Personal email *</label><input style={inp} value={f.personal_email} onChange={(e) => set('personal_email', e.target.value)} placeholder="Where we send the invite" /></div>
        <div><label style={lbl}>Future NSA email (optional)</label><input style={inp} value={f.nsa_email} onChange={(e) => set('nsa_email', e.target.value)} placeholder="name@nationalsportsapparel.com" /></div>
        <div><label style={lbl}>Position title</label><input style={inp} value={f.position_title} onChange={(e) => set('position_title', e.target.value)} /></div>
        <div><label style={lbl}>Supervisor</label><input style={inp} value={f.supervisor} onChange={(e) => set('supervisor', e.target.value)} /></div>
        <div><label style={lbl}>Hire / start date</label><input style={inp} type="date" value={f.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></div>
        <div><label style={lbl}>Employment type</label>
          <select style={inp} value={f.employment_type} onChange={(e) => set('employment_type', e.target.value)}>{EMPLOYMENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        </div>
        <div><label style={lbl}>Pay type</label>
          <select style={inp} value={f.pay_type} onChange={(e) => set('pay_type', e.target.value)}>{PAY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        </div>
        <div><label style={lbl}>Pay rate</label><input style={inp} value={f.pay_rate} onChange={(e) => set('pay_rate', e.target.value)} placeholder="e.g. $20.00/hr or $1,500/mo draw" /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0 0', fontSize: 13.5, color: '#334155' }}>
        <input type="checkbox" checked={f.commission_eligible} onChange={(e) => set('commission_eligible', e.target.checked)} />
        Commission-eligible (adds a California-required written commission agreement to their packet)
      </label>
      {f.employment_type === 'contractor_1099' && (
        <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#92400e', lineHeight: 1.5 }}>
          ⚠️ Heads up: under California's AB 5 / ABC test, sales staff representing NSA are usually <strong>W-2 employees</strong>, not 1099 contractors. Confirm classification with counsel before issuing a 1099 onboarding packet.
        </div>
      )}
      {err && <div style={{ marginTop: 12, color: '#dc2626', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button className="btn btn-light" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Create & email invite'}</button>
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose, flash, onChanged }) {
  const [d, setD] = useState(null);
  useEffect(() => { (async () => { const j = await call('detail', { id }); if (j.ok) setD(j); else { flash(j.error || 'Failed'); onClose(); } })(); }, [id]); // eslint-disable-line
  if (!d) return <Modal title="Loading…" onClose={onClose}><div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading…</div></Modal>;
  const inv = d.invite, sub = d.submission, events = d.events || [];
  const acks = (sub && sub.acknowledgments) || {};
  const sigs = (sub && sub.signatures) || {};
  const hbRead = Object.keys(acks).filter((k) => k.startsWith('handbook:') && k !== 'handbook:all').length;
  const copyLink = () => { try { navigator.clipboard.writeText(d.link); flash('Invite link copied'); } catch { flash(d.link); } };
  const resend = async () => { const j = await call('resend', { id }); flash(j.emailed ? 'Invite re-sent' : (j.error || 'Resend failed')); };
  const voidIt = async () => { if (!window.confirm('Cancel this invite? Their link will stop working.')) return; const j = await call('void', { id }); if (j.ok) { flash('Invite canceled'); onChanged(); onClose(); } };

  const evLabel = { start: 'Opened the packet', step_view: 'Viewed step', section_view: 'Opened section', scroll_complete: 'Read to end', acknowledge: 'Acknowledged', sign: 'Signed', save: 'Saved progress', submit: 'Submitted packet', download: 'Packet downloaded' };

  return (
    <Modal title={inv.full_name} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Chip s={inv.status} />
        <button className="btn btn-light" onClick={copyLink}>🔗 Copy link</button>
        <button className="btn btn-light" onClick={resend}>✉ Resend email</button>
        {inv.status !== 'void' && inv.status !== 'completed' && <button className="btn btn-light" onClick={voidIt} style={{ color: '#dc2626' }}>Cancel invite</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <Sec title="Hire">
            <KV k="Role" v={(ONBOARDING_ROLES.find((r) => r.key === inv.role) || {}).label || inv.role} />
            <KV k="Position" v={inv.position_title} /><KV k="Supervisor" v={inv.supervisor} />
            <KV k="Personal email" v={inv.personal_email} /><KV k="NSA email" v={inv.nsa_email} />
            <KV k="Invited" v={inv.invited_at && new Date(inv.invited_at).toLocaleString()} />
            <KV k="Completed" v={inv.completed_at ? new Date(inv.completed_at).toLocaleString() : 'Not yet'} />
          </Sec>
          <Sec title="Completion">
            <KV k="Personal info" v={sub && sub.data && sub.data.personal ? '✓' : '—'} />
            <KV k="Direct deposit" v={sub && sub.data && sub.data.direct_deposit ? '✓' : '—'} />
            <KV k="Emergency contact" v={sub && sub.data && sub.data.emergency ? '✓' : '—'} />
            <KV k="Tax forms" v={sub && sub.data && sub.data.tax ? '✓' : '—'} />
            {inv.commission_eligible && <KV k="Commission agreement" v={sigs.commission_agreement ? '✓ signed' : '—'} />}
            <KV k="Handbook read" v={`${hbRead} sections${acks['handbook:all'] ? ' · acknowledged ✓' : ''}`} />
            <KV k="CA notices" v={sigs.ca_notices ? '✓ acknowledged' : '—'} />
          </Sec>
        </div>
        <div>
          <Sec title={`Review audit trail (${events.length})`}>
            <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 12.5 }}>
              {events.length === 0 ? <div style={{ color: '#94a3b8' }}>No activity yet.</div> : events.slice().reverse().map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ color: '#334155' }}>{evLabel[e.kind] || e.kind}{e.ref ? <span style={{ color: '#94a3b8' }}> · {String(e.ref).replace('handbook:', '')}</span> : ''}</span>
                  <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </Sec>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        {inv.status === 'completed' && <DownloadBtn id={id} name={inv.full_name} flash={flash} />}
      </div>
    </Modal>
  );
}

function Sec({ title, children }) {
  return <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{title}</div>{children}</div>;
}
function KV({ k, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 13 }}><span style={{ color: '#64748b' }}>{k}</span><span style={{ color: '#0f172a', fontWeight: 500, textAlign: 'right' }}>{v || '—'}</span></div>;
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: wide ? 720 : 480, boxShadow: '0 24px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
