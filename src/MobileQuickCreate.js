// The phone's "+" button: a floating menu to start an estimate, a note (AI or typed), a
// reminder, or a pay link. Each option hands off to a flow the portal already has — the
// estimate builder, AI Notes, the to-do list (assigned_todos, so a reminder shows in the
// phone's Today card and on desktop), the customer record's notes, and the Get paid sheet.
import React, { useEffect, useMemo, useRef, useState } from 'react';

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
// Local calendar date (not UTC), so "Today" after 5 PM Pacific is still today.
export const localYmd = (d) => { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localYmd(d); };
const nextMonday = () => { const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); return localYmd(d); };
export const invBalance = (i) => (i.status === 'paid' ? 0 : Math.max(0, (+i.total || 0) - (+i.paid || 0)));
const DEAD_INV = ['cancelled', 'void', 'deleted', 'paid'];
const DONE_SO = ['cancelled', 'completed', 'complete', 'closed'];

const sheetBg = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-end' };
const sheet = { background: '#f8fafc', width: '100%', maxHeight: '92vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', padding: '10px 16px', paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' };
const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, marginBottom: 12 };
const input = { width: '100%', padding: '13px 14px', borderRadius: 12, border: '1.5px solid #cbd5e1', fontSize: 16, boxSizing: 'border-box', background: 'white', color: '#0f172a', fontFamily: 'inherit' };
const primary = (on) => ({ width: '100%', padding: '15px', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 16, background: on ? '#1e40af' : '#cbd5e1', color: 'white', cursor: on ? 'pointer' : 'default' });
const chip = (on) => ({ padding: '9px 13px', borderRadius: 999, border: on ? '1.5px solid #1e40af' : '1.5px solid #e2e8f0', background: on ? '#eff6ff' : 'white', color: on ? '#1e40af' : '#334155', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' });
const label = { fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', margin: '4px 2px 8px' };

function SheetHead({ title, onBack, onClose }) {
  return <><div style={{ width: 40, height: 5, borderRadius: 3, background: '#cbd5e1', margin: '0 auto 10px' }} /><div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
    {onBack ? <button aria-label="Back" onClick={onBack} style={{ border: 'none', background: '#e2e8f0', width: 36, height: 36, borderRadius: 10, fontSize: 18, color: '#334155', cursor: 'pointer' }}>‹</button> : null}
    <div style={{ flex: 1, fontSize: 19, fontWeight: 900, color: '#0f172a' }}>{title}</div>
    <button aria-label="Close" onClick={onClose} style={{ border: 'none', background: '#e2e8f0', width: 36, height: 36, borderRadius: 10, fontSize: 16, color: '#334155', cursor: 'pointer' }}>✕</button>
  </div></>;
}

// Search-as-you-type account picker. `suggested` shows while the box is empty.
function CustomerPick({ cust, value, onPick, suggested, sub, placeholder, autoFocus }) {
  const [q, setQ] = useState('');
  const picked = value ? cust.find((c) => c.id === value) : null;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const live = cust.filter((c) => c && c.is_active !== false);
    if (!s) return (suggested || []).slice(0, 6);
    return live.filter((c) => ((c.name || '') + ' ' + (c.alpha_tag || '')).toLowerCase().includes(s)).slice(0, 8);
  }, [q, cust, suggested]);
  if (picked) return <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, border: '1.5px solid #1e40af' }}>
    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>{(picked.alpha_tag || picked.name || '?').slice(0, 2).toUpperCase()}</div>
    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{picked.name}</div>{sub && sub(picked) ? <div style={{ fontSize: 12, color: '#64748b' }}>{sub(picked)}</div> : null}</div>
    <button onClick={() => { onPick(null); setQ(''); }} style={{ border: 'none', background: 'none', color: '#1e40af', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Change</button>
  </div>;
  return <div style={{ marginBottom: 12 }}>
    <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || 'Search accounts…'} style={input} />
    {rows.length > 0 && <div style={{ ...card, padding: 0, marginTop: 8, overflow: 'hidden' }}>
      {!q.trim() && suggested?.length ? <div style={{ ...label, margin: '10px 14px 2px' }}>Suggested</div> : null}
      {rows.map((c) => <button key={c.id} onClick={() => onPick(c.id)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '12px 14px', border: 'none', borderTop: '1px solid #f1f5f9', background: 'white', textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
          {sub && sub(c) ? <div style={{ fontSize: 12, color: '#64748b' }}>{sub(c)}</div> : c.alpha_tag ? <div style={{ fontSize: 12, color: '#94a3b8' }}>{c.alpha_tag}</div> : null}</div>
        <span style={{ color: '#cbd5e1', fontSize: 18 }}>›</span>
      </button>)}
    </div>}
    {q.trim() && !rows.length ? <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 4px' }}>No account matches “{q.trim()}”.</div> : null}
  </div>;
}

export default function MobileQuickCreate({ open, onClose, cu, cust = [], sos = [], invs = [], canNotes, onNewEstimate, onOpenNotes, onAddTodo, onSaveCustomer, onOpenPayLink, nf }) {
  const [view, setView] = useState('menu');
  const [note, setNote] = useState({ customerId: null, text: '', saving: false });
  const [rem, setRem] = useState({ title: '', date: plusDays(1), pick: false, customerId: null, soId: null, high: false });
  const [pay, setPay] = useState({ customerId: null, tab: 'inv', openSo: null });
  const textRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setView('menu');
    setNote({ customerId: null, text: '', saving: false });
    setRem({ title: '', date: plusDays(1), pick: false, customerId: null, soId: null, high: false });
    setPay({ customerId: null, tab: 'inv', openSo: null });
  }, [open]);

  const mine = useMemo(() => cust.filter((c) => c && c.is_active !== false && c.primary_rep_id === cu?.id && !c.parent_id), [cust, cu]);
  const familyIds = (id) => new Set([id, ...cust.filter((c) => c.parent_id === id).map((c) => c.id)]);
  const openInvs = useMemo(() => invs.filter((i) => !i._hist && !DEAD_INV.includes(i.status) && invBalance(i) > 0.005), [invs]);
  const dueByCust = useMemo(() => {
    const m = {};
    const top = (id) => { const c = cust.find((x) => x.id === id); return c?.parent_id || id; };
    openInvs.forEach((i) => { const k = top(i.customer_id); m[k] = m[k] || { due: 0, n: 0 }; m[k].due += invBalance(i); m[k].n += 1; });
    return m;
  }, [openInvs, cust]);

  if (!open) return null;
  const close = () => onClose && onClose();
  const go = (fn) => { close(); fn && fn(); };

  // ── Menu ──
  if (view === 'menu') {
    const tiles = [
      { k: 'est', icon: '📄', title: 'Estimate', sub: 'Quote with live vendor stock', bg: '#dbeafe', on: () => go(onNewEstimate) },
      { k: 'note', icon: '📝', title: 'Note', sub: 'AI or typed, on an account', bg: '#fee2e2', on: () => setView('note') },
      { k: 'rem', icon: '⏰', title: 'Reminder', sub: 'A to-do with a date', bg: '#fef3c7', on: () => setView('reminder') },
      { k: 'pay', icon: '💳', title: 'Invoice link', sub: 'Full or part payment', bg: '#dcfce7', on: () => setView('pay') },
    ].filter((t) => (t.k === 'est' ? !!onNewEstimate : t.k === 'rem' ? !!onAddTodo : t.k === 'note' ? (canNotes || !!onSaveCustomer) : !!onOpenPayLink && canNotes));
    return <div className="qc-backdrop" onClick={close} role="dialog" aria-modal="true" aria-label="Create new">
      <div className="qc-menu" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#64748b', letterSpacing: '.04em', textTransform: 'uppercase', margin: '2px 4px 12px' }}>Create new</div>
        <div className="qc-grid">
          {tiles.map((t, i) => <button key={t.k} className="qc-tile" style={{ animationDelay: (40 + i * 35) + 'ms' }} onClick={t.on}>
            <span className="qc-ico" style={{ background: t.bg }}>{t.icon}</span>
            <span style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>{t.title}</span>
            <span style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.3 }}>{t.sub}</span>
          </button>)}
        </div>
      </div>
      <button className="qc-close" aria-label="Close" onClick={close}>✕</button>
    </div>;
  }

  // ── Note: AI or typed ──
  if (view === 'note') {
    const ai = [['dictated', '🎙️', 'Voice memo'], ['recorded', '👥', 'Record meeting'], ['upload', '⬆️', 'Upload recording'], ['pasted', '📋', 'Paste text']];
    return <div style={sheetBg} onClick={close}><div style={sheet} onClick={(e) => e.stopPropagation()}>
      <SheetHead title="New note" onBack={() => setView('menu')} onClose={close} />
      {canNotes && <div style={{ borderRadius: 16, padding: 16, marginBottom: 12, color: 'white', background: 'linear-gradient(135deg,#dc2626 0%,#7c3aed 100%)', boxShadow: '0 8px 22px rgba(124,58,237,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 22 }}>✨</span><span style={{ fontSize: 18, fontWeight: 900 }}>AI note</span></div>
        <div style={{ fontSize: 13.5, opacity: 0.92, margin: '4px 0 12px', lineHeight: 1.35 }}>Talk, record or paste. AI writes the summary, to-dos, new contacts and a follow-up email. You approve before anything saves.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {ai.map(([mode, icon, t]) => <button key={mode} onClick={() => go(() => onOpenNotes && onOpenNotes({ mode }))} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.16)', color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}><span style={{ fontSize: 18 }}>{icon}</span>{t}</button>)}
        </div>
      </div>}
      <button onClick={() => setView('note-type')} style={{ ...card, width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✏️</span>
        <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 17, fontWeight: 900, color: '#0f172a' }}>Quick note</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>Type it yourself. Saved to the account right away.</span></span>
        <span style={{ color: '#cbd5e1', fontSize: 20 }}>›</span>
      </button>
    </div></div>;
  }

  if (view === 'note-type') {
    const ok = note.customerId && note.text.trim() && !note.saving;
    const save = async () => {
      const c = cust.find((x) => x.id === note.customerId);
      if (!c || !note.text.trim() || !onSaveCustomer) return;
      setNote((n) => ({ ...n, saving: true }));
      // Same stamped line the Portal Assistant writes, so the account's notes read one way.
      const line = new Date().toLocaleDateString() + ' — ' + note.text.trim() + ' (' + (cu?.name || 'staff') + ')';
      const prev = String(c.notes || '').trim();
      try {
        await onSaveCustomer({ ...c, notes: prev ? prev + '\n' + line : line, updated_at: new Date().toISOString() });
        nf && nf('Note saved to ' + (c.name || 'the account'));
        close();
      } catch (e) { nf && nf('Could not save the note: ' + (e.message || e), 'error'); setNote((n) => ({ ...n, saving: false })); }
    };
    return <div style={sheetBg} onClick={close}><div style={sheet} onClick={(e) => e.stopPropagation()}>
      <SheetHead title="Quick note" onBack={() => setView('note')} onClose={close} />
      <div style={label}>Account</div>
      <CustomerPick cust={cust} value={note.customerId} suggested={mine} autoFocus onPick={(id) => { setNote((n) => ({ ...n, customerId: id })); if (id) setTimeout(() => textRef.current && textRef.current.focus(), 50); }} />
      <div style={label}>Note</div>
      <textarea ref={textRef} value={note.text} onChange={(e) => setNote((n) => ({ ...n, text: e.target.value }))} rows={5} placeholder="e.g. AD wants new warmups for spring, budget approved in January" style={{ ...input, resize: 'vertical', minHeight: 120, marginBottom: 12 }} />
      <button disabled={!ok} onClick={save} style={primary(ok)}>{note.saving ? 'Saving…' : 'Save note'}</button>
    </div></div>;
  }

  // ── Reminder ──
  if (view === 'reminder') {
    const ok = rem.title.trim() && rem.date;
    const quick = [['Today', localYmd()], ['Tomorrow', plusDays(1)], ['In 3 days', plusDays(3)], ['Next Mon', nextMonday()]];
    const isQuick = quick.some(([, d]) => d === rem.date) && !rem.pick;
    const custSOs = rem.customerId ? sos.filter((s) => familyIds(rem.customerId).has(s.customer_id) && !DONE_SO.includes(s.status || '')).slice(0, 6) : [];
    const save = () => {
      if (!ok || !onAddTodo) return;
      const now = new Date().toISOString();
      const so = rem.soId ? sos.find((s) => s.id === rem.soId) : null;
      onAddTodo({ id: 'todo-' + Date.now(), title: rem.title.trim().slice(0, 180), description: 'Reminder from the phone.', created_by: cu?.id || null, assigned_to: cu?.id || null,
        so_id: so ? so.id : null, customer_id: rem.customerId || (so ? so.customer_id : null), priority: rem.high ? 1 : 2, status: 'open', due_date: rem.date, created_at: now, updated_at: now, comments: [] });
      nf && nf('Reminder set for ' + (rem.date === localYmd() ? 'today' : shortDate(rem.date + 'T12:00:00')));
      close();
    };
    return <div style={sheetBg} onClick={close}><div style={sheet} onClick={(e) => e.stopPropagation()}>
      <SheetHead title="New reminder" onBack={() => setView('menu')} onClose={close} />
      <input autoFocus value={rem.title} onChange={(e) => setRem((r) => ({ ...r, title: e.target.value }))} placeholder="What do you need to do?" style={{ ...input, fontSize: 17, fontWeight: 600, marginBottom: 14 }} />
      <div style={label}>When</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {quick.map(([t, d]) => <button key={t} onClick={() => setRem((r) => ({ ...r, date: d, pick: false }))} style={chip(isQuick && rem.date === d)}>{t}</button>)}
        <button onClick={() => setRem((r) => ({ ...r, pick: true }))} style={chip(!isQuick)}>📅 {!isQuick && rem.date ? shortDate(rem.date + 'T12:00:00') : 'Pick a date'}</button>
      </div>
      {rem.pick && <input type="date" value={rem.date} min={localYmd()} onChange={(e) => setRem((r) => ({ ...r, date: e.target.value }))} style={{ ...input, marginBottom: 10 }} />}
      <div style={{ ...label, marginTop: 10 }}>Account <span style={{ textTransform: 'none', fontWeight: 600, color: '#94a3b8' }}>(optional)</span></div>
      <CustomerPick cust={cust} value={rem.customerId} suggested={mine} onPick={(id) => setRem((r) => ({ ...r, customerId: id, soId: null }))} />
      {custSOs.length > 0 && <>
        <div style={label}>Order <span style={{ textTransform: 'none', fontWeight: 600, color: '#94a3b8' }}>(optional)</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {custSOs.map((s) => <button key={s.id} onClick={() => setRem((r) => ({ ...r, soId: r.soId === s.id ? null : s.id }))} style={chip(rem.soId === s.id)}>{s.id}{s.memo ? ' · ' + String(s.memo).slice(0, 18) : ''}</button>)}
        </div>
      </>}
      <button onClick={() => setRem((r) => ({ ...r, high: !r.high }))} style={{ ...card, width: '100%', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, border: rem.high ? 'none' : '2px solid #cbd5e1', background: rem.high ? '#dc2626' : 'white', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>{rem.high ? '✓' : ''}</span>
        <span style={{ fontWeight: 700, color: '#0f172a' }}>High priority</span>
      </button>
      <button disabled={!ok} onClick={save} style={primary(ok)}>Save reminder</button>
    </div></div>;
  }

  // ── Invoice link: account → invoice (or an order's invoice) → the Get paid sheet ──
  if (view === 'pay') {
    const c = pay.customerId ? cust.find((x) => x.id === pay.customerId) : null;
    const suggested = cust.filter((x) => x && !x.parent_id && dueByCust[x.id]).sort((a, b) => dueByCust[b.id].due - dueByCust[a.id].due);
    const dueSub = (x) => { const d = dueByCust[x.parent_id || x.id]; return d ? money(d.due) + ' due · ' + d.n + ' invoice' + (d.n === 1 ? '' : 's') : 'Nothing due'; };
    const fam = c ? familyIds(c.id) : new Set();
    const cname = (id) => { const x = cust.find((y) => y.id === id); return x && x.id !== c?.id ? (x.alpha_tag || x.name) : ''; };
    const famInvs = openInvs.filter((i) => fam.has(i.customer_id)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const famSOs = sos.filter((s) => fam.has(s.customer_id) && !DONE_SO.includes(s.status || '')).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const soOpen = (s) => openInvs.filter((i) => i.so_id === s.id);
    const pick = (inv) => go(() => onOpenPayLink && onOpenPayLink(inv));
    const invRow = (i, inset) => <button key={i.id} onClick={() => pick(i)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '13px 14px', paddingLeft: inset ? 26 : 14, border: 'none', borderTop: '1px solid #f1f5f9', background: 'white', textAlign: 'left', cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 15 }}>{i.id}{cname(i.customer_id) ? <span style={{ fontWeight: 600, color: '#64748b' }}> · {cname(i.customer_id)}</span> : null}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{[shortDate(i.created_at), i.so_id ? 'Order ' + i.so_id : '', +i.paid > 0 ? money(i.paid) + ' paid' : ''].filter(Boolean).join(' · ')}</div>
      </div>
      <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 900, color: '#15803d', fontSize: 15 }}>{money(invBalance(i))}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>due</div></div>
      <span style={{ color: '#cbd5e1', fontSize: 18 }}>›</span>
    </button>;
    return <div style={sheetBg} onClick={close}><div style={sheet} onClick={(e) => e.stopPropagation()}>
      <SheetHead title="Invoice link" onBack={() => (c ? setPay({ customerId: null, tab: 'inv', openSo: null }) : setView('menu'))} onClose={close} />
      <div style={label}>1 · Customer</div>
      <CustomerPick cust={cust} value={pay.customerId} suggested={suggested} sub={dueSub} autoFocus={!c} placeholder="Search customers…" onPick={(id) => setPay({ customerId: id, tab: 'inv', openSo: null })} />
      {c && <>
        <div style={label}>2 · What are they paying?</div>
        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: 12, padding: 3, marginBottom: 10 }}>
          {[['inv', 'Invoices', famInvs.length], ['so', 'Sales orders', famSOs.length]].map(([k, t, n]) => <button key={k} onClick={() => setPay((p) => ({ ...p, tab: k }))} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: pay.tab === k ? 'white' : 'transparent', boxShadow: pay.tab === k ? '0 1px 3px rgba(15,23,42,.12)' : 'none', fontWeight: 800, fontSize: 14, color: pay.tab === k ? '#0f172a' : '#64748b', cursor: 'pointer' }}>{t} <span style={{ color: '#94a3b8', fontWeight: 700 }}>{n}</span></button>)}
        </div>
        {pay.tab === 'inv' && (famInvs.length
          ? <div style={{ ...card, padding: 0, overflow: 'hidden' }}>{famInvs.map((i) => invRow(i))}</div>
          : <div style={{ ...card, color: '#64748b', fontSize: 14 }}>No open invoices for {c.name}. Check Sales orders.</div>)}
        {pay.tab === 'so' && (famSOs.length
          ? <div style={{ ...card, padding: 0, overflow: 'hidden' }}>{famSOs.map((s) => {
            const oi = soOpen(s); const due = oi.reduce((t, i) => t + invBalance(i), 0); const expanded = pay.openSo === s.id;
            const tap = () => { if (oi.length === 1) pick(oi[0]); else if (oi.length > 1) setPay((p) => ({ ...p, openSo: expanded ? null : s.id })); };
            return <div key={s.id}>
              <button onClick={tap} disabled={!oi.length} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '13px 14px', border: 'none', borderTop: '1px solid #f1f5f9', background: 'white', textAlign: 'left', cursor: oi.length ? 'pointer' : 'default', opacity: oi.length ? 1 : 0.75 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.id}{s.memo ? <span style={{ fontWeight: 600, color: '#64748b' }}> · {s.memo}</span> : null}</div>
                  <div style={{ fontSize: 12, color: oi.length ? '#64748b' : '#b45309' }}>{oi.length ? oi.length + ' open invoice' + (oi.length === 1 ? '' : 's') : 'No invoice yet · create it on desktop first'}{cname(s.customer_id) ? ' · ' + cname(s.customer_id) : ''}</div>
                </div>
                {oi.length ? <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 900, color: '#15803d', fontSize: 15 }}>{money(due)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>due</div></div> : null}
                {oi.length ? <span style={{ color: '#cbd5e1', fontSize: 18 }}>{oi.length > 1 ? (expanded ? '▾' : '▸') : '›'}</span> : null}
              </button>
              {expanded && oi.map((i) => invRow(i, true))}
            </div>;
          })}</div>
          : <div style={{ ...card, color: '#64748b', fontSize: 14 }}>No open sales orders for {c.name}.</div>)}
        <div style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', marginTop: 4 }}>Next: choose the full balance or a part payment, then text, email, show a QR code or copy the link.</div>
      </>}
    </div></div>;
  }
  return null;
}
