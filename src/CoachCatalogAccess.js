/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

// Catalog color families (must match src/storefront/AdidasInventory.js).
const FAMILIES = ['Black', 'White', 'Grey', 'Navy', 'Royal', 'Blue', 'Red', 'Maroon', 'Orange', 'Gold', 'Yellow', 'Green', 'Purple', 'Pink', 'Brown'];
const HEX = { Black: '#191919', White: '#FFFFFF', Grey: '#9AA1AC', Navy: '#1B2A4A', Royal: '#2148C7', Blue: '#3B82F6', Red: '#C8102E', Maroon: '#6B1F2A', Orange: '#EA580C', Gold: '#C9A227', Yellow: '#EAB308', Green: '#15803D', Purple: '#6D28D9', Pink: '#EC4899', Brown: '#7C4A21' };
const TIER_DISC = { A: '40%', B: '35%', C: '30%' };
// Catalog brands an account can be locked to (must match CATALOG_BRANDS in
// src/storefront/AdidasInventory.js). Empty selection = all brands.
const CATALOG_BRANDS = ['Adidas', 'Under Armour', 'Nike'];

// Per-customer coach catalog account manager. Embedded on the customer detail
// page so the customer is always known — coaches invited here sign in on
// /adidas and get THIS customer's tier pricing + school colors.
export default function CoachCatalogAccess({ customer, nf, onUpdateCustomer }) {
  const [accts, setAccts] = useState(null);
  const [form, setForm] = useState({ email: '', name: '' });
  const [busy, setBusy] = useState(false);
  const note = (m, t) => { if (nf) nf(m, t); };

  const load = () => {
    if (!supabase || !customer || !customer.id) return;
    supabase.from('coach_accounts').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false })
      .then((r) => { if (!r.error) setAccts(r.data || []); else { setAccts([]); note('Coach accounts: ' + r.error.message, 'error'); } });
  };
  useEffect(load, [customer && customer.id]);

  const sc = Array.isArray(customer && customer.school_colors) ? customer.school_colors : [];
  const ab = Array.isArray(customer && customer.allowed_brands) ? customer.allowed_brands : [];
  const tier = (customer && customer.adidas_ua_tier) || 'B';

  const invite = async (email, name) => {
    try {
      const r = await fetch('/.netlify/functions/coach-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name, team: (customer && customer.name) || '' }) });
      const d = await r.json().catch(() => ({}));
      note(d.emailed ? ('📧 Invite emailed to ' + email) : ('Account saved — invite email could not send' + (d.error ? ' (' + d.error + ')' : '')), d.emailed ? 'success' : 'error');
    } catch (e) { note('Account saved — invite email failed to send', 'error'); }
  };

  const create = async () => {
    const em = (form.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return note('Valid email required', 'error');
    setBusy(true);
    const nm = (form.name || '').trim();
    const { error } = await supabase.from('coach_accounts').insert([{ email: em, name: nm || null, customer_id: customer.id }]);
    setBusy(false);
    if (error) return note((error.message || '').includes('duplicate') ? 'That email already has an account' : error.message, 'error');
    await invite(em, nm);
    setForm({ email: '', name: '' });
    load();
  };

  const toggleActive = async (a) => {
    const ns = a.status === 'active' ? 'disabled' : 'active';
    const { error } = await supabase.from('coach_accounts').update({ status: ns }).eq('id', a.id);
    if (error) return note(error.message, 'error');
    setAccts((prev) => (prev || []).map((x) => (x.id === a.id ? { ...x, status: ns } : x)));
  };

  const toggleColor = async (fam) => {
    const cur = sc;
    const next = cur.includes(fam) ? cur.filter((x) => x !== fam) : (cur.length < 5 ? [...cur, fam] : cur);
    if (next === cur) return note('Up to 5 colors', 'error');
    if (onUpdateCustomer) onUpdateCustomer({ ...customer, school_colors: next });
    const { error } = await supabase.from('customers').update({ school_colors: next.length ? next : null }).eq('id', customer.id);
    if (error) { note(error.message, 'error'); if (onUpdateCustomer) onUpdateCustomer({ ...customer, school_colors: cur }); }
  };

  // Brand access: none selected = all brands; otherwise the account's coaches
  // only see these brands in the catalog. Saved immediately to the customer.
  const toggleBrand = async (b) => {
    const cur = ab;
    const next = cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b];
    if (onUpdateCustomer) onUpdateCustomer({ ...customer, allowed_brands: next });
    const { error } = await supabase.from('customers').update({ allowed_brands: next.length ? next : null }).eq('id', customer.id);
    if (error) { note(error.message, 'error'); if (onUpdateCustomer) onUpdateCustomer({ ...customer, allowed_brands: cur }); }
  };

  // Coach-portal capability switches (coach_ai_builder / coach_livelook /
  // coach_build_orders on the customer). Each gates an optional area of the
  // coach portal, so these are off by default and turned on per team. Saved
  // immediately, optimistic with rollback on error — same shape as toggleBrand.
  const togglePortalCap = async (field) => {
    const next = !(customer && customer[field]);
    if (onUpdateCustomer) onUpdateCustomer({ ...customer, [field]: next });
    const { error } = await supabase.from('customers').update({ [field]: next }).eq('id', customer.id);
    if (error) { note(error.message, 'error'); if (onUpdateCustomer) onUpdateCustomer({ ...customer, [field]: !next }); }
    else note(next ? 'Enabled' : 'Disabled', 'success');
  };

  return (
    <div className="card">
      <div className="card-header"><h2>🎽 Catalog Access</h2></div>
      <div className="card-body">
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
          Invite this customer's coaches to the live adidas team catalog. They sign in with a one-tap email link (no password)
          and automatically see <strong>{customer && customer.name}</strong>'s pricing
          {TIER_DISC[tier] ? <> — <strong>Tier {tier} ({TIER_DISC[tier]} off)</strong></> : null} and school colors.
        </p>

        {/* Coach portal access — master switches for the optional portal areas */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Coach portal access</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['coach_ai_builder', '✨ Build with AI', "Show the team-store builder in this team's coach portal."],
              ['coach_livelook', '🏷️ Live Look', 'Let coaches shop the live-inventory catalog from the portal.'],
              ['coach_build_orders', '🧾 Build orders', 'Let coaches build & submit orders to their rep.'],
            ].map(([field, label, desc]) => {
              const on = !!(customer && customer[field]);
              return (
                <button key={field} onClick={() => togglePortalCap(field)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: '1px solid ' + (on ? '#191919' : '#e2e8f0'), background: on ? '#f8fafc' : '#fff', borderRadius: 10, padding: '9px 12px', cursor: 'pointer' }}>
                  <span style={{ width: 36, height: 20, borderRadius: 999, background: on ? '#22c55e' : '#cbd5e1', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Off by default — turn on per team. Saves automatically.</div>
        </div>

        {/* Brand access */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            Brands {ab.length ? '(' + ab.length + ' of ' + CATALOG_BRANDS.length + ')' : '— all brands'}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CATALOG_BRANDS.map((b) => {
              const on = ab.includes(b);
              return (
                <button key={b} onClick={() => toggleBrand(b)}
                  style={{ border: '1px solid ' + (on ? '#191919' : '#e2e8f0'), background: on ? '#191919' : '#fff', color: on ? '#fff' : '#475569', borderRadius: 999, padding: '3px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {b}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Limits which brands this account's coaches see in the catalog. None selected = all brands.</div>
        </div>

        {/* School colors */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            School colors {sc.length ? '(' + sc.length + '/5)' : '— click to set'}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FAMILIES.map((fam) => {
              const on = sc.includes(fam);
              return (
                <button key={fam} title={fam} onClick={() => toggleColor(fam)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid ' + (on ? '#191919' : '#e2e8f0'), background: on ? '#191919' : '#fff', color: on ? '#fff' : '#475569', borderRadius: 999, padding: '3px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: HEX[fam], border: '1px solid rgba(0,0,0,.15)', display: 'inline-block', flexShrink: 0 }} />{fam}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Pre-loads the coach's color filter on the catalog. Saves automatically.</div>
        </div>

        {/* Invite */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Invite a coach</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="coach@school.org *" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              style={{ padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: 210 }} />
            <input placeholder="Coach name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={{ padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: 170 }} />
            <button className="btn btn-sm btn-primary" style={{ padding: '8px 16px' }} disabled={busy} onClick={create}>{busy ? 'Adding…' : 'Create & email invite'}</button>
          </div>
        </div>

        {/* Accounts */}
        <div style={{ marginTop: 6 }}>
          {accts === null && <div className="empty" style={{ padding: 16 }}>Loading…</div>}
          {accts && accts.length === 0 && <div className="empty" style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No coach accounts yet for this customer.</div>}
          {(accts || []).map((a) => (
            <div key={a.id} style={{ borderTop: '1px solid #f1f5f9', padding: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', opacity: a.status === 'active' ? 1 : 0.55 }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{a.name || a.email}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{a.email}{a.status === 'active' ? '' : ' · disabled'}{a.auth_user_id ? ' · signed in' : ' · not signed in yet'}</div>
              </div>
              <button className="btn btn-sm" style={{ fontSize: 10, padding: '4px 10px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 8 }} onClick={() => invite(a.email, a.name || '')}>Resend invite</button>
              <button className="btn btn-sm" style={{ fontSize: 10, padding: '4px 10px', background: a.status === 'active' ? '#fef2f2' : '#f0fdf4', color: a.status === 'active' ? '#dc2626' : '#166534', border: '1px solid ' + (a.status === 'active' ? '#fecaca' : '#bbf7d0'), borderRadius: 8 }} onClick={() => toggleActive(a)}>{a.status === 'active' ? 'Disable' : 'Re-enable'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
