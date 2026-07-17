/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { SZ_ORD, pantoneHex, NSA, prodFilesStatusFor, artProdFilesConfirmed } from './constants';
import { statusChipLabel } from './lib/teamshopOrderStatus';
import { safeNum, safeItems, safeSizes, safePicks, safePOs, safeDecos, safeArr, safeStr, safeJobs, safeFirm, safeArt, resolveMockLink, mockLinkDependents, mockLinkSourceFiles, skusMissingMockups, realInkLines, soLineKey, jobItemDecoIdxs, jobItemDecosOfKind } from './safeHelpers';
import { calcSOStatus } from './components';
import { dP, rQ, SP, calcOrderTotals, calcAdidasItemSpend } from './pricing';
import { _portalAction, isUrl, fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, _filterDisplayable, printDoc, buildDocHtml, pdfDecoLabel, getBillingContacts, invokeEdgeFn, cloudUpload } from './utils';
import { StripePaymentModal } from './modals';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './lib/supabase';
import { supabaseCoach } from './lib/supabaseCoach';
import Papa from 'papaparse';
import { CatalogKitStyles, KitScope, DISPLAY } from './ui/catalogKit';
import { fetchStockMap } from './lib/storeInventory';
import StoreBuilder from './storefront/BuildStore';
import { RosterOrdersCoach } from './RosterOrders';

// The coach portal is also embedded in the marketing site (nationalsportsapparel.com)
// via an iframe with ?embed=1 — the same pattern as /team-stores and /livelook.
// When embedded, links to other surfaces must break OUT of the iframe (target=_top)
// and point at the marketing domain; opened directly, they open in a new tab.
const CP_EMBEDDED = (() => { try { return new URLSearchParams(window.location.search).get('embed') === '1'; } catch { return false; } })();
const CP_MARKETING = 'https://nationalsportsapparel.com';
const CP_LINK_TARGET = CP_EMBEDDED ? '_top' : '_blank';
// Live Look = the live-inventory catalog. Marketing wraps it at /livelook; the
// portal serves it directly at /adidas.
const CP_LIVELOOK_URL = CP_EMBEDDED ? `${CP_MARKETING}/livelook` : '/adidas';
// A team store's public storefront — like CP_LIVELOOK_URL: absolute (marketing
// domain) when embedded so the click breaks OUT of the iframe to the proxied
// nationalsportsapparel.com/shop/<slug> instead of the raw portal domain;
// relative when the portal serves the page directly. Mirrors shopHref() in
// storefront/TeamStores.js.
const cpShopHref = (slug) => CP_EMBEDDED ? `${CP_MARKETING}/shop/${slug}` : `/shop/${slug}`;

// Read-only team-store view for the coach: headline order/fundraising/batch
// summary up top, with the per-player order list as a searchable, collapsible
// section below. No editing.
const _cpMoney = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _cpMoney0 = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const _cpStages = { pending: 'Ordered', received: 'Received', in_production: 'In production', bagging: 'Bagging', shipped: 'Shipped', complete: 'Complete' };
// Production-stage order, least→most advanced. Mirrors the staff SRANK in
// src/Webstores.js (enrich()) — keep the two in step if a stage is ever added.
const _cpStageRank = { pending: 0, received: 1, in_production: 2, bagging: 3, shipped: 4, complete: 5 };
// Status tones from the NSA design system (Team Store Tracking "1A" handoff):
// ordered=slate, received=indigo, in-production=red, bagging=amber, shipped=navy,
// complete=green. A short/backordered line borrows the red accent.
const _cpTone = (s) => s === 'complete' ? '#166534' : s === 'shipped' ? '#192853' : s === 'bagging' ? '#B26A1C' : s === 'in_production' ? '#962C32' : s === 'received' ? '#4E63A6' : '#7A8194';
// NSA design tokens used by the tracking card — the fixed brand palette (not the
// per-team theme), matching the reviewed 1A mock.
const _CPD = { navy: '#192853', navyDark: '#0F1A38', navyTint: '#2a3d5e', red: '#962C32', green: '#1F7A43', offWhite: '#F7F8FB', panel: '#FBFCFE', lightGray: '#EEF1F6', midGray: '#D1D5DE', text: '#2A2F3E', textLight: '#5A6075' };
const _cpHash = 'repeating-linear-gradient(-55deg, transparent 0 30px, rgba(255,255,255,.02) 30px 60px)';
// A short human order reference: the OMG order number for OMG-fed stores, else
// the native customer-facing order_number (migration 00177), falling back to a
// stable 6-char slice of the UUID for legacy orders with neither. Mirrors the
// storefront order tracker (storefront/OrderTrack.js).
const _cpOrderNo = (o) => o.omg_order_number ? String(o.omg_order_number) : (o.order_number ? '#' + o.order_number : (o.id ? '#' + String(o.id).replace(/-/g, '').slice(-6).toUpperCase() : '—'));
const _cpDelivery = (o, store) => { const m = String(o.ship_method || store?.delivery_mode || ''); if (/pick/i.test(m)) return 'Pickup'; if (/club|team|deliver/i.test(m)) return 'Team delivery'; return 'Ship to home'; };
const _cpShipTo = (o) => { const a = o.ship_address || {}; const city = [a.city, a.state].filter(Boolean).join(', '); return [city, a.zip].filter(Boolean).join(' ') || a.name || '—'; };
const _cpFmtDate = (s) => { if (!s) return ''; const dt = new Date(s); return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
// Carrier tracking deep-links. carrier values seen: fedex, ups, usps, stamps_com.
const _cpTrackHref = (carrier, tracking) => {
  if (!tracking) return '';
  const t = encodeURIComponent(String(tracking).trim());
  const c = String(carrier || '').toLowerCase();
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
  return `https://www.google.com/search?q=${t}`;
};

// ── Team-colored portal header ───────────────────────────────────────
// Wear the team's own colors in the portal header, the way each webstore
// header is themed by its store colors. customer.school_colors is an array of
// catalog color-family names (e.g. ["Navy","Orange","White"]); families + hexes
// mirror src/CoachCatalogAccess.js and src/storefront/AdidasInventory.js — except
// Red and Purple, which are intentionally the deeper team-brand shades here
// (Red: PMS 200 C, #BA0C2F; Purple: #3B1464) rather than the brighter
// garment-swatch versions, so a team whose hero banner picks that family reads
// richer instead of pastel-bright — same reasoning for both.
// Cardinal/Silver aren't in those catalog files (no garment filter needs them
// yet) but match the Cardinal/Silver hexes already used for thread-color pickers
// elsewhere (OrderEditor.js, CustDetail.js).
const CP_HEX = { Black: '#191919', White: '#FFFFFF', Grey: '#9AA1AC', Silver: '#C0C0C0', Navy: '#1B2A4A', Royal: '#2148C7', Blue: '#3B82F6', Red: '#BA0C2F', Cardinal: '#8C1515', Maroon: '#6B1F2A', Orange: '#EA580C', Gold: '#C9A227', Yellow: '#EAB308', Green: '#15803D', Purple: '#3B1464', Pink: '#EC4899', Brown: '#7C4A21' };
// Darkest-first: which team color makes the best deep banner background (white
// text stays readable). Light/neutral families are intentionally excluded.
const CP_PRIMARY_PREF = ['Navy', 'Maroon', 'Cardinal', 'Purple', 'Green', 'Royal', 'Brown', 'Red', 'Black', 'Blue'];
// Brightest-first: which team color pops best as the accent underline/eyebrow.
const CP_ACCENT_PREF = ['Orange', 'Red', 'Cardinal', 'Gold', 'Yellow', 'Royal', 'Blue', 'Green', 'Pink', 'Purple', 'Maroon', 'Navy'];
const CP_DEFAULT_THEME = { primary: '#1e3a5f', accent: '#2563eb' }; // NSA navy/blue fallback
// Lighten (pct>0) / darken (pct<0) a hex — mirrors storefront/Storefront.js shade().
const cpShade = (hex, pct) => {
  try {
    const h = (hex || '#1e3a5f').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  } catch { return hex; }
};
// CP_HEX as RGB triples, for nearest-family matching of a raw Pantone hex.
const CP_HEX_RGB = Object.fromEntries(Object.entries(CP_HEX).map(([f, h]) => {
  const n = h.replace('#', '');
  return [f, [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]];
}));
// Map one saved Pantone color (customer.pantone_colors entry: {code,name,hex})
// to a catalog color-family name. The color NAME wins over the hex, so a
// mis-stored swatch still resolves — e.g. "1815 Cardinal" → Cardinal even though
// its saved hex is a placeholder grey. Numeric codes ("458") fall to the nearest
// family by the canonical Pantone hex.
function cpPantoneFamily(entry) {
  if (!entry) return null;
  const label = `${entry.code || ''} ${entry.name || ''}`.trim();
  const named = Object.keys(CP_HEX).find((f) => new RegExp(`\\b${f}\\b`, 'i').test(label));
  if (named) return named;
  const hex = pantoneHex(entry.code) || entry.hex;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const h = hex.replace('#', ''), rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  let best = null, bestD = Infinity;
  for (const [f, c] of Object.entries(CP_HEX_RGB)) {
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}
// The catalog color-families a customer effectively carries for portal theming:
// the explicit family picker (school_colors) when set, otherwise derived from the
// team's saved Pantone colors (pantone_colors). Most customers only ever fill the
// "School Colors (Pantone)" card, so without this fallback the portal ignores
// their real colors and paints the NSA navy/red default instead.
function cpEffectiveFamilies(customer) {
  const explicit = Array.isArray(customer && customer.school_colors) ? customer.school_colors.filter((f) => CP_HEX[f]) : [];
  if (explicit.length) return explicit;
  const pan = Array.isArray(customer && customer.pantone_colors) ? customer.pantone_colors : [];
  const fams = [];
  for (const p of pan) { const f = cpPantoneFamily(p); if (f && !fams.includes(f)) fams.push(f); }
  return fams;
}
// Resolve a {primary, accent} header theme from a customer's colors.
// primary is always a dark, readable banner color (a dark team color or the NSA
// navy default); accent is the team's brightest color (or a tonal fallback).
function cpTeamTheme(customer, supplement) {
  const own = cpEffectiveFamilies(customer);
  // Parent-department colors the team doesn't already carry — used to fill the
  // accent only (e.g. a sub-team borrows the school's gold), never the primary.
  const sup = Array.isArray(supplement) ? supplement.filter((f) => CP_HEX[f] && !own.includes(f)) : [];
  if (!own.length && !sup.length) return { ...CP_DEFAULT_THEME };
  // Primary comes from the team's OWN colors first, so a sub-team keeps its own
  // banner color; borrow the parent's only when the team has none of its own.
  const primaryPool = own.length ? own : sup;
  const darkFam = CP_PRIMARY_PREF.find((f) => primaryPool.includes(f));
  const primary = darkFam ? CP_HEX[darkFam] : CP_DEFAULT_THEME.primary;
  // Accent from the team's OWN colors first (keep its identity); only borrow the
  // parent department's colors when the team has no distinct accent of its own.
  const pickAccent = (pool) => CP_ACCENT_PREF.find((f) => pool.includes(f) && f !== darkFam)
    || pool.find((f) => f !== darkFam && f !== 'White' && f !== 'Grey' && f !== 'Silver' && f !== 'Black');
  const accentFam = pickAccent(own) || pickAccent(sup);
  // No distinct second color anywhere? Deepen the primary for the accent — never
  // lighten, which would desaturate a warm primary (red) into pink.
  const accent = (accentFam && CP_HEX[accentFam]) || cpShade(primary, -24);
  return { primary, accent };
}

function CoachStore({ customer, storeIds }) {
  const [stores, setStores] = useState([]);
  const [data, setData] = useState({}); // storeId -> {orders, items, roster}
  const [loaded, setLoaded] = useState(false);
  // For an athletic-dept (parent) account, storeIds covers the dept + every sub-team so
  // the parent sees all its teams' stores; for a single team it's [self, parent]. Falls
  // back to [self, parent] when no explicit set is passed.
  const _storeIdKey = (storeIds && storeIds.length ? storeIds : [customer.id, customer.parent_id]).filter(Boolean).join(',');
  useEffect(() => {
    let cancel = false;
    (async () => {
      const ids = _storeIdKey ? _storeIdKey.split(',') : [];
      if (!ids.length) { setLoaded(true); return; }
      const { data: ws, error } = await supabase.from('coach_webstores').select('*').in('customer_id', ids);
      if (cancel) return;
      if (error || !ws || !ws.length) { setLoaded(true); return; }
      setStores(ws);
      const out = {};
      for (const s of ws) {
        const [o, r] = await Promise.all([
          supabase.from('coach_webstore_orders').select('*').eq('store_id', s.id).order('created_at', { ascending: false }),
          supabase.from('webstore_roster').select('*').eq('store_id', s.id),
        ]);
        const orders = o.data || [];
        const orderIds = orders.map((x) => x.id);
        let items = [];
        if (orderIds.length) { const it = await supabase.from('coach_webstore_order_items').select('*').in('order_id', orderIds); items = it.data || []; }
        out[s.id] = { orders, items, roster: r.data || [] };
      }
      if (!cancel) { setData(out); setLoaded(true); }
    })();
    return () => { cancel = true; };
  }, [_storeIdKey]);

  if (!loaded) return null;
  // The coach sees their own submissions as "pending review"; staff work-in-
  // progress drafts stay hidden until published. Everything live renders as the
  // usual order-tracking card.
  const pending = stores.filter((s) => s.status === 'draft' && s.created_via === 'coach');
  const live = stores.filter((s) => s.status !== 'draft' && s.status !== 'archived');
  if (!pending.length && !live.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      {pending.map((s) => (
        <div key={s.id} style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 14, padding: '16px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 26 }}>⏳</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>{s.name}</div>
            <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 2 }}>Submitted — pending our review. We'll set up shipping &amp; checkout and email you when it's live.</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap' }}>Pending review</span>
        </div>
      ))}
      {live.map((s) => <CoachStoreCard key={s.id} store={s} d={data[s.id] || { orders: [], items: [], roster: [] }} />)}
    </div>
  );
}

// Coach-facing roster manager — set up players (type, paste, or upload a
// template), hand each their own store link, and track who's opened / ordered.
// Runs on the coach's authenticated session, so it reads/writes webstore_roster
// directly (same RLS access as staff); emails go through the roster-invite fn.
function CoachRosterManager({ store, initialRoster }) {
  const [roster, setRoster] = useState(initialRoster || []);
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [single, setSingle] = useState({ player_name: '', player_number: '', parent_email: '', position: '' });
  const [bulk, setBulk] = useState('');
  const [bulkPos, setBulkPos] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const fileRef = useRef();

  // Player invite links are copied and sent to players/parents, so they must be
  // the canonical public URL (nationalsportsapparel.com/shop/<slug>, proxied to
  // the storefront) rather than the raw portal domain — same rule the Live Look
  // share link follows (storefront/AdidasInventory.js).
  const linkFor = (r) => r.token ? `${CP_MARKETING}/shop/${store.slug}?player=${r.token}` : '';
  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 3500); };

  const reload = async () => {
    const { data } = await supabase.from('webstore_roster').select('*').eq('store_id', store.id).order('player_name');
    if (data) setRoster(data);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [store.id]);

  const tok = () => { try { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch { return (Math.random().toString(16) + Math.random().toString(16)).replace(/[^a-f0-9]/g, '').slice(0, 32); } };
  const normPos = (v) => { const x = String(v || '').trim().toLowerCase(); if (['gk', 'goalie', 'goalkeeper', 'keeper'].includes(x)) return 'gk'; if (['field', 'fielder', 'outfield', 'player'].includes(x)) return 'field'; return null; };

  const addPlayers = async (players) => {
    const rows = (players || [])
      .map((p) => ({ player_name: String(p.player_name || '').trim(), player_number: String(p.player_number || '').trim() || null, parent_email: String(p.parent_email || '').trim() || null, position: normPos(p.position) }))
      .filter((p) => p.player_name)
      .map((p) => ({ ...p, store_id: store.id, token: tok(), ordered: false }));
    if (!rows.length) { flash('Enter at least one player name.'); return false; }
    setBusy(true);
    const { error } = await supabase.from('webstore_roster').insert(rows);
    setBusy(false);
    if (error) { flash('Could not add players: ' + error.message); return false; }
    await reload(); flash(`Added ${rows.length} player${rows.length === 1 ? '' : 's'}`); setOpen(true);
    return true;
  };
  const updatePlayer = async (id, fields) => { const { error } = await supabase.from('webstore_roster').update(fields).eq('id', id); if (error) { flash('Error: ' + error.message); return; } reload(); };
  const removePlayer = async (r) => { if (!window.confirm(`Remove ${r.player_name}?`)) return; const { error } = await supabase.from('webstore_roster').delete().eq('id', r.id); if (error) { flash('Error: ' + error.message); return; } reload(); };

  const addSingle = async () => { if (!single.player_name.trim()) { flash('Enter a player name.'); return; } const ok = await addPlayers([single]); if (ok) setSingle({ player_name: '', player_number: '', parent_email: '', position: single.position }); };
  const addBulk = async () => {
    const players = bulk.split('\n').map((line) => { const parts = line.split(/[,\t]/).map((x) => x.trim()); return parts[0] ? { player_name: parts[0], player_number: parts[1] || '', parent_email: parts[2] || '', position: parts[3] || bulkPos } : null; }).filter(Boolean);
    if (!players.length) { flash('Paste at least one player (one per line).'); return; }
    const ok = await addPlayers(players); if (ok) { setBulk(''); }
  };

  // Template upload — CSV with a header row (Name, Number, Email, Position) or
  // the same columns in order without a header. Parsed with papaparse so quoted
  // fields (e.g. "Smith, Jr.") survive.
  const parseRows = (rows) => {
    if (!rows.length) return [];
    const first = rows[0].map((c) => String(c || '').trim().toLowerCase());
    const hasHeader = first.some((c) => ['name', 'player', 'player name', 'player_name'].includes(c));
    const header = hasHeader ? first : null;
    const findIdx = (names) => header ? header.findIndex((h) => names.includes(h)) : -1;
    const iName = header ? findIdx(['name', 'player', 'player name', 'player_name']) : 0;
    const iNum = header ? findIdx(['number', '#', 'jersey', 'jersey number', 'player_number']) : 1;
    const iEmail = header ? findIdx(['email', 'parent email', 'parent_email', 'parent']) : 2;
    const iPos = header ? findIdx(['position', 'pos', 'role']) : 3;
    const get = (row, i) => (i >= 0 && i < row.length) ? String(row[i] || '').trim() : '';
    return rows.slice(hasHeader ? 1 : 0).map((row) => ({ player_name: get(row, iName), player_number: get(row, iNum), parent_email: get(row, iEmail), position: get(row, iPos) || bulkPos })).filter((p) => p.player_name);
  };
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    Papa.parse(file, { skipEmptyLines: true, complete: async (res) => { const players = parseRows(res.data || []); if (!players.length) { flash('No players found in that file.'); return; } await addPlayers(players); }, error: () => flash('Could not read that file.') });
    e.target.value = '';
  };
  const downloadTemplate = () => {
    const csv = 'Name,Number,Email,Position\nJane Smith,10,parent@email.com,field\nAlex Kim,1,alex@email.com,gk\nSam Rivera,7,,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${store.slug || 'roster'}-template.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const copyOne = (r) => { const l = linkFor(r); if (!l) return; navigator.clipboard?.writeText(l); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500); };
  const copyAll = () => { const rows = roster.filter((r) => r.token); if (!rows.length) { flash('No links yet.'); return; } navigator.clipboard?.writeText(rows.map((r) => `${r.player_name}${r.player_number ? ' #' + r.player_number : ''}: ${linkFor(r)}`).join('\n')); flash(`Copied ${rows.length} links`); };
  const emailPlayers = async (rows, label) => {
    const ids = rows.filter((r) => r.token && (r.parent_email || '').trim()).map((r) => r.id);
    if (!ids.length) { flash('No players with an email address to send to.'); return; }
    if (!window.confirm(`Email ${ids.length} ${label}?`)) return;
    setBusy(true);
    try { const res = await fetch('/.netlify/functions/roster-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: store.id, player_ids: ids }) }); const dj = await res.json().catch(() => ({})); if (!res.ok || !dj.ok) flash('Email failed: ' + (dj.error || res.status)); else { flash(`Emailed ${dj.sent} link${dj.sent === 1 ? '' : 's'}${(dj.skipped || []).length ? ` · ${dj.skipped.length} skipped` : ''}`); reload(); } }
    catch (err) { flash('Email failed: ' + err.message); }
    setBusy(false);
  };

  const fmtDate = (s) => { if (!s) return ''; const dt = new Date(s); return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const orderedCount = roster.filter((r) => r.ordered).length;
  const openedCount = roster.filter((r) => r.last_opened_at).length;
  const posSel = (value, onChange) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}>
      <option value="">Any</option><option value="field">Field</option><option value="gk">Goalkeeper</option>
    </select>
  );
  const chip = (label, bg, fg) => <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color: fg }}>{label}</span>;

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#0b1220', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>▶</span>
        Roster &amp; player links ({roster.length})
      </button>
      {roster.length > 0 && <span style={{ marginLeft: 10, fontSize: 12, color: '#64748b' }}>{orderedCount}/{roster.length} ordered · {openedCount} opened their link</span>}

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button onClick={() => setShowAdd((v) => !v)} style={cpRosBtn('#0b1f3a', '#fff')}>{showAdd ? 'Close' : '+ Add players'}</button>
            <button onClick={() => fileRef.current && fileRef.current.click()} style={cpRosBtn('#fff', '#0b1f3a', true)}>⬆ Upload template</button>
            <button onClick={downloadTemplate} style={cpRosBtn('#fff', '#0b1f3a', true)}>Download template</button>
            {roster.length > 0 && <><button onClick={copyAll} style={cpRosBtn('#fff', '#0b1f3a', true)}>Copy all links</button>
              <button disabled={busy} onClick={() => emailPlayers(roster.filter((r) => !r.ordered), 'players who haven’t ordered')} style={cpRosBtn('#fff', '#0b1f3a', true)}>Email not-ordered</button></>}
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" onChange={onFile} style={{ display: 'none' }} />
          </div>
          {note && <div style={{ fontSize: 12, color: '#0b1f3a', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>{note}</div>}

          {showAdd && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12, background: '#fafcff' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input value={single.player_name} onChange={(e) => setSingle({ ...single, player_name: e.target.value })} placeholder="Player name" style={cpRosInput(170)} onKeyDown={(e) => e.key === 'Enter' && addSingle()} />
                <input value={single.player_number} onChange={(e) => setSingle({ ...single, player_number: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="#" style={cpRosInput(56)} onKeyDown={(e) => e.key === 'Enter' && addSingle()} />
                {posSel(single.position, (v) => setSingle({ ...single, position: v || '' }))}
                <input value={single.parent_email} onChange={(e) => setSingle({ ...single, parent_email: e.target.value })} placeholder="parent@email.com" style={cpRosInput(190)} onKeyDown={(e) => e.key === 'Enter' && addSingle()} />
                <button disabled={busy} onClick={addSingle} style={cpRosBtn('#0b1f3a', '#fff')}>Add</button>
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 4 }}>Or paste a list — one per line: <code>Name, Number, Email, Position</code></div>
              <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={'Jane Smith, 10, parent@email.com, field\nAlex Kim, 1, alex@email.com, gk'} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxSizing: 'border-box', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>These are all:</span>
                {posSel(bulkPos, (v) => setBulkPos(v || ''))}
                <button disabled={busy} onClick={addBulk} style={cpRosBtn('#0b1f3a', '#fff')}>Add from list</button>
              </div>
            </div>
          )}

          {roster.length === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b', padding: '6px 0' }}>No players yet. Add them above or upload your roster — each player gets a private link to your store.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={cpRosTh}>Player</th><th style={cpRosTh}>#</th><th style={cpRosTh}>Position</th><th style={cpRosTh}>Opened?</th><th style={cpRosTh}>Ordered?</th><th style={cpRosTh}>Link</th><th style={cpRosTh}></th>
                </tr></thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={cpRosTd}>{r.player_name}</td>
                      <td style={cpRosTd}><input defaultValue={r.player_number || ''} onBlur={(e) => { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4); if (v !== (r.player_number || '')) updatePlayer(r.id, { player_number: v || null }); }} placeholder="#" style={{ width: 44, border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 5px', fontSize: 12 }} /></td>
                      <td style={cpRosTd}>{posSel(r.position, (v) => updatePlayer(r.id, { position: v }))}</td>
                      <td style={cpRosTd}>{r.last_opened_at ? chip(`Opened ${fmtDate(r.last_opened_at)}`, '#dbeafe', '#1e40af') : r.invite_sent_at ? chip(`Invited ${fmtDate(r.invite_sent_at)}`, '#f1f5f9', '#64748b') : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={cpRosTd}>{r.ordered ? chip('Ordered', '#dcfce7', '#166534') : chip('Not yet', '#f8fafc', '#94a3b8')}</td>
                      <td style={cpRosTd}>
                        {r.token ? (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button onClick={() => copyOne(r)} style={cpRosBtn('#fff', '#0b1f3a', true)}>{copiedId === r.id ? '✓' : 'Copy'}</button>
                            <button disabled={busy || !(r.parent_email || '').trim()} title={(r.parent_email || '').trim() ? `Email ${r.parent_email}` : 'Add a parent email first'} onClick={() => emailPlayers([r], 'this player')} style={cpRosBtn('#fff', '#0b1f3a', true)}>Email</button>
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ ...cpRosTd, textAlign: 'right' }}><button onClick={() => removePlayer(r)} title="Remove" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16 }}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const cpRosTh = { padding: '6px 8px', whiteSpace: 'nowrap' };
const cpRosTd = { padding: '6px 8px', verticalAlign: 'middle' };
const cpRosInput = (w) => ({ width: w, border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 9px', fontSize: 13, boxSizing: 'border-box' });
const cpRosBtn = (bg, fg, outline) => ({ background: bg, color: fg, border: outline ? '1px solid #cbd5e1' : 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });

// Team Store Tracking card — the coach's read-only view of one live store,
// rebuilt to the NSA "1A · Refined Ledger" design handoff: a navy header, a KPI
// strip, fundraising-goal + roster-ordered progress bars, and a searchable /
// filterable player-order ledger whose rows expand into a contact meta band, a
// priced line-item table, and a fundraising + shipping footer. The roster
// manager (a separate coach tool) renders below. All data is live; fields with
// no backing value degrade quietly (no goal → no goal bar, no tracking → no
// Track link).
function CoachStoreCard({ store: s, d }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  // Open dropdowns, keyed by order id. All orders start collapsed so the ledger
  // opens as a clean, scannable list (a full store can run to dozens of orders);
  // the coach expands the ones they want, or hits Expand all.
  const [open, setOpen] = useState({});

  const itemsByOrder = {};
  d.items.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  // Active orders exclude abandoned pre-payment carts and cancellations.
  const active = d.orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_payment');

  // A line is "backordered" when staff have flagged it short (missing_qty > 0) —
  // the real, staff-maintained shortfall signal. The unused `backordered` column
  // is intentionally not read.
  const isShort = (i) => (Number(i.missing_qty) || 0) > 0;

  const buildRow = (o) => {
    const lineItems = (itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent);
    const lines = lineItems.map((i) => {
      const short = isShort(i);
      const sk = i.line_status || 'pending';
      return {
        id: i.id,
        name: i.name || i.sku || 'Item',
        sku: (i.name && i.sku && i.name !== i.sku) ? i.sku : '',
        size: i.size || '—', qty: Number(i.qty) || 0,
        priceStr: _cpMoney(Number(i.unit_price) || 0),
        statusLabel: short ? 'On order' : (_cpStages[sk] || sk),
        statusTone: short ? _CPD.red : _cpTone(sk),
        short, backEta: i.backorder_eta ? _cpFmtDate(i.backorder_eta) : '',
      };
    });
    const items = lineItems.reduce((a, i) => a + (Number(i.qty) || 0), 0);
    const sales = lineItems.reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 0), 0);
    // Overall status = least-advanced non-short line (fall back to all lines).
    const pool = lineItems.filter((i) => !isShort(i));
    const src = pool.length ? pool : lineItems;
    const ranks = src.map((i) => (_cpStageRank[i.line_status || 'pending'] ?? 0));
    const minRank = ranks.length ? Math.min(...ranks) : 0;
    const statusKey = Object.keys(_cpStageRank).find((k) => _cpStageRank[k] === minRank) || 'pending';
    const hasBack = lineItems.some(isShort);
    const player = [...new Set(lineItems.map((i) => i.player_name).filter(Boolean))].join(', ');
    const number = [...new Set(lineItems.map((i) => i.player_number).filter(Boolean))].join(', ');
    const shipped = statusKey === 'shipped' || statusKey === 'complete' || !!o.shipped_at || !!o.tracking_number;
    const trackHref = _cpTrackHref(o.carrier, o.tracking_number);
    const shipDate = _cpFmtDate(o.shipped_at);
    const carrier = o.carrier ? String(o.carrier).toUpperCase().replace('STAMPS_COM', 'USPS') : '';
    return {
      id: o.id, no: _cpOrderNo(o), date: _cpFmtDate(o.created_at) || '—',
      player: player || o.buyer_name || '—', number: number || '—',
      items, fundStr: _cpMoney(Number(o.fundraise_amt) || 0), salesStr: _cpMoney(sales),
      buyerName: o.buyer_name || '—', buyerEmail: o.buyer_email || '', buyerPhone: o.buyer_phone || '—',
      paid: o.payment_mode === 'paid', paymentLabel: o.payment_mode === 'paid' ? 'Paid' : 'Team tab',
      payColor: o.payment_mode === 'paid' ? _CPD.green : _CPD.textLight,
      statusKey, statusLabel: _cpStages[statusKey] || statusKey, statusTone: _cpTone(statusKey),
      hasBack, backCount: lineItems.filter(isShort).length, delivery: _cpDelivery(o, s),
      shipped, tracked: shipped && !!trackHref, trackHref,
      shipHeadline: shipped ? (shipDate ? `Shipped ${shipDate}` : 'Shipped') : 'Not yet shipped',
      shipSub: shipped ? ([carrier, o.tracking_number].filter(Boolean).join(' · ') || 'In transit') : (o.so_id ? `Ships with ${o.so_id}` : 'Awaiting batch'),
      shipTo: _cpShipTo(o), soId: o.so_id || '', lines,
      _hay: `${player} ${o.buyer_name || ''} ${o.buyer_email || ''} ${_cpOrderNo(o)} ${number}`.toLowerCase(),
    };
  };

  const allRows = active.map(buildRow);

  // ── KPIs ──
  const playersN = new Set(d.items.map((i) => (i.player_name || '').trim().toLowerCase()).filter(Boolean)).size;
  const units = d.items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (Number(i.qty) || 0), 0);
  // Collected keys off payment_mode (NOT status === 'paid') so batching/shipping
  // never drops it from "collected"; refunded orders owe nothing, so they're
  // excluded from both collected and pending. Same rule as Webstores.js
  // fundPaid/fundPending — keep in sync.
  const fundLive = active.filter((o) => o.status !== 'refunded');
  const fundraising = fundLive.filter((o) => o.payment_mode === 'paid').reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const fundPending = fundLive.filter((o) => o.payment_mode !== 'paid').reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const sales = active.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const paidCount = active.filter((o) => o.payment_mode === 'paid').length;
  const fundGoal = Number(s.fundraise_goal) || 0;
  const fundPct = fundGoal > 0 ? Math.min(100, Math.round((fundraising / fundGoal) * 100)) : 0;
  const roster = d.roster || [];
  const rosterSize = roster.length;
  const rosterOrdered = roster.filter((r) => r.ordered).length;
  const rosterPct = rosterSize > 0 ? Math.min(100, Math.round((rosterOrdered / rosterSize) * 100)) : 0;

  // ── Search + status filter ──
  const searchRows = q.trim() ? allRows.filter((r) => r._hay.includes(q.trim().toLowerCase())) : allRows;
  const chipDefs = [['all', 'All'], ['pending', 'Ordered'], ['received', 'Received'], ['in_production', 'In production'], ['bagging', 'Bagging'], ['shipped', 'Shipped'], ['backordered', 'Backordered']];
  const countFor = (k) => k === 'all' ? searchRows.length : k === 'backordered' ? searchRows.filter((r) => r.hasBack).length : searchRows.filter((r) => r.statusKey === k).length;
  const visibleRows = searchRows.filter((r) => filter === 'all' ? true : filter === 'backordered' ? r.hasBack : r.statusKey === filter);

  const toggle = (id) => setOpen((m) => ({ ...m, [id]: !m[id] }));
  const allOpen = visibleRows.length > 0 && visibleRows.every((r) => open[r.id]);
  const toggleAll = () => { if (allOpen) { setOpen({}); } else { const m = {}; visibleRows.forEach((r) => { m[r.id] = true; }); setOpen(m); } };

  const closeStr = s.close_at ? (new Date(s.close_at) < new Date() ? `Store closed ${_cpFmtDate(s.close_at)}` : `Closes ${_cpFmtDate(s.close_at)}`) : '';

  // ── Reusable style atoms ──
  const disp = { fontFamily: "'Barlow Condensed',sans-serif" };
  const eyebrow = { ...disp, fontWeight: 700, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: _CPD.textLight };
  const tnum = { fontVariantNumeric: 'tabular-nums' };
  const GRID = '24px minmax(150px,1.6fr) 46px 58px 96px minmax(150px,1.2fr)';
  const LN = 'minmax(150px,2.2fr) 54px 40px 74px minmax(110px,1fr) minmax(104px,1fr)';
  const bagIcon = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
  const truckIcon = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>;
  const fundIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;

  const Kpi = ({ label, value, green }) => (
    <div style={{ flex: '1 1 108px', minWidth: 100 }}>
      <div style={{ ...disp, fontWeight: 800, fontSize: 27, lineHeight: 1, color: green ? _CPD.green : _CPD.navy, ...tnum }}>{value}</div>
      <div style={{ ...eyebrow, marginTop: 5 }}>{label}</div>
    </div>
  );
  const Bar = ({ label, right, pct, from, to }) => (
    <div style={{ flex: '1 1 260px', minWidth: 220 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={eyebrow}>{label}</span>
        <span style={{ fontSize: 12.5, color: _CPD.text, fontWeight: 600, ...tnum }}>{right}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: _CPD.lightGray, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${from}, ${to})`, width: `${pct}%` }} />
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ background: '#fff', border: `1px solid ${_CPD.lightGray}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        {/* Navy header */}
        <div style={{ backgroundImage: `${_cpHash}, linear-gradient(180deg, ${_CPD.navy} 0%, ${_CPD.navyDark} 100%)`, color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: `3px solid ${_CPD.red}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ display: 'inline-flex', opacity: 0.92 }}>{bagIcon}</span>
            <span style={{ ...disp, fontWeight: 800, fontSize: 20, letterSpacing: '.01em', textTransform: 'uppercase' }}>{s.name}</span>
            {closeStr && <span style={{ fontSize: 12, opacity: 0.6, whiteSpace: 'nowrap' }}>· {closeStr}</span>}
          </div>
          <a href={cpShopHref(s.slug)} target={CP_LINK_TARGET} rel="noopener noreferrer" style={{ ...disp, fontWeight: 700, fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', border: '1px solid rgba(255,255,255,.5)', borderRadius: 8, padding: '8px 16px', whiteSpace: 'nowrap' }}>Visit store ↗</a>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 0', padding: '18px 20px 16px', borderBottom: `1px solid ${_CPD.lightGray}` }}>
          <Kpi label="Orders" value={active.length} />
          <Kpi label="Players" value={playersN} />
          <Kpi label="Items" value={units} />
          <Kpi label="Sales" value={_cpMoney0(sales)} />
          <Kpi label="Fundraising" value={_cpMoney0(fundraising)} green />
          {fundPending > 0.005 && <Kpi label="Fundraise pending" value={_cpMoney0(fundPending)} />}
          <Kpi label="Paid / Tab" value={`${paidCount} / ${active.length - paidCount}`} />
        </div>

        {/* Progress bars — shown only when there's a goal / a roster to measure */}
        {(fundGoal > 0 || rosterSize > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '15px 20px', borderBottom: `1px solid ${_CPD.lightGray}`, background: _CPD.panel }}>
            {fundGoal > 0 && <Bar label="Fundraising goal" right={<>{_cpMoney0(fundraising)} <span style={{ color: _CPD.textLight, fontWeight: 400 }}>of {_cpMoney0(fundGoal)} · {fundPct}%</span></>} pct={fundPct} from="#1F7A43" to="#2E9455" />}
            {rosterSize > 0 && <Bar label="Roster ordered" right={<>{rosterOrdered} of {rosterSize} <span style={{ color: _CPD.textLight, fontWeight: 400 }}>players · {rosterPct}%</span></>} pct={rosterPct} from={_CPD.navy} to={_CPD.navyTint} />}
          </div>
        )}

        {/* Player order ledger */}
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ ...disp, fontWeight: 800, fontSize: 15, letterSpacing: '.04em', textTransform: 'uppercase', color: _CPD.navy }}>Player Orders <span style={{ color: _CPD.textLight }}>({active.length})</span></div>
            {visibleRows.length > 0 && <button onClick={toggleAll} style={{ ...disp, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, letterSpacing: '.05em', textTransform: 'uppercase', color: _CPD.red, padding: '4px 2px' }}>{allOpen ? 'Collapse all' : 'Expand all'}</button>}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', maxWidth: 360, marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: _CPD.textLight, display: 'inline-flex' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, parent, email or order #…" style={{ width: '100%', padding: '9px 12px 9px 34px', border: `1px solid ${_CPD.midGray}`, borderRadius: 10, fontSize: 14, color: _CPD.text, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
          </div>

          {/* Status filter chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {chipDefs.map(([key, label]) => {
              const on = filter === key; const isBack = key === 'backordered';
              return (
                <button key={key} onClick={() => setFilter(key)} style={{ ...disp, cursor: 'pointer', fontWeight: 700, fontSize: 12, letterSpacing: '.03em', textTransform: 'uppercase', padding: '6px 13px', borderRadius: 999, border: `1px solid ${on ? (isBack ? _CPD.red : _CPD.navy) : _CPD.midGray}`, background: on ? (isBack ? _CPD.red : _CPD.navy) : '#fff', color: on ? '#fff' : (isBack ? _CPD.red : _CPD.navy) }}>{label} <span style={{ opacity: 0.6, ...tnum }}>{countFor(key)}</span></button>
              );
            })}
          </div>

          {active.length === 0 ? <div style={{ padding: '24px 4px', color: _CPD.textLight, fontSize: 14 }}>No orders yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '0 10px 8px', borderBottom: `2px solid ${_CPD.lightGray}` }}>
                <span />
                {['Player', '#', 'Items', 'Paid?', 'Status'].map((h) => <span key={h} style={eyebrow}>{h}</span>)}
              </div>

              {visibleRows.map((row) => (
                <div key={row.id} style={{ borderBottom: `1px solid ${_CPD.lightGray}` }}>
                  <div onClick={() => toggle(row.id)} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '11px 10px', cursor: 'pointer', background: open[row.id] ? _CPD.offWhite : 'transparent' }}>
                    <span style={{ color: _CPD.textLight, fontSize: 12 }}>{open[row.id] ? '▾' : '▸'}</span>
                    <span style={{ fontWeight: 700, color: _CPD.navy, fontSize: 14 }}>{row.player}</span>
                    <span style={{ color: _CPD.text, fontSize: 14, ...tnum }}>{row.number}</span>
                    <span style={{ color: _CPD.text, fontSize: 14, ...tnum }}>{row.items}</span>
                    <span style={{ fontSize: 13, color: row.payColor, fontWeight: 600 }}>{row.paymentLabel}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: row.statusTone, flex: '0 0 auto' }} />
                      <span style={{ ...disp, fontWeight: 700, fontSize: 13, letterSpacing: '.02em', textTransform: 'uppercase', color: row.statusTone }}>{row.statusLabel}</span>
                      {row.hasBack && <span style={{ ...disp, fontWeight: 700, fontSize: 10, letterSpacing: '.03em', textTransform: 'uppercase', color: _CPD.red, background: 'rgba(150,44,50,.10)', border: '1px solid rgba(150,44,50,.25)', padding: '2px 8px', borderRadius: 999 }}>{row.backCount} backordered</span>}
                    </span>
                  </div>

                  {open[row.id] && (
                    <div style={{ padding: '4px 10px 18px' }}>
                      {/* Contact / order meta band */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '13px 16px', background: '#fff', border: `1px solid ${_CPD.lightGray}`, borderRadius: 12, marginBottom: 12 }}>
                        {[['Order', row.no, tnum], ['Ordered', row.date], ['Ordered by', row.buyerName], ['Email', row.buyerEmail ? <a href={`mailto:${row.buyerEmail}`}>{row.buyerEmail}</a> : '—'], ['Phone', row.buyerPhone, tnum], ['Delivery', row.delivery]].map(([lbl, val, extra]) => (
                          <div key={lbl}><div style={{ ...eyebrow, marginBottom: 3 }}>{lbl}</div><div style={{ fontSize: 14, color: _CPD.text, fontWeight: lbl === 'Order' || lbl === 'Ordered by' ? 700 : 400, ...(lbl === 'Order' ? { color: _CPD.navy } : {}), ...(extra || {}) }}>{val}</div></div>
                        ))}
                      </div>

                      {/* Priced line items */}
                      <div style={{ border: `1px solid ${_CPD.lightGray}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: LN, columnGap: 14, padding: '9px 14px', background: _CPD.offWhite, borderBottom: `1px solid ${_CPD.lightGray}` }}>
                          {['Item', 'Size', 'Qty', 'Price', 'Batch', 'Status'].map((h, idx) => <span key={h} style={{ ...eyebrow, ...(idx === 3 ? { textAlign: 'right' } : {}) }}>{h}</span>)}
                        </div>
                        {row.lines.map((ln) => (
                          <div key={ln.id} style={{ display: 'grid', gridTemplateColumns: LN, columnGap: 14, alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${_CPD.lightGray}` }}>
                            <span>
                              <span style={{ fontSize: 13.5, color: _CPD.text, fontWeight: 600 }}>{ln.name}</span>
                              {ln.sku && <span style={{ fontSize: 11.5, color: _CPD.textLight, marginLeft: 6, ...tnum }}>{ln.sku}</span>}
                              {ln.short && <div style={{ fontSize: 12, color: _CPD.red, fontWeight: 600, marginTop: 3 }}>Backordered{ln.backEta ? ` · ETA ${ln.backEta}` : ''}</div>}
                            </span>
                            <span style={{ fontSize: 13, color: _CPD.text, fontWeight: 600 }}>{ln.size}</span>
                            <span style={{ fontSize: 13, color: _CPD.text, ...tnum }}>{ln.qty}</span>
                            <span style={{ fontSize: 13, color: _CPD.text, textAlign: 'right', ...tnum }}>{ln.priceStr}</span>
                            <span style={{ fontSize: 12.5, color: _CPD.textLight, ...tnum }}>{row.soId || <span style={{ color: _CPD.midGray }}>Not batched</span>}</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: ln.statusTone, flex: '0 0 auto' }} /><span style={{ fontSize: 12.5, fontWeight: 600, color: ln.statusTone }}>{ln.statusLabel}</span></span>
                          </div>
                        ))}
                      </div>

                      {/* Fundraising + shipping footer */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '12px 16px', background: '#fff', border: `1px solid ${_CPD.lightGray}`, borderRadius: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ display: 'inline-flex', color: _CPD.green }}>{fundIcon}</span>
                          <span style={{ fontSize: 13, color: _CPD.textLight }}>Fundraising from this order</span>
                          <span style={{ fontSize: 15, color: _CPD.green, fontWeight: 800, ...tnum }}>{row.fundStr}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ display: 'inline-flex', color: _CPD.navy }}>{truckIcon}</span>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13.5, color: _CPD.navy, fontWeight: 700 }}>{row.shipHeadline}</div>
                            <div style={{ fontSize: 12.5, color: _CPD.textLight, ...tnum }}>{row.shipSub} · Ships to {row.shipTo}</div>
                          </div>
                          {row.tracked && <a href={row.trackHref} target={CP_LINK_TARGET} rel="noopener noreferrer" style={{ ...disp, fontWeight: 700, fontSize: 12, letterSpacing: '.05em', textTransform: 'uppercase', color: _CPD.red, border: `1px solid ${_CPD.midGray}`, padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap', textDecoration: 'none' }}>Track ↗</a>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {visibleRows.length === 0 && <div style={{ padding: '24px 10px', textAlign: 'center', color: _CPD.textLight, fontSize: 14 }}>No orders match your search or filter.</div>}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Roster & player links — set up players, hand out links, track who's ordered */}
      <CoachRosterManager store={s} initialRoster={d.roster || []} />
    </div>
  );
}

function CoachPortal({customer,allCustomers,sos,ests,invs:initInvs,REPS,prod,onUpdateInvs,onUpdateSOs,onUpdateEsts,savSOFn,portalSettings}){
  const _portalDisclaimer=portalSettings?.disclaimer||'';
  const[jobView,setJobView]=useState(null);
  const[invView,setInvView]=useState(null);
  const[estView,setEstView]=useState(null);
  const[soView,setSoView]=useState(null);
  const[comment,setComment]=useState('');
  const[contactEdit,setContactEdit]=useState(null);
  const[contactMsg,setContactMsg]=useState('');
  const[updateRequestText,setUpdateRequestText]=useState('');
  const[updateRequestSent,setUpdateRequestSent]=useState(false);
  const[showPay,setShowPay]=useState(null);// null | 'all' | inv object
  const[payLoading,setPayLoading]=useState(false);// loading state for pay button feedback
  const[paySuccess,setPaySuccess]=useState(null);// {amount,fee,invoices,intentId}
  const[receiptEmail,setReceiptEmail]=useState('');// email-receipt recipient (prefilled w/ contact)
  const[receiptStatus,setReceiptStatus]=useState(null);// null|'sending'|'sent'|'error'
  const[invs,setInvs]=useState(initInvs);
  const[lightbox,setLightbox]=useState(null);// url string for lightbox overlay
  const[storeBuilder,setStoreBuilder]=useState(false);// coach self-serve store builder view
  const[adRange,setAdRange]=useState('period');// AD spend dashboard scope: 'period' | 'all'
  const[spendView,setSpendView]=useState(false);// AD Spend & Promo full-screen view
  const[page,setPage]=useState('home');// portal nav: home|orders|roster|store|art|billing|shop
  const[estOpen,setEstOpen]=useState(true);// Orders page: "Estimates to Approve" dropdown open by default
  const[artQuery,setArtQuery]=useState('');const[artDeco,setArtDeco]=useState('all');// Art Locker filters
  const[artView,setArtView]=useState(null);// Art Locker rich viewer: {art, idx}
  const[spendMode,setSpendMode]=useState('all');// dashboard metric: 'all' | 'adidas' (items only)
  const[teamFilter,setTeamFilter]=useState('all');// AD-only: filter Orders/Estimates/Art by sport (sub-customer)
  useEffect(()=>setInvs(initInvs),[initInvs]);
  const isP=!customer.parent_id;
  // ── NSA design tokens — hoisted so detail views (estimate/order/art) theme too ──
  // A sub-team's own colors drive the theme; its parent department's colors only
  // *supplement* the accent. So "Cross Country" keeps its own banner color but
  // still borrows the school's gold — which is what stops a red-only team's
  // accent from falling back to a lightened tint that reads pink.
  const _parentCust=customer.parent_id?(allCustomers||[]).find(c=>c.id===customer.parent_id):null;
  const cpTheme=cpTeamTheme(customer,_parentCust?cpEffectiveFamilies(_parentCust):null);
  const cpMonogram=((customer.name||'').match(/\b[A-Za-z0-9]/g)||[]).slice(0,2).join('').toUpperCase()||'NS';
  // Effective families come from the family picker (school_colors) or, for the
  // ~95% of customers who only filled the "School Colors (Pantone)" card, from
  // their saved Pantone colors — so the portal wears the real team colors.
  const _cpFamilies=cpEffectiveFamilies(customer);
  const _nsaHasColors=_cpFamilies.length>0||(!!_parentCust&&cpEffectiveFamilies(_parentCust).length>0);
  const tPrimary=_nsaHasColors?cpTheme.primary:'#192853';
  const tAccent=_nsaHasColors?cpTheme.accent:'#962C32';
  const tNavyDark=cpShade(tPrimary,-22),tNavyMid=cpShade(tPrimary,8),tNavyTint=cpShade(tPrimary,20);
  const tAccentLight=cpShade(tAccent,26),tAccentSoft=cpShade(tAccent,86);
  // Hero "Team Colors" swatches: the team's actual colors, not the themed
  // primary/accent. Falls back to the theme tokens only when no colors are known.
  const cpSwatches=_cpFamilies.length?_cpFamilies.map(f=>CP_HEX[f]):[tPrimary,tAccent,'#ffffff'];
  const _nsaHash='repeating-linear-gradient(-55deg, rgba(255,255,255,.04) 0 1px, transparent 1px 8px)';
  const _nsaFont="'Source Sans 3',system-ui,sans-serif";
  const _nsaImport="@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Source+Sans+3:wght@400;600;700&display=swap');";
  const subs=isP?allCustomers.filter(c=>c.parent_id===customer.id):[];
  const ids=isP?[customer.id,...subs.map(s=>s.id)]:[customer.id];
  // Logo: use own logo_url, fall back to parent's logo if sub has none set
  // (_parentCust is resolved above with the theme colors).
  const cpLogo=customer.logo_url||(_parentCust&&_parentCust.logo_url)||null;
  // ── Team store presence — drives the conditional "Team Store" nav tab. Lightweight
  // top-level lookup (the full per-store tracking is fetched by <CoachStore/> when the
  // tab is opened). A store earns the tab when the coach should see it: any live/non-draft
  // store, or their own submitted draft awaiting review (mirrors CoachStore's render rule).
  // Parent/athletic-dept accounts track the dept's own store + every sub-team's store;
  // a single team tracks its own + its parent dept's. This same id set gates the nav tab
  // and is passed to <CoachStore/> so the tab's visibility always matches what it renders.
  const cpStoreCustomerIds=(isP?ids:[customer.id,customer.parent_id]).filter(Boolean);
  const[cpStores,setCpStores]=useState([]);
  const _cpStoreKey=cpStoreCustomerIds.join(',');
  useEffect(()=>{let cancel=false;(async()=>{
    const sIds=_cpStoreKey?_cpStoreKey.split(','):[];
    if(!sIds.length){if(!cancel)setCpStores([]);return;}
    const{data}=await supabase.from('coach_webstores').select('id,name,slug,status,created_via,close_at').in('customer_id',sIds);
    if(!cancel)setCpStores(data||[]);
  })();return()=>{cancel=true;};},[_cpStoreKey]);
  const cpVisibleStores=cpStores.filter(s=>s.status!=='archived'&&(s.status!=='draft'||s.created_via==='coach'));
  const hasStore=cpVisibleStores.length>0;
  const openStoreCount=cpStores.filter(s=>s.status==='open').length;
  // Roster orders — invite-gated per customer (Catalog Access → coach_roster), same
  // pattern as coach_ai_builder/coach_livelook/coach_build_orders.
  const hasRoster=!!customer.coach_roster;
  // ── National Team Shop crossover (Coach Crossover, Workstream 1) ──
  // Connect itself has no coach sign-in (the portal is alpha-tag gated), so the
  // one-click handoff keys off a supabaseCoach session — the same isolated
  // coach auth client the Team Shop / Live Look use. undefined = not checked yet.
  const[ntsSession,setNtsSession]=useState(undefined);
  useEffect(()=>{let dead=false;
    supabaseCoach.auth.getSession().then(({data})=>{if(!dead)setNtsSession((data&&data.session)||null);}).catch(()=>{if(!dead)setNtsSession(null);});
    const{data:_ntsSub}=supabaseCoach.auth.onAuthStateChange((_e,s)=>{if(!dead)setNtsSession(s||null);});
    return()=>{dead=true;if(_ntsSub&&_ntsSub.subscription)_ntsSub.subscription.unsubscribe();};
  },[]);
  const[ntsBannerHidden,setNtsBannerHidden]=useState(()=>{try{return localStorage.getItem('cp_nts_banner_dismissed')==='1';}catch{return true;}});
  const[ntsEmail,setNtsEmail]=useState('');
  const[ntsOtpState,setNtsOtpState]=useState('idle');// idle|sending|sent|error
  // Same signInWithOtp pattern as src/teamshop/CoachGate.js / storefront/AdidasInventory.js:
  // isolated supabaseCoach client, emailRedirectTo back to THIS portal URL
  // (incl. ?portal= param — must be allow-listed in Supabase Auth redirects).
  const ntsSendOtp=async()=>{
    const em=ntsEmail.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)||ntsOtpState==='sending')return;
    setNtsOtpState('sending');
    const{error}=await supabaseCoach.auth.signInWithOtp({email:em,options:{emailRedirectTo:window.location.origin+window.location.pathname+window.location.search}});
    setNtsOtpState(error?'error':'sent');
  };
  // Tile click: with a coach session, mint a one-time handoff code (the URL
  // carries ONLY this opaque single-use 60s code — never a session credential)
  // and open the Team Shop signed in; otherwise a plain link. Minting happens
  // inside the click gesture; if window.open comes back blocked, same-tab.
  const openTeamShop=async()=>{
    let href='https://nationalteamshop.com';
    try{
      const{data}=await supabaseCoach.auth.getSession();
      const sess=data&&data.session;
      if(sess){
        const _mint=(withCust)=>fetch('/.netlify/functions/teamshop-handoff',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sess.access_token},body:JSON.stringify(withCust?{action:'mint',customer_id:customer.id}:{action:'mint'})});
        let r=await _mint(true);
        if(r.status===403)r=await _mint(false);// this coach sign-in may not be linked to this portal's customer — hand off without a team preselect
        const b=await r.json().catch(()=>null);
        if(r.ok&&b&&b.code)href='https://nationalteamshop.com/?handoff='+b.code;
      }
    }catch(e){/* fall through to the plain link */}
    try{const w=window.open(href,CP_LINK_TARGET,'noopener');if(!w)window.location.assign(href);}catch(e){window.location.assign(href);}
  };
  // ── Team Shop orders card (Stage 8) — only once a coach session exists
  // (ntsSession above); netlify/functions/teamshop-orders.js 'list' against
  // THIS portal's customer.id, same auth model as the handoff mint. Fetched
  // once per session+customer, not polled — this is a compact recent-orders
  // peek, not a live order desk.
  const[ntsOrders,setNtsOrders]=useState(null);// null = not loaded yet
  useEffect(()=>{let dead=false;
    if(!ntsSession||!customer?.id){setNtsOrders(null);return;}
    (async()=>{
      try{
        const r=await fetch('/.netlify/functions/teamshop-orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ntsSession.access_token},body:JSON.stringify({action:'list',customer_id:customer.id})});
        const b=await r.json().catch(()=>null);
        if(!dead)setNtsOrders(r.ok&&b&&Array.isArray(b.orders)?b.orders:[]);
      }catch(e){if(!dead)setNtsOrders([]);}
    })();
    return()=>{dead=true;};
  },[ntsSession,customer?.id]);
  // Same friendly status vocabulary as src/teamshop/AccountPage.js's
  // statusChipLabel — intentionally a small standalone copy (CoachPortal.js
  // sits outside the teamshop chunk, no shared module between them).
  const ntsStatusLabel=(o)=>statusChipLabel(o); // shared: src/lib/teamshopOrderStatus.js
  const custSOs=sos.filter(s=>ids.includes(s.customer_id));
  const custEsts=ests.filter(e=>ids.includes(e.customer_id));
  // Shared estimate total — sums sizes, falling back to est_qty when there's no
  // strict size breakdown, so list cards match the estimate detail/internal pricing.
  const calcEstTotal=(est)=>{
    const eaf=est.art_files||[];const _eAQ={};
    (est.items||[]).forEach(it=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const q2=_sq>0?_sq:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const sub=(est.items||[]).reduce((a,it)=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=_sq>0?_sq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const _sh=est.shipping_type==='pct'?sub*(est.shipping_value||0)/100:(est.shipping_value||0);
    const _tr=customer?.tax_exempt?0:(customer?.tax_rate||0);
    return sub+_sh+sub*_tr;
  };
  const activeSOs=custSOs.filter(s=>calcSOStatus(s)!=='complete');
  const completedSOs=custSOs.filter(s=>calcSOStatus(s)==='complete');
  // Active orders collapse on the portal — default collapsed for department/parent accounts and
  // long lists (they aggregate every team's orders), expanded for a regular single-team coach.
  const[ordersOpen,setOrdersOpen]=useState(!(isP||activeSOs.length>3));
  const openEstCount=custEsts.filter(e=>e.status==='sent'||e.status==='open').length;
  // ── Art Locker — every design the team has run, gathered from order artwork & mockups.
  // Deduped by art name + decoration; each card tracks which teams/orders used it.
  const artLibrary=(()=>{
    const map=new Map();
    custSOs.forEach(so=>{
      const team=((allCustomers||[]).find(c=>c.id===so.customer_id)||{}).name||customer.name;
      safeArt(so).forEach(af=>{
        const imgs=_filterDisplayable([...Object.values(af.item_mockups||{}).flatMap(a=>a||[]),...(af.mockup_files||[]),...(af.files||[])]);
        const urls=imgs.map(f=>typeof f==='string'?f:((f&&f.url)||'')).filter(u=>u&&isUrl(u));
        if(!urls.length)return;
        const name=af.name||af.logo_name||'Artwork';
        const deco=(af.deco_type||'').replace(/_/g,' ').trim();
        const key=(name+'|'+(af.deco_type||'')).toLowerCase();
        let rec=map.get(key);
        if(!rec){rec={key,name,deco,urls:new Set(),teams:new Set(),orders:new Set(),createdAt:so.created_at||''};map.set(key,rec);}
        urls.forEach(u=>rec.urls.add(u));if(team)rec.teams.add(team);rec.orders.add(so.id);
        if((so.created_at||'')>rec.createdAt)rec.createdAt=so.created_at||rec.createdAt;
      });
    });
    return[...map.values()].map(r=>({...r,urls:[...r.urls],teams:[...r.teams],orders:[...r.orders]})).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  })();
  // Recent (last 30 days) not-yet-converted estimates, surfaced in Active Orders.
  const _estRecentCutoff=Date.now()-30*24*60*60*1000;
  const recentEsts=custEsts.filter(e=>{if(e.status==='converted')return false;const t=new Date(e.created_at).getTime();return isFinite(t)&&t>=_estRecentCutoff;});
  const custInvs=invs.filter(inv=>ids.includes(inv.customer_id));
  const openInvs=custInvs.filter(inv=>inv.status==='open'||inv.status==='partial');
  const paidInvs=custInvs.filter(inv=>inv.status==='paid');
  const totalDue=openInvs.reduce((a,inv)=>a+(inv.total||0)-(inv.paid||0),0);
  const rep=REPS.find(r=>r.id===customer.primary_rep_id);
  const allPortalJobs=[];activeSOs.forEach(so=>{safeJobs(so).forEach(j=>{allPortalJobs.push({...j,so,soMemo:so.memo})})});
  // Resolve CC-pay setting; sub-customers inherit from their parent.
  const _parentForCC=customer.parent_id?(allCustomers||[]).find(c=>c.id===customer.parent_id):null;
  const ccDisabled=!!(customer.disable_cc_pay||(_parentForCC&&_parentForCC.disable_cc_pay));
  // Artwork awaiting coach approval — surface at top of portal. ONLY art a rep actually
  // forwarded (sent_to_coach_at): every artist mockup parks at waiting_approval for
  // INTERNAL rep review first, and listing those here let a coach approve a draft the
  // rep never sent — bypassing the rep-review gate entirely (audit A1).
  const waitingArtJobs=allPortalJobs.filter(j=>j.art_status==='waiting_approval'&&j.sent_to_coach_at);
  const artLabelsP={needs_art:'Art Needed',art_requested:'Art Requested',art_in_progress:'Art In Progress',waiting_approval:'Awaiting Your Approval',production_files_needed:'Art Approved — Waiting',art_complete:'Approved'};
  const prodLabelsP={hold:'On Hold',staging:'In Line',in_process:'In Production',completed:'Done',shipped:'Shipped'};
  const contactEmail=(customer.contacts||[])[0]?.email||'';
  // Invite-gated coach-portal capabilities — set per customer in Catalog Access
  // (CustDetail → Catalog tab). Default off so nothing new shows for everyone.
  const coachAiBuilder=!!customer.coach_ai_builder;
  const coachLivelook=!!customer.coach_livelook;
  const coachBuildOrders=!!customer.coach_build_orders;

  // ── Athletic-director Spend & Promo dashboard data (opt-in via customer.ad_spend_tracking) ──
  // Rolls up the family root (parent_id||id) + every team beneath it. Spend uses calcOrderTotals
  // (products + decoration; shipping & tax excluded). Promo reads the owner's merged periods.
  // Dates are parsed with Date() — order_date/created_at are stored M/D/YYYY, so an ISO string
  // compare would wrongly drop everything from the current-period filter.
  const adData=customer.ad_spend_tracking?(()=>{
    const now=new Date();const y=now.getFullYear();const h1=now.getMonth()<6;
    const period=h1?{start:y+'-01-01',end:y+'-06-30',label:'Jan–Jun '+y}:{start:y+'-07-01',end:y+'-12-31',label:'Jul–Dec '+y};
    const pStart=new Date(period.start+'T00:00:00').getTime();const pEnd=new Date(period.end+'T23:59:59').getTime();
    const parse=v=>{if(!v)return null;let d=new Date(v);if(isNaN(d.getTime()))d=new Date(String(v).replace(' ','T'));return isNaN(d.getTime())?null:d.getTime();};
    const inRange=so=>{if(adRange==='all')return true;const t=parse(so.order_date||so.created_at);return t!=null&&t>=pStart&&t<=pEnd;};
    const adRoot=customer.parent_id||customer.id;
    const adFamily=(allCustomers||[]).filter(c=>c.id===adRoot||c.parent_id===adRoot);
    const deptName=(adFamily.find(c=>c.id===adRoot)||customer).name||'Athletic department';
    const teamCount=adFamily.filter(c=>c.id!==adRoot).length;
    const teams=adFamily.map(c=>{const isDept=c.id===adRoot;const tSOs=(sos||[]).filter(s=>s.customer_id===c.id&&inRange(s));const spend=tSOs.reduce((a,s)=>a+(calcOrderTotals(s).rev||0),0);const adidas=tSOs.reduce((a,s)=>a+(calcAdidasItemSpend(s)||0),0);return{id:c.id,name:c.name||'Team',isDept,spend,adidas,orders:tSOs.length};}).filter(t=>!t.isDept||t.orders>0).sort((a,b)=>b.spend-a.spend);
    const totalSpend=teams.reduce((a,t)=>a+t.spend,0);
    const adidasTotal=teams.reduce((a,t)=>a+t.adidas,0);
    const maxSpend=teams.reduce((a,t)=>Math.max(a,t.spend),0)||1;
    const periods=customer.promo_periods||[];
    const scoped=adRange==='all'?periods:periods.filter(p=>p.period_start===period.start);
    const allocated=scoped.reduce((a,p)=>a+(p.allocated||0),0);
    const used=scoped.reduce((a,p)=>a+(p.used||0),0);
    const remaining=allocated-used;const remainingDisplay=Math.max(0,remaining);const overspent=remaining<0;
    const hasPromo=periods.length>0;
    const usedPct=allocated>0?Math.min(100,Math.round(used/allocated*100)):0;
    const money=n=>'$'+Math.round(n||0).toLocaleString();
    const money2=n=>'$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    return{period,teams,totalSpend,adidasTotal,maxSpend,allocated,used,remaining,remainingDisplay,overspent,hasPromo,deptName,teamCount,usedPct,money,money2};
  })():null;

  // Track portal visit — mark sent documents as viewed by coach
  const _portalTracked=useRef(false);
  useEffect(()=>{
    if(_portalTracked.current)return;_portalTracked.current=true;
    const now=new Date().toLocaleString();
    // Mark estimates with email_status='sent' as viewed
    const sentEsts=custEsts.filter(e=>e.email_status==='sent'&&!e.email_viewed_at);
    if(sentEsts.length&&onUpdateEsts)onUpdateEsts(prev=>prev.map(e=>sentEsts.some(se=>se.id===e.id)?{...e,email_status:'opened',email_viewed_at:now,updated_at:now}:e));
    // Mark SOs with email_status='sent' as viewed
    const sentSOs=custSOs.filter(s=>s.email_status==='sent'&&!s.email_viewed_at);
    if(sentSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>sentSOs.some(ss=>ss.id===s.id)?{...s,email_status:'opened',email_viewed_at:now,updated_at:now}:s));
    // Mark invoices with email_status='sent' as viewed
    const sentInvs=custInvs.filter(i=>i.email_status==='sent'&&!i.email_viewed_at);
    if(sentInvs.length){
      const updater=prev=>prev.map(i=>sentInvs.some(si=>si.id===i.id)?{...i,email_status:'opened',email_viewed_at:now,updated_at:now}:i);
      setInvs(updater);if(onUpdateInvs)onUpdateInvs(updater);
    }
    // Mark job art approvals as viewed when coach opens portal
    const jobSOs=custSOs.filter(s=>safeJobs(s).some(j=>j.sent_to_coach_at&&!j.coach_email_opened_at));
    if(jobSOs.length&&onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>{if(!jobSOs.some(js=>js.id===s.id))return s;const updJobs=safeJobs(s).map(j=>j.sent_to_coach_at&&!j.coach_email_opened_at?{...j,coach_email_opened_at:new Date().toISOString()}:j);return{...s,jobs:updJobs,updated_at:now}}));
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── In-portal Back button ─────────────────────────────────────────────
  // Coaches move around with the menu; a stray browser Back would otherwise
  // drop them out of the portal. Trap Back so it steps back through the portal
  // — close an open estimate/order/detail, then return to the previous page,
  // then Home — only releasing to the browser once we're at Home with nothing
  // open. History state carries no URL change, so the ?portal= param is kept.
  const _cpNavStack=useRef([]);      // pages visited before the current one
  const _cpFromBack=useRef(false);   // set while applying a Back, so it isn't re-recorded
  const _cpBackRef=useRef(()=>false);
  _cpBackRef.current=()=>{
    // 1) close the top-most open detail / overlay
    if(lightbox){setLightbox(null);return true;}
    if(showPay){setShowPay(null);setPayLoading(false);return true;}
    if(contactEdit){setContactEdit(null);return true;}
    if(estView){setEstView(null);return true;}
    if(jobView){setJobView(null);return true;} // artwork proof → back to its order detail (soView stays)
    if(soView){setSoView(null);return true;}   // order detail → back to the page
    if(invView){setInvView(null);return true;}
    if(artView){setArtView(null);return true;}
    if(spendView){setSpendView(false);return true;}
    if(storeBuilder){setStoreBuilder(false);return true;}
    // 2) step back to the previous page, else Home
    if(_cpNavStack.current.length){_cpFromBack.current=true;setPage(_cpNavStack.current.pop());return true;}
    if(page!=='home'){_cpFromBack.current=true;setPage('home');return true;}
    return false;                    // 3) at Home, nothing open — let the browser leave
  };
  // Record forward page changes so Back can retrace them.
  const _cpPrevPage=useRef(page);
  useEffect(()=>{
    if(_cpPrevPage.current!==page){
      if(_cpFromBack.current)_cpFromBack.current=false; // change came from Back — don't record
      else _cpNavStack.current.push(_cpPrevPage.current);
      _cpPrevPage.current=page;
    }
  },[page]);
  // Seed a history buffer on mount and translate Back presses. The seed is
  // guarded by a ref so StrictMode's double-invoke (and any remount) pushes it
  // only once — otherwise an orphan entry makes the first Back from Home a no-op.
  const _cpHistSeeded=useRef(false);
  useEffect(()=>{
    if(!_cpHistSeeded.current){_cpHistSeeded.current=true;try{window.history.pushState({nsaPortal:1},'');}catch{}}
    const onPop=()=>{
      if(_cpBackRef.current()){try{window.history.pushState({nsaPortal:1},'');}catch{}} // handled — re-arm the buffer
      else{window.removeEventListener('popstate',onPop);try{window.history.back();}catch{}} // nothing left — actually leave
    };
    window.addEventListener('popstate',onPop);
    return ()=>window.removeEventListener('popstate',onPop);
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePaymentSuccess=(result)=>{
    // Async methods (ACH/bank, and occasionally cards) come back as 'processing': the payment is
    // submitted but not settled, so we must NOT mark the invoice paid yet — settlement is confirmed
    // later by the Stripe webhook (a few business days for ACH). Just show a pending banner so the
    // buyer isn't falsely told the payment failed.
    if(result.status==='processing'){
      setReceiptEmail(contactEmail||'');setReceiptStatus(null);
      setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices||[],intentId:result.intentId,processing:true});
      setShowPay(null);setInvView(null);setPayLoading(false);
      return;
    }
    // Update invoices locally and in parent (persists to Supabase/localStorage/QB)
    const paidInvIds=result.invoices.map(i=>i.id);
    // Surcharge rate must match what StripePaymentModal actually charged (portalSettings.ccFeePct,
    // default 2.9%). The old code referenced an undefined CC_FEE_PORTAL here, which threw the moment
    // a payment succeeded — so the invoice never got marked paid and the portal hit its error boundary.
    const ccPct=(typeof portalSettings?.ccFeePct==='number'?portalSettings.ccFeePct:0.029);
    const updater=prev=>prev.map(inv=>{
      if(!paidInvIds.includes(inv.id))return inv;
      const bal=(inv.total||0)-(inv.paid||0);
      const fee=Math.round(bal*ccPct*100)/100;
      const newTotal=(inv.total||0)+fee; // CC surcharge added to invoice total
      const newPaid=(inv.paid||0)+bal+fee; // Customer pays balance + fee
      const payment={amount:bal+fee,method:'cc',ref:'Stripe '+result.intentId,date:new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}),cc_fee:fee};
      return{...inv,total:newTotal,paid:newPaid,status:newPaid>=newTotal?'paid':'partial',cc_fee:(inv.cc_fee||0)+fee,payments:[...(inv.payments||[]),payment],updated_at:new Date().toLocaleString()};
    });
    setInvs(updater);
    if(onUpdateInvs)onUpdateInvs(updater);// optimistic UI; the DB write below is what actually persists
    // The public portal is anonymous and RLS-blocks direct invoice writes (the parent save above fails
    // with 401 by design), so reconcile server-side: a Netlify function re-verifies the charge with
    // Stripe and marks the invoice paid via the service role. The webhook is a secondary backstop.
    if(result.intentId)fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize_invoice',payment_intent_id:result.intentId}),keepalive:true}).catch(()=>{});
    setReceiptEmail(contactEmail||'');setReceiptStatus(null);
    setPaySuccess({amount:result.amount,fee:result.fee,invoices:result.invoices,intentId:result.intentId});
    setShowPay(null);setInvView(null);setPayLoading(false);
  };

  // Email a full itemized receipt for the just-completed payment. Content is built server-side from
  // our own DB + Stripe (see netlify/functions/receipt.js), so the client only passes the intent id
  // and a recipient address — it can't dictate what the receipt says.
  const sendReceipt=async()=>{
    const email=(receiptEmail||'').trim();
    if(!paySuccess?.intentId)return;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){setReceiptStatus('error');return;}
    setReceiptStatus('sending');
    try{
      const resp=await fetch('/.netlify/functions/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payment_intent_id:paySuccess.intentId,email})});
      setReceiptStatus(resp.ok?'sent':'error');
    }catch(e){setReceiptStatus('error');}
  };

  // Finalize a payment that came back via a Stripe redirect (3-D Secure, wallets, etc.).
  // StripeCheckoutForm confirms with redirect:'if_required' and return_url = this page, so when a
  // redirect IS required the buyer lands back here with ?payment_intent..&redirect_status=.. in the
  // URL and the in-page onSuccess never fired. Retrieve the intent with the publishable key (read-only,
  // safe in the public portal) and run the same finalize, so the invoice updates and the buyer sees a
  // result instead of a stale "due". The webhook reconciles server-side too; both paths are idempotent.
  const _payReturnHandled=useRef(false);
  useEffect(()=>{
    if(_payReturnHandled.current)return;
    const params=new URLSearchParams(window.location.search);
    const clientSecret=params.get('payment_intent_client_secret');
    const redirectStatus=params.get('redirect_status');
    if(!clientSecret||!redirectStatus)return;
    _payReturnHandled.current=true;
    const cleanUrl=()=>{try{const u=new URL(window.location.href);['payment_intent','payment_intent_client_secret','redirect_status','source_type'].forEach(k=>u.searchParams.delete(k));window.history.replaceState({},document.title,u.pathname+u.search+u.hash);}catch(e){/* noop */}};
    (async()=>{
      try{
        let pk=(typeof process!=='undefined'&&process.env&&process.env.REACT_APP_STRIPE_PK)||'';
        if(!pk){const cfg=await fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'config'})}).then(r=>r.json()).catch(()=>({}));pk=cfg&&cfg.publishableKey;}
        if(!pk)return;
        const stripe=await loadStripe(pk);
        if(!stripe)return;
        const{paymentIntent}=await stripe.retrievePaymentIntent(clientSecret);
        if(!paymentIntent)return;
        if(paymentIntent.status==='succeeded'){
          const ids=String(paymentIntent.metadata?.invoice_id||'').split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
          const matched=custInvs.filter(inv=>ids.includes(inv.id));
          const collected=(paymentIntent.amount||0)/100;
          if(matched.length){
            const balTotal=matched.reduce((a,inv)=>a+Math.max(0,(inv.total||0)-(inv.paid||0)),0);
            handlePaymentSuccess({intentId:paymentIntent.id,amount:balTotal,fee:Math.max(0,Math.round((collected-balTotal)*100)/100),invoices:matched,status:'succeeded'});
          }else{
            // Invoices not loaded into this view — reconcile server-side directly, then confirm.
            fetch('/.netlify/functions/stripe-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize_invoice',payment_intent_id:paymentIntent.id}),keepalive:true}).catch(()=>{});
            setReceiptEmail(contactEmail||'');setReceiptStatus(null);
            setPaySuccess({amount:collected,fee:0,invoices:[],intentId:paymentIntent.id});
          }
        }else if(paymentIntent.status==='processing'){
          setReceiptEmail(contactEmail||'');setReceiptStatus(null);
          setPaySuccess({amount:(paymentIntent.amount||0)/100,fee:0,invoices:[],intentId:paymentIntent.id,processing:true});
        }
        // failed / requires_payment_method: the modal already showed an error before the redirect.
      }catch(e){/* best-effort; the webhook is the source of truth */}
      finally{cleanUrl();}
    })();
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single source of truth for the payment modal. Each portal view (estimate/job/invoice/main) is its
  // own early return, so the modal must be rendered in every view that can launch it — not just the
  // main one. Previously it lived only in the main return, so tapping "Pay" from an opened invoice set
  // showPay but never mounted the modal: the button just span on "Opening secure checkout…" forever.
  const payModalEl = showPay ? <StripePaymentModal
    invoices={showPay==='all'?openInvs:[showPay]}
    customerName={customer.name}
    customerEmail={contactEmail}
    alphaTag={customer.alpha_tag}
    feePct={typeof portalSettings?.ccFeePct==='number'?portalSettings.ccFeePct:undefined}
    paymentNote={portalSettings?.paymentNote||''}
    onSuccess={handlePaymentSuccess}
    onClose={()=>{setShowPay(null);setPayLoading(false)}}
  /> : null;

  // Estimate detail view
  if(estView){
    const est=estView;
    const eaf=safeArt(est);const _eAQ={};(est.items||[]).forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_eAQ[d.art_file_id]=(_eAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const estSubtotal=(est.items||[]).reduce((a,it)=>{const sqq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qq=sqq>0?sqq:safeNum(it.est_qty);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qq;const dp2=dP(d,qq,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const estShip=est.shipping_type==='pct'?estSubtotal*(est.shipping_value||0)/100:(est.shipping_value||0);
    const estTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const estTax=estSubtotal*estTaxRate;
    const estTotal=estSubtotal+estShip+estTax;
    const canApprove=est.status==='sent'||est.status==='open';
    // Generate printable estimate PDF — uses shared printDoc for consistent style
    const downloadEstPdf=()=>{
      const _$=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const rows=[];const eTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
      (est.items||[]).forEach((it,i)=>{
        const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const lineTotal=qty*safeNum(it.unit_sell);
        const szText=Object.entries(safeSizes(it)).filter(([,v])=>v>0).map(([sz,q])=>sz+':'+q).join(' ');
        let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'')+(szText?'<br/><span style="color:#555">'+szText+'</span>':'');
        if(it.notes&&String(it.notes).trim())itemName+='<br/><span style="color:#854d0e;font-style:italic">'+String(it.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
        rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(safeNum(it.unit_sell)),style:'text-align:right'},{value:_$(lineTotal),style:'text-align:right;font-weight:600'}]});
        safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoAmt=eq2*dp2.sell;
          const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors2=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
          const decoType2=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel2=decoType2?decoType2.replace(/_/g,' '):'';
          const colorCount2=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors2;const stitchCount2=safeNum(d.stitches)||safeNum(d.tbd_stitches);
          const decoDetail2=decoType2==='embroidery'&&stitchCount2?stitchCount2.toLocaleString()+' stitches':colorCount2?colorCount2+' color'+(colorCount2>1?'s':''):'';
          const label=d.kind==='numbers'?'Numbers — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names — '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel2||d.position||'Decoration')+(decoDetail2?' — '+decoDetail2:'')+(decoTypeLabel2&&d.position?' — '+d.position:'');
          rows.push({cells:[{value:eq2,style:'text-align:center;color:#888'},{value:'',style:''},{value:'<span style="padding-left:16px;color:#666">'+label+'</span>'},{value:_$(dp2.sell),style:'text-align:right;color:#888'},{value:_$(decoAmt),style:'text-align:right;color:#888'}]});
        });
      });
      const eBillAddr=customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':(customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':'');
      printDoc({
        title:customer?.name||'Customer',docNum:est.id,docType:'ESTIMATE',
        headerRight:'<div class="ta">'+_$(estTotal)+'</div><div class="ts">Expires: '+new Date(Date.now()+30*86400000).toLocaleDateString()+'</div>',
        infoBoxes:[
          {label:'Bill To',value:customer?.name||'—',sub:eBillAddr||''},
          {label:'Expires',value:new Date(Date.now()+30*86400000).toLocaleDateString()},
          {label:'Sales Rep',value:rep?.name||'—'},
          {label:'Estimate',value:est.id},
          {label:'Memo',value:est.memo||'—'},
        ],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
          rows:[...rows,
            {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'},{value:'<strong>'+_$(estSubtotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:6px'}]},
            ...(estShip>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(estShip),style:'text-align:right;border:none'}]}]:[]),
            ...(estTax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax ('+(estTaxRate*100).toFixed(2)+'%)</strong>',style:'text-align:right;border:none'},{value:_$(estTax),style:'text-align:right;border:none'}]}]:[]),
            {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong>'+_$(estTotal)+'</strong>',style:'text-align:right'}]},
          ]}],
        footer:'This estimate is valid for 30 days. Prices subject to change. '+NSA.depositTerms
      });
    };
    const _estStatusPill=est.status==='approved'?['Approved','#1F7A43','#E8F5EC']:est.status==='converted'?['Converted to Order','#1A3A6B','#E6ECF5']:['Open',tAccent,tAccentSoft];
    return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:_nsaFont,color:'#2A2F3E',display:'flex',justifyContent:'center',padding:'32px 16px'}}>
      <style>{_nsaImport+`.nsa-disp{font-family:'Barlow Condensed',sans-serif}.nsa-skew{transform:skewX(-3deg)}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}`}</style>
      <div style={{width:'100%',maxWidth:660}}>
        <button className="nsa-disp" onClick={()=>setEstView(null)} style={{display:'inline-flex',alignItems:'center',gap:8,background:'#fff',border:'1px solid #EEF1F6',color:tPrimary,fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 16px',borderRadius:4,cursor:'pointer',marginBottom:16,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>← Back to Estimates</button>
        <div style={{background:'#fff',borderRadius:8,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{position:'relative',overflow:'hidden',padding:'28px 28px 24px',color:'#fff',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 60%, ${tNavyMid} 100%)`}}>
          <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:0,right:0,width:120,height:'100%',background:tAccent,opacity:.9,clipPath:'polygon(38% 0, 100% 0, 100% 100%, 0 100%)'}}/>
          <div style={{position:'relative'}}>
            <div className="nsa-disp" style={{fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Estimate</div>
            <div className="nsa-disp" style={{fontWeight:800,fontSize:34,textTransform:'uppercase',lineHeight:1.02,marginTop:2}}>{est.memo||est.id}</div>
            <div style={{width:60,height:4,background:tAccentLight,transform:'skewX(-12deg)',margin:'10px 0 8px'}}/>
            <div style={{fontSize:13,color:'rgba(255,255,255,.8)'}}>{est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
          </div>
        </div>
        <div style={{padding:'22px 28px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap',padding:'4px 0 18px',borderBottom:'1px solid #EEF1F6',marginBottom:18}}>
            <div>
              <div className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0'}}>Estimated Total</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:44,color:tPrimary,lineHeight:1}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:_estStatusPill[2],color:_estStatusPill[1],fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 12px',borderRadius:4,marginTop:8}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{_estStatusPill[0]}</span></span>
            </div>
            <button className="nsa-disp" onClick={downloadEstPdf} style={{background:'#fff',color:tPrimary,border:`2px solid ${tPrimary}`,borderRadius:4,padding:'11px 18px',fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}}>📄 Download PDF</button>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Items</div>
          {(est.items||[]).map((it,i)=>{const _sq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);const qty=_sq>0?_sq:safeNum(it.est_qty);const lineTotal=qty*safeNum(it.unit_sell);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0).sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);decoTotal+=qty*dp2.sell});
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'} {it.brand&&'· '+it.brand}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:14,color:'#1e3a5f'}}>${(lineTotal+decoTotal).toFixed(2)}</div>
                  <div style={{fontSize:10,color:'#64748b'}}>{qty} × ${safeNum(it.unit_sell).toFixed(2)}</div>
                </div>
              </div>
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
                {sizes.map(([sz,q])=>{const avail=(it.size_availability||{})[sz];return<div key={sz} style={{textAlign:'center',padding:'3px 6px',background:avail?'#fffbeb':'#f8fafc',borderRadius:5,minWidth:32,border:avail?'1px solid #fde68a':'none'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:12,fontWeight:800,color:'#1e3a5f'}}>{q}</div>
                  {avail&&<div style={{fontSize:8,color:'#92400e',fontWeight:600,whiteSpace:'nowrap'}}>Avail {new Date(avail+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}
                </div>})}
              </div>}
              {(()=>{const sa=it.size_availability||{};const delayed=Object.entries(sa).filter(([sz,d])=>d&&(it.sizes||{})[sz]>0);
                if(delayed.length===0)return null;
                return<div style={{fontSize:10,color:'#92400e',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:5,padding:'4px 8px',marginBottom:6}}>
                  ⏳ Some sizes available later: {delayed.map(([sz,d])=>sz+' ('+new Date(d+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})+')').join(', ')}
                </div>})()}
              {safeDecos(it).length>0&&<div style={{fontSize:11,color:'#64748b',borderTop:'1px solid #f1f5f9',paddingTop:4}}>
                {safeDecos(it).map((d,di)=>{const cq=d.kind==='art'&&d.art_file_id?_eAQ[d.art_file_id]:qty;const dp2=dP(d,qty,eaf,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoLine=eq2*dp2.sell;
                  const artF2=d.art_file_id?eaf.find(a2=>a2.id===d.art_file_id):null;const artColors=artF2?.ink_colors?artF2.ink_colors.split('\n').filter(l=>l.trim()).length:0;
                  const decoType=d.deco_type||artF2?.deco_type||d.art_tbd_type||'';const decoTypeLabel=decoType?decoType.replace(/_/g,' '):'';
                  const colorCount=safeNum(d.colors)||safeNum(d.tbd_colors)||artColors;const stitchCount=safeNum(d.stitches)||safeNum(d.tbd_stitches);
                  const decoDetail=decoType==='embroidery'&&stitchCount?stitchCount.toLocaleString()+' stitches':colorCount?colorCount+' color'+(colorCount>1?'s':''):'';
                  const decoLabel=d.kind==='numbers'?'Numbers · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):d.kind==='names'?'Names · '+(d.position||'')+(d.front_and_back?' (Front + Back)':''):(decoTypeLabel||d.position||'Decoration')+(decoDetail?' · '+decoDetail:'')+(decoTypeLabel&&d.position?' · '+d.position:'');
                  return<div key={di} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{d.kind==='numbers'?'#️⃣':d.kind==='names'?'🏷️':'🎨'} {decoLabel}</span>{decoLine>0&&<span style={{fontWeight:600}}>{eq2} × ${dp2.sell.toFixed(2)}/ea = +${decoLine.toFixed(2)}</span>}</div>})}
              </div>}
            </div>})}
          <div style={{borderTop:'1px solid #EEF1F6',paddingTop:14,marginBottom:18}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Subtotal</span><span style={{fontWeight:700,color:'#2A2F3E'}}>${estSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {estShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Shipping</span><span>${estShip.toFixed(2)}</span></div>}
            {estTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Tax ({(estTaxRate*100).toFixed(2)}%)</span><span>${estTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'12px 0 4px',borderTop:`2px solid ${tPrimary}`,marginTop:8}}>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Estimated Total</span><span className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary}}>${estTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {canApprove&&<button id="est-approve-btn" className="nsa-skew nsa-disp" style={{width:'100%',padding:'15px 20px',background:tAccent,color:'white',border:'none',borderRadius:4,fontSize:17,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer',marginBottom:10}} onClick={async()=>{
            const _approvedAt=new Date().toISOString();const _updatedAt=new Date().toLocaleString();
            // Email the assigned rep when coach approves estimate. Fall back to the
            // customer's primary rep, then a monitored admin inbox, so a rep missing
            // an email on file never silently swallows the approval notification.
            const _apprRep=REPS.find(r=>r.id===est.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
            const _apprTo=_apprRep?.email||'steve@nationalsportsapparel.com';
            const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
            // Persist via the serverless endpoint — the public portal's anon role can't write under RLS
            const _res=await _portalAction({alphaTag:customer.alpha_tag,
              estimates:[{id:est.id,status:'approved',approved_by:'Coach',approved_at:_approvedAt,updated_at:_updatedAt}],
              email:{to:[{email:_apprTo}],cc:_accCc,subject:'✅ Estimate approved by coach — '+(est.memo||est.id)+' ('+est.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved estimate <strong>'+est.id+'</strong>'+(est.memo?' — '+est.memo:'')+'.</p><p>This estimate is ready to be converted to a sales order.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?est='+est.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Estimate '+est.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:_apprRep?.email?{email:_apprRep.email,name:_apprRep.name}:undefined},
            });
            // Server FIRST — portal-action only lands the approval on an estimate still
            // awaiting one (H1 estimate guard); local state flips after it commits, so a
            // stale tab shows the server's conflict message, never a phantom approval.
            if(!_res.ok){alert('Could not save your approval — please try again or contact your rep.\n\n'+(_res.error||''));return}
            const _approvedEst={...est,status:'approved',approved_by:'Coach',approved_at:_approvedAt,updated_at:_updatedAt};
            if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_approvedEst:e))}
            setEstView({...est,status:'approved'});
          }}><span>✅ Approve This Estimate</span></button>}
          {canApprove&&<div id="est-request-box" style={{border:'1px solid #EEF1F6',borderRadius:6,padding:18,marginBottom:10,background:'#F7F8FB'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#1e3a5f',marginBottom:8}}>Need changes? Request updates from your rep</div>
            {updateRequestSent?<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:600}}>Your update request has been sent to your rep!</div>
            :<>
              <textarea style={{width:'100%',border:'1px solid #d1d5db',borderRadius:8,padding:10,fontSize:13,resize:'vertical',minHeight:60,fontFamily:'inherit',boxSizing:'border-box'}} placeholder="Tell your rep what you'd like changed (sizes, items, pricing, etc.)..." value={updateRequestText} onChange={e=>setUpdateRequestText(e.target.value)} rows={3}/>
              <button style={{width:'100%',marginTop:8,padding:'12px 20px',background:updateRequestText.trim()?'#d97706':'#e5e7eb',color:updateRequestText.trim()?'white':'#9ca3af',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:updateRequestText.trim()?'pointer':'not-allowed'}} disabled={!updateRequestText.trim()} onClick={async()=>{
                if(!updateRequestText.trim())return;
                const _reqText=updateRequestText.trim();
                const req={id:'UR-'+Date.now(),text:_reqText,from:'Coach',at:new Date().toISOString(),status:'pending'};
                const _newReqs=[...(est.update_requests||[]),req];const _updatedAt=new Date().toLocaleString();
                // Notify the assigned rep that the coach requested changes
                const _urRep=REPS.find(r=>r.id===est.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                const _safeText=_reqText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');
                // Persist via the serverless endpoint — the public portal's anon role can't write under RLS
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  estimates:[{id:est.id,update_requests:_newReqs,updated_at:_updatedAt}],
                  email:_urRep?.email?{to:[{email:_urRep.email}],cc:_accCc,subject:'📝 Estimate update requested by coach — '+(est.memo||est.id)+' ('+est.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p><strong>'+customer.name+'</strong> requested changes to estimate <strong>'+est.id+'</strong>'+(est.memo?' — '+est.memo:'')+'.</p><div style="margin:12px 0;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#78350f"><div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:4px">Coach\'s request</div>'+_safeText+'</div><p>Please update the estimate and resend it to the coach.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?est='+est.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Estimate '+est.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',replyTo:{email:_urRep.email,name:_urRep.name}}:undefined,
                });
                if(!_res.ok){alert('Could not send your request — please try again or contact your rep.\n\n'+(_res.error||''));return}
                // Local state flips only after the server write commits — no phantom request.
                const _updatedEst={...est,update_requests:_newReqs,updated_at:_updatedAt};
                if(onUpdateEsts){onUpdateEsts(prev=>prev.map(e=>e.id===est.id?_updatedEst:e))}
                setEstView({...est,update_requests:_newReqs});
                setUpdateRequestText('');setUpdateRequestSent(true);
              }}>Request Updates</button>
            </>}
          </div>}
          {(est.update_requests||[]).length>0&&<div style={{border:'1px solid #fde68a',background:'#fffbeb',borderRadius:10,padding:14,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:'#92400e',marginBottom:8}}>Update Requests</div>
            {(est.update_requests||[]).map((req,ri)=><div key={ri} style={{padding:'8px 0',borderBottom:ri<(est.update_requests||[]).length-1?'1px solid #fde68a':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:600,color:'#92400e'}}>{req.from}</span>
                <span style={{fontSize:10,color:'#b45309'}}>{new Date(req.at).toLocaleDateString()}</span>
              </div>
              <div style={{fontSize:12,color:'#78350f',marginTop:2}}>{req.text}</div>
              <span style={{fontSize:10,padding:'1px 6px',borderRadius:6,fontWeight:600,background:req.status==='completed'?'#dcfce7':req.status==='in_progress'?'#dbeafe':'#fef3c7',color:req.status==='completed'?'#166534':req.status==='in_progress'?'#1e40af':'#92400e'}}>{req.status==='completed'?'Done':req.status==='in_progress'?'In Progress':'Pending'}</span>
            </div>)}
          </div>}
          {est.status==='approved'&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Approved — your rep will convert this to an order</div>}
          {est.status==='converted'&&<div style={{textAlign:'center',padding:12,background:'#dbeafe',borderRadius:8,color:'#1e40af',fontWeight:700}}>📦 This estimate has been converted to an active order</div>}
          {canApprove&&<div style={{height:64}}/>}
        </div>
      </div>
      </div>
      {/* Sticky action bar — keeps Approve / Request changes reachable on long estimates without forcing the coach to commit before reviewing the items above */}
      {canApprove&&<div style={{position:'fixed',left:0,right:0,bottom:0,display:'flex',justifyContent:'center',padding:'10px 16px',background:'rgba(255,255,255,0.92)',backdropFilter:'blur(6px)',borderTop:'1px solid #EEF1F6',boxShadow:'0 -2px 12px rgba(0,0,0,0.06)',zIndex:50}}>
        <div style={{width:'100%',maxWidth:660,display:'flex',gap:10}}>
          <button className="nsa-disp" style={{flex:1,padding:'13px 16px',background:'#fff',color:tAccent,border:`2px solid ${tAccent}`,borderRadius:4,fontSize:14,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}} onClick={()=>document.getElementById('est-request-box')?.scrollIntoView({behavior:'smooth',block:'center'})}>✏️ Request changes</button>
          <button className="nsa-skew nsa-disp" style={{flex:1,padding:'13px 16px',background:tAccent,color:'#fff',border:'none',borderRadius:4,fontSize:14,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',cursor:'pointer'}} onClick={()=>document.getElementById('est-approve-btn')?.scrollIntoView({behavior:'smooth',block:'center'})}><span>✅ Approve</span></button>
        </div>
      </div>}
    </div>
  }

  // Order detail view (skip if jobView is active — artwork cards set jobView while soView is still set)
  if(soView&&!jobView){
    const so=soView;
    const soAF=safeArt(so);
    const _soAQ={};safeItems(so).forEach(it=>{const q2=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_soAQ[d.art_file_id]=(_soAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
    const soSubtotal=safeItems(so).reduce((a,it)=>{const qq=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);let r=qq*safeNum(it.unit_sell);safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qq;const dp2=dP(d,qq,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qq*2:qq);r+=eq2*dp2.sell});return a+r},0);
    const soShip=so.shipping_type==='pct'?soSubtotal*(so.shipping_value||0)/100:(so.shipping_value||0);
    const soTaxRate=customer?.tax_exempt?0:(customer?.tax_rate||0);
    const soTax=soSubtotal*soTaxRate;
    const soTotal=soSubtotal+soShip+soTax;
    let soTotalU=0,soFulU=0;
    safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{soTotalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);soFulU+=Math.min(v,pQ+rQ)})});
    const soPct=soTotalU>0?Math.round(soFulU/soTotalU*100):0;
    const soDaysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
    const soJobsList=safeJobs(so);
    const soShipments=so._shipments||[];
    const soLegacy=so._tracking_number&&!soShipments.find(s=>s.tracking_number===so._tracking_number);
    const soAllShipments=soLegacy?[{tracking_number:so._tracking_number,carrier:so._carrier||'',ship_date:so._ship_date||'',tracking_url:so._tracking_url||''},...soShipments]:soShipments;
    const _soSt=calcSOStatus(so);const _soStMap={complete:['Delivered','#5A6075','#EEF1F6'],shipped:['Shipped','#1F7A43','#E8F5EC'],bagging:['Bagging',tPrimary,'#E6ECF5'],in_production:['In Production',tPrimary,'#E6ECF5'],received:['Received',tPrimary,'#E6ECF5'],pending:['Ordered','#5A6075','#EEF1F6']};
    const _soSm=_soStMap[_soSt]||['Ordered','#5A6075','#EEF1F6'];
    return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:_nsaFont,color:'#2A2F3E',display:'flex',justifyContent:'center',padding:'32px 16px'}}>
      <style>{_nsaImport+`.nsa-disp{font-family:'Barlow Condensed',sans-serif}.nsa-skew{transform:skewX(-3deg)}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}`}</style>
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:660}}>
        <button className="nsa-disp" onClick={()=>setSoView(null)} style={{display:'inline-flex',alignItems:'center',gap:8,background:'#fff',border:'1px solid #EEF1F6',color:tPrimary,fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 16px',borderRadius:4,cursor:'pointer',marginBottom:16,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>← Back to Orders</button>
        <div style={{background:'#fff',borderRadius:8,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        {/* NSA hero */}
        <div style={{position:'relative',overflow:'hidden',padding:'28px 28px 24px',color:'#fff',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 60%, ${tNavyMid} 100%)`}}>
          <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:0,right:0,width:120,height:'100%',background:tAccent,opacity:.9,clipPath:'polygon(38% 0, 100% 0, 100% 100%, 0 100%)'}}/>
          <div style={{position:'relative'}}>
            <div className="nsa-disp" style={{fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Order</div>
            <div className="nsa-disp" style={{fontWeight:800,fontSize:34,textTransform:'uppercase',lineHeight:1.02,marginTop:2}}>{so.memo||so.id}</div>
            <div style={{width:60,height:4,background:tAccentLight,transform:'skewX(-12deg)',margin:'10px 0 8px'}}/>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div style={{fontSize:13,color:'rgba(255,255,255,.8)'}}>{so.id}{so.created_at?' · '+so.created_at.split(' ')[0]:''}{so.expected_date?' · ETA '+so.expected_date:''}</div>
              <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:'rgba(0,0,0,.25)',color:'#fff',fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'3px 10px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{_soSm[0]}</span></span>
            </div>
          </div>
        </div>
        <div style={{padding:'22px 28px'}}>
          {/* Progress bar */}
          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <span className="nsa-disp" style={{fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'#5A6075'}}>Order Progress</span>
              <span className="nsa-disp" style={{fontSize:14,fontWeight:800,color:soPct>=100?'#1F7A43':tPrimary}}>{soPct}%</span>
            </div>
            <div style={{background:'#EEF1F6',borderRadius:999,height:7,overflow:'hidden'}}>
              <div style={{height:7,borderRadius:999,background:soPct>=100?'#1F7A43':tPrimary,width:soPct+'%',transition:'width 0.4s'}}/>
            </div>
            {soDaysOut!=null&&<div style={{fontSize:12,color:soDaysOut<=7?tAccent:'#94A0B0',marginTop:5,textAlign:'right',fontWeight:600}}>{soDaysOut>0?soDaysOut+' day'+(soDaysOut!==1?'s':'')+' out':soDaysOut===0?'Due today':'Overdue'}</div>}
          </div>
          {/* Section label */}
          <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Items</div>
          {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
            let recvQ=0;Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);recvQ+=Math.min(v,pQ+rQ)});
            let decoTotal=0;safeDecos(it).forEach(d=>{const cq=d.kind==='art'&&d.art_file_id?_soAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soAF,cq);const eq2=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);decoTotal+=eq2*dp2.sell});
            const lineTotal=qty*safeNum(it.unit_sell)+decoTotal;
            const _prd=(prod||[]).find(pp=>pp.id===it.product_id||pp.sku===it.sku);
            const itImg=_prd?.image_url||(_prd?.images&&_prd.images[0])||it._colorImage||'';
            const recvPct=qty>0?Math.round(recvQ/qty*100):0;
            return<div key={ii} style={{border:'1px solid #EEF1F6',borderLeft:`4px solid ${tPrimary}`,borderRadius:6,padding:'14px 16px',marginBottom:10,background:'#fff'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div style={{flex:1,display:'flex',gap:12,alignItems:'center'}}>
                  {itImg&&isUrl(itImg)?<img src={itImg} alt={safeStr(it.name)||'Item'} title="Click to enlarge" onClick={()=>setLightbox(itImg)} style={{width:52,height:52,objectFit:'cover',borderRadius:6,border:'1px solid #EEF1F6',flexShrink:0,cursor:'zoom-in'}}/>
                  :<div style={{width:52,height:52,background:'#F7F8FB',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:'1px solid #EEF1F6'}}><div style={{fontSize:22}}>👕</div></div>}
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.05}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{it.sku} · {safeStr(it.color)||'—'}{it.brand?' · '+it.brand:''}</div>
                  </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div className="nsa-disp" style={{fontWeight:800,fontSize:18,color:tPrimary}}>${lineTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:12,color:'#94A0B0'}}>{qty} units</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
                <div style={{flex:1,background:'#EEF1F6',borderRadius:999,height:5,overflow:'hidden'}}>
                  <div style={{height:5,borderRadius:999,background:recvQ>=qty?'#1F7A43':tPrimary,width:recvPct+'%',transition:'width .4s'}}/>
                </div>
                <span style={{fontSize:12,fontWeight:600,color:recvQ>=qty?'#1F7A43':'#94A0B0',whiteSpace:'nowrap'}}>{recvQ} of {qty} received</span>
              </div>
              {(()=>{const _szList=Object.entries(safeSizes(it)).filter(([,v])=>safeNum(v)>0).sort((a,b)=>(SZ_ORD.indexOf(a[0])<0?99:SZ_ORD.indexOf(a[0]))-(SZ_ORD.indexOf(b[0])<0?99:SZ_ORD.indexOf(b[0])));
                if(_szList.length===0)return null;
                return<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:10}}>
                  {_szList.map(([sz,sq])=><div key={sz} style={{textAlign:'center',padding:'4px 10px',background:'#F7F8FB',borderRadius:4,minWidth:36,border:'1px solid #EEF1F6'}}>
                    <div className="nsa-disp" style={{fontSize:9,fontWeight:700,color:'#94A0B0',letterSpacing:'.5px'}}>{sz}</div>
                    <div className="nsa-disp" style={{fontSize:14,fontWeight:800,color:tPrimary}}>{sq}</div>
                  </div>)}
                </div>})()}
            </div>})}
          {/* Order totals */}
          <div style={{borderTop:'1px solid #EEF1F6',paddingTop:14,marginBottom:18,marginTop:6}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Subtotal</span><span style={{fontWeight:700,color:'#2A2F3E'}}>${soSubtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            {soShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Shipping</span><span>${soShip.toFixed(2)}</span></div>}
            {soTax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:14,color:'#5A6075'}}><span>Tax ({(soTaxRate*100).toFixed(2)}%)</span><span>${soTax.toFixed(2)}</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'12px 0 4px',borderTop:`2px solid ${tPrimary}`,marginTop:8}}>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Total</span>
              <span className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary}}>${soTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
          </div>
          {/* Artwork & Decoration jobs */}
          {soJobsList.length>0&&<>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Artwork &amp; Decoration</div>
            {soJobsList.map(j=>{const artFile=soAF.find(a=>a.id===j.art_file_id);const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));(j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);
              const _jSkus=new Set((j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return it?.sku||gi.sku}).filter(Boolean));
              const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus.has(k.split('|')[0])).flatMap(([,arr])=>arr||[])));
              const _jMf=_jIm.length===0?_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[])):[];
              const _jSeen=new Set();const mockups=[..._jIm,..._jMf].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_jSeen.has(u))return false;_jSeen.add(u);return true});
              const _clickJob=()=>{setJobView({job:j,so});setComment('');if(j.sent_to_coach_at&&!j.coach_email_opened_at){const liveSO2=sos.find(s=>s.id===so.id);if(liveSO2){const updSO2={...liveSO2,jobs:(liveSO2.jobs||safeJobs(liveSO2)).map(jj=>jj.id===j.id?{...jj,coach_email_opened_at:new Date().toISOString()}:jj),updated_at:new Date().toLocaleString()};if(savSOFn)savSOFn(updSO2);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO2:s))}}};
              const _jWait=j.art_status==='waiting_approval';
              return<div key={j.id} style={{border:`1px solid ${_jWait?tAccent:'#EEF1F6'}`,background:_jWait?tAccentSoft:'#F7F8FB',borderRadius:6,marginBottom:8,overflow:'hidden',cursor:'pointer'}} onClick={_clickJob}>
                {mockups.length>0&&<div style={{display:'grid',gridTemplateColumns:mockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#EEF1F6'}}>
                  {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);const isPdf=_isPdfUrl(url,f);const pdfThumb=isPdf?_cloudinaryPdfThumb(url):null;
                    return<div key={fi} style={{background:'white'}}>
                      {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                      :isPdf&&pdfThumb?<img src={pdfThumb} alt="" style={{width:'100%',height:mockups.length>1?140:200,objectFit:'contain',display:'block',background:'#fafafa'}} onError={e=>{e.target.style.display='none'}}/>
                      :<div style={{height:mockups.length>1?140:200,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                    </div>})}
                </div>}
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px'}}>
                  <div style={{flex:1}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary}}>{j.art_name}</div>
                    <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{j.deco_type?.replace(/_/g,' ')} · {j.positions} · {(j.items||[]).length} garment{(j.items||[]).length!==1?'s':''}</div>
                  </div>
                  <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#E8F5EC':_jWait?tAccentSoft:'#EEF1F6',color:(j.art_status==='art_complete'||j.art_status==='production_files_needed')?'#1F7A43':_jWait?tAccent:'#5A6075',fontWeight:700,fontSize:10,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 10px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{artLabelsP[j.art_status]}</span></span>
                  <span style={{color:'#94A0B0',fontSize:16}}>›</span>
                </div>
              </div>})}
          </>}
          {/* Shipping / Tracking */}
          {soAllShipments.length>0&&<div style={{marginTop:14}}>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'#94A0B0',marginBottom:10}}>Shipping &amp; Tracking</div>
            {soAllShipments.map((shp,si)=><div key={si} style={{padding:'12px 16px',background:'#E8F5EC',border:'1px solid #A7D9B5',borderRadius:6,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
              <div>
                <div className="nsa-disp" style={{fontSize:14,fontWeight:700,color:'#1F7A43',textTransform:'uppercase'}}>📦 {shp.carrier||'Package'}{soAllShipments.length>1?' #'+(si+1):''}</div>
                {shp.ship_date&&<div style={{fontSize:12,color:'#5A6075',marginTop:2}}>Shipped {shp.ship_date}</div>}
                {shp.tracking_number&&<div style={{fontSize:11,fontFamily:'monospace',color:'#5A6075',marginTop:3}}>{shp.tracking_number}</div>}
              </div>
              {shp.tracking_number&&<a href={shp.tracking_url||((/^1Z/i.test(shp.tracking_number))?'https://www.ups.com/track?tracknum='+shp.tracking_number:'https://www.fedex.com/fedextrack/?trknbr='+shp.tracking_number)} target="_blank" rel="noreferrer" className="nsa-disp" style={{fontSize:13,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'#1F7A43',textDecoration:'none',border:'2px solid #1F7A43',borderRadius:4,padding:'7px 14px',flexShrink:0}}>Track →</a>}
            </div>)}
          </div>}
          {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'10px 14px',background:'#E8F5EC',border:'1px solid #A7D9B5',borderRadius:6,fontSize:13,color:'#1F7A43',fontWeight:600}}>
            📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||'TBD'}</div>}
        </div>
      </div>
      </div>
    </div>
  }

  // Job detail view
  if(jobView){
    const _liveSO=sos.find(s=>s.id===jobView.so.id)||jobView.so;
    const _liveJob=(safeJobs(_liveSO)).find(jj=>jj.id===jobView.job.id)||jobView.job;
    const j=_liveJob;const so=_liveSO;
    const artFile=safeArt(so).find(a=>a.id===j.art_file_id);
    // Scoped to the decorations THIS JOB OWNS (deco_idxs), mirroring jobLiveArtIds in
    // businessLogic.js: an unscoped union pulled a sibling job's art into this job's view
    // on shared garment lines (mixed-deco items always split into two jobs), so the coach
    // saw the OTHER job's mocks here — and, worse, those URLs entered seen_mocks while
    // art_ids stayed narrow, making every approve 409 with NSA_MOCKS_CHANGED (audit follow-up).
    // The decision payloads below use this same set, so what's shown, what's pinned, and
    // what gets approved/reset are one set. Legacy items without deco_idxs keep the
    // unscoped fallback, matching businessLogic.
    const _jobArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
    (j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;const _dis=jobItemDecoIdxs(gi);safeDecos(it).forEach((d,di)=>{if(_dis&&!_dis.includes(di))return;if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jobArtIds.add(d.art_file_id)})});
    const _jobArtFiles=[..._jobArtIds].map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
    // Mock links: a garment the rep linked to another garment shows a "same mockup as X"
    // note instead of repeating the image; the source garment shows it once with an
    // "also applies to" caption. Unlinked garments keep their own per-item mock.
    const _linkOfC=gi=>resolveMockLink(_jobArtFiles,gi.sku,gi.color);
    const _depsOfC=gi=>mockLinkDependents(_jobArtFiles,gi.sku,gi.color);
    const mockups=_filterDisplayable(_jobArtFiles.flatMap(_af=>_af?.mockup_files||_af?.files||[]));
    const _hasAnyItemMockup=gi=>{const src=_linkOfC(gi);if(src)return _filterDisplayable(mockLinkSourceFiles(_jobArtFiles,src)).length>0;const _mk=gi.sku+'|'+(gi.color||'');return _jobArtFiles.some(_af=>{const m=_af?.item_mockups||{};const v=m[_mk]&&m[_mk].length>0?m[_mk]:(m[gi.sku]||[]);return _filterDisplayable(v).length>0})};
    const items=(j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];const prd=it?prod.find(pp=>pp.id===it.product_id||pp.sku===it.sku):null;return{...gi,brand:it?.brand||'',fullName:safeStr(it?.name)||gi.name,image_url:prd?.image_url||(prd?.images&&prd.images[0])||it?._colorImage||'',back_image_url:prd?.back_image_url||(prd?.images&&prd.images[1])||it?._colorBackImage||''}});
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      {/* ── Lightbox overlay ── */}
      {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
        <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
        {_isImgUrl(lightbox)?<img src={lightbox} alt="Mockup" style={{maxWidth:'95vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>
        :_isPdfUrl(lightbox)?<iframe title="PDF Preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
        :<div style={{color:'white',fontSize:16}} onClick={e=>e.stopPropagation()}>Cannot preview this file type</div>}
      </div>}
      <div style={{width:'100%',maxWidth:640,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>{const _backSO=soView?sos.find(s=>s.id===jobView.so.id):null;setJobView(null);if(_backSO)setSoView(_backSO)}}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>ARTWORK PROOF</div>
            <div style={{fontSize:18,fontWeight:800}}>{j.art_name}</div>
            <div style={{fontSize:12,opacity:0.7}}>{so.memo} · {j.deco_type?.replace(/_/g,' ')} · {j.positions}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          {/* ── Per-item mockups + art details (linked garments reference their source's mock) ── */}
          {items.map((gi,i)=>{const srcItem=safeItems(so)[gi.item_idx];
            const _mySrc=_linkOfC(gi);
            const _myDeps=_depsOfC(gi).filter(k=>items.some(g=>(g.sku+'|'+(g.color||''))===k));
            const _itemArtIds=srcItem?[...new Set(safeDecos(srcItem).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd').map(d=>d.art_file_id))]:[];
            const _itemArtFiles=(_itemArtIds.length>0?_itemArtIds:[...new Set([artFile?.id,...(j._art_ids||[])].filter(Boolean))]).map(aid=>safeArt(so).find(a=>a.id===aid)).filter(Boolean);
            const _mk=gi.sku+'|'+(gi.color||'');
            const _cpDecosSorted=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd'):[];const _seenIm=new Set();const _cpFirst=(_af)=>{const im=_af?.item_mockups||{};const v=im[_mk];if(v&&v.length>0)return v[0];const vb=im[gi.sku];if(vb&&vb.length>0)return vb[0];const de=Object.entries(im).find(([k])=>k.startsWith(_mk+'|'));return de&&de[1]&&de[1].length>0?de[1][0]:null;};
            // Linked garment → no images of its own (a note references the source); else per-item.
            const itemMockups=_mySrc?[]:_filterDisplayable(_cpDecosSorted.length>1?_cpDecosSorted.flatMap((d,i)=>{const af3=safeArt(so).find(a=>a.id===d.art_file_id);if(!af3)return[];const disc=i===0?'':(d.color_way_id||('d'+i));const key=_mk+(disc?('|'+disc):'');const im=af3?.item_mockups||{};const v=im[key];if(v&&v.length>0)return[v[0]];const f=_cpFirst(af3);return f?[f]:[];}):_itemArtFiles.length>1?_itemArtFiles.flatMap(_af=>{const f=_cpFirst(_af);return f?[f]:[]}):_itemArtFiles.flatMap(_af=>{const im=_af?.item_mockups||{};const v=im[_mk];return v&&v.length>0?v:(im[gi.sku]||[])})).concat(/* suffixed slots: reversible Side B, numbers, names */_filterDisplayable(_itemArtFiles.flatMap(_af=>Object.entries(_af?.item_mockups||{}).filter(([k,arr])=>k.startsWith(_mk+'|')&&Array.isArray(arr)&&arr.length>0).flatMap(([,arr])=>arr)))).filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seenIm.has(u))return false;_seenIm.add(u);return true});
            const artDecos=srcItem?safeDecos(srcItem).filter(d=>d.kind==='art'):[];
            const artPos=artDecos.map(d=>d.position||'Front Center').filter((v,idx,arr)=>arr.indexOf(v)===idx);
            // Numbers/names shown only when THIS job produces them — the coach approving a logo
            // job shouldn't see the sibling numbers job's roster on it.
            const numDecos=srcItem?jobItemDecosOfKind(gi,srcItem,'numbers'):[];
            const nameDecos=srcItem?jobItemDecosOfKind(gi,srcItem,'names'):[];
            const nd=numDecos[0];const _isEmb=artFile?.deco_type==='embroidery';
            const gk=gi.sku+'|'+(gi.color||'');const gc=artFile?.garment_colors?.[gk]||{};
            const gcColors=Object.values(gc).flat().filter((v,idx,arr)=>v&&arr.indexOf(v)===idx);
            const cwColors2=[];artDecos.forEach(d=>{if(d.color_way_id&&artFile?.color_ways){const cw=artFile.color_ways.find(c=>c.id===d.color_way_id);if(cw)cw.inks?.forEach(c=>{if(c&&c.trim()&&!cwColors2.includes(c.trim()))cwColors2.push(c.trim())})}});
            const fallbackColors=(artFile?.ink_colors||artFile?.thread_colors||'').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);
            // Final fallback: union of all CW inks on the art file. Covers SOs where CWs are defined but
            // decorations don't carry an explicit color_way_id link — without this, colors render as empty.
            const allCwInks=[...new Set((artFile?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
            const itemColors=gcColors.length>0?gcColors:cwColors2.length>0?cwColors2:fallbackColors.length>0?fallbackColors:allCwInks;
            const _cm3={'Navy':'#001f3f','Gold':'#FFD700','White':'#ffffff','Red':'#dc2626','Black':'#000','Silver':'#C0C0C0','Royal':'#4169e1','Cardinal':'#8C1515','Green':'#166534','Orange':'#EA580C','Navy 2767':'#001f3f','PMS 286':'#0033A0','PMS 032':'#EF3340','PMS 877':'#C0C0C0','Maroon':'#800000'};
            const sizesSrc=gi.sizes?Object.entries(gi.sizes).filter(([,v])=>v>0):(srcItem?Object.entries(safeSizes(srcItem)).filter(([,v])=>v>0):[]);
            const sizes=sizesSrc.sort((a,b)=>{const o2=SZ_ORD;return(o2.indexOf(a[0])<0?99:o2.indexOf(a[0]))-(o2.indexOf(b[0])<0?99:o2.indexOf(b[0]))});
            const roster=gi.roster||(numDecos.length>0?numDecos[0].roster:null);
            const names=nameDecos.length>0?nameDecos[0].names:null;
            const sortedSizes=sizes.map(([sz])=>sz);
            return<div key={i} style={{border:'1px solid #e2e8f0',borderRadius:12,marginBottom:14,overflow:'hidden'}}>
            {/* Item mockup images */}
            {_mySrc?<div style={{padding:'8px 14px',background:'#eef2ff',fontSize:11,fontWeight:700,color:'#3730a3',textAlign:'center',cursor:'pointer'}} onClick={()=>{const sf=_filterDisplayable(mockLinkSourceFiles(_jobArtFiles,_mySrc))[0];const u=sf?(typeof sf==='string'?sf:(sf?.url||'')):'';if(u&&isUrl(u))setLightbox(u)}}>🔗 Same mockup as {_mySrc.split('|')[0]} — tap to view</div>
            :itemMockups.length>0&&<><div style={{display:'grid',gridTemplateColumns:itemMockups.length>1?'1fr 1fr':'1fr',gap:2,background:'#f1f5f9'}}>
              {itemMockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const isImg=_isImgUrl(url,f);
                return<div key={fi} style={{background:'white',cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                  {isImg&&isUrl(url)?<img src={url} alt="" style={{width:'100%',height:itemMockups.length>1?180:280,objectFit:'contain',display:'block',background:'#fafafa'}}/>
                  :<div style={{height:180,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}><span style={{fontSize:32}}>📄</span></div>}
                </div>})}
            </div>{_myDeps.length>0&&<div style={{padding:'6px 14px',background:'#eef2ff',fontSize:11,fontWeight:700,color:'#3730a3',textAlign:'center'}}>One mockup — also applies to {_myDeps.map(k=>k.split('|')[0]).join(', ')}</div>}</>}
            {/* Item header */}
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:10}}>
                {gi.image_url?<img src={gi.image_url} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:8,border:'1px solid #e2e8f0',flexShrink:0}}/>
                :<div style={{width:44,height:44,background:'#f8fafc',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><div style={{fontSize:18}}>👕</div></div>}
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{gi.fullName}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{gi.sku} · {gi.color||'—'} {gi.brand&&'· '+gi.brand}</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>📍 {artPos.length>0?artPos.join(', '):(j.positions||'—')} · {gi.units} units</div>
                </div>
              </div>
              {/* Per-item art details */}
              {artFile&&<div style={{padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:10}}>
                {(()=>{
                  // Render one row per decoration so coaches see each location's method, size, and inks separately.
                  // Falls back to a single row built from the job's primary art file when no per-item art decorations exist.
                  const _gk2=gi.sku+'|'+(gi.color||'');
                  const _renderDeco=(d,di,_aF)=>{
                    const _gc2=_aF?.garment_colors?.[_gk2]||{};
                    const _gcCols=Object.values(_gc2).flat().filter((v,idx,arr)=>v&&v.trim()&&arr.indexOf(v)===idx);
                    const cwObj=d?.color_way_id&&_aF?.color_ways?_aF.color_ways.find(c=>c.id===d.color_way_id):null;
                    const _cwCols=cwObj?(cwObj.inks||[]).filter(c=>c&&c.trim()):[];
                    const _fbCols=realInkLines(_aF?.ink_colors||_aF?.thread_colors);// 'Color N' count placeholders skipped — fall through to real CW inks (SO-1496)
                    const _allCwInks=[...new Set((_aF?.color_ways||[]).flatMap(cw=>cw.inks||[]).map(c=>c&&c.trim()).filter(Boolean))];
                    const dColors=_gcCols.length>0?_gcCols:_cwCols.length>0?_cwCols:_fbCols.length>0?_fbCols:_allCwInks;
                    const method=((d?.type||_aF?.deco_type||j.deco_type||'')+'').replace(/_/g,' ')||'—';
                    const position=d?.position||(artPos.length>0?artPos.join(', '):'—');
                    const size=(d?.position&&_aF?.art_sizes?.[d.position])||_aF?.art_size||'—';
                    const _isEmb2=(_aF?.deco_type||d?.type)==='embroidery';
                    return<div key={di} style={{paddingTop:di>0?10:0,borderTop:di>0?'1px solid #e2e8f0':'none',marginTop:di>0?10:0}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:dColors.length>0?8:0}}>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Method</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{method}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Location</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{position}</div></div>
                        <div><div style={{fontSize:9,fontWeight:600,color:'#94a3b8'}}>Art Size</div><div style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{size}</div></div>
                      </div>
                      {dColors.length>0&&<div>
                        <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>{_isEmb2?'Thread Colors':'Ink Colors / Pantones'} ({dColors.length})</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {dColors.map((cl,ci)=>{const clL=cl.toLowerCase();const sw=_cm3[cl]||Object.entries(_cm3).find(([k])=>clL.includes(k.toLowerCase()))?.[1]||pantoneHex(cl)||null;
                            return<div key={ci} style={{display:'flex',alignItems:'center',gap:4,padding:'2px 8px',background:'white',border:'1px solid #e2e8f0',borderRadius:5,fontSize:10,fontWeight:600}}>
                              <div style={{width:12,height:12,borderRadius:2,border:'1px solid #d1d5db',background:sw||'linear-gradient(135deg,#f1f5f9,#e2e8f0)'}}/>
                              {cl}</div>})}
                        </div>
                      </div>}
                    </div>;
                  };
                  if(artDecos.length===0)return _renderDeco(null,0,artFile);
                  return artDecos.map((d,di)=>{const _dAf=d.art_file_id?safeArt(so).find(a=>a.id===d.art_file_id):null;return _renderDeco(d,di,_dAf||artFile)});
                })()}
                {nd&&<div style={{marginTop:10,paddingTop:10,borderTop:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:9,fontWeight:600,color:'#94a3b8',marginBottom:3}}>Numbers</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:11}}>
                    <span><strong>{(nd.num_method||'heat_transfer').replace(/_/g,' ')}</strong></span>
                    <span>Size: <strong>{nd.num_size||'—'}</strong></span>
                    {nd.front_and_back&&<span>Back: <strong>{nd.num_size_back||nd.num_size||'—'}</strong></span>}
                    {nd.print_color&&<span>Color: <strong>{nd.print_color}</strong></span>}
                    {nd.front_and_back&&<span style={{padding:'1px 5px',borderRadius:3,background:'#7c3aed',color:'white',fontSize:9,fontWeight:700}}>Front + Back</span>}
                  </div>
                </div>}
              </div>}
              {/* Size breakdown */}
              {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:roster?10:0}}>
                {sizes.map(([sz,qty])=><div key={sz} style={{textAlign:'center',padding:'4px 8px',background:'#f8fafc',borderRadius:6,minWidth:36}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>{sz}</div>
                  <div style={{fontSize:13,fontWeight:800,color:'#1e3a5f'}}>{qty}</div>
                </div>)}
              </div>}
              {/* Numbers roster — grouped by size */}
              {roster&&Object.keys(roster).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#6d28d9',marginBottom:6}}>#️⃣ Numbers</div>
                {sortedSizes.map(sz=>{const nums=(roster[sz]||[]).filter(n=>n!=='');
                  if(nums.length===0)return null;
                  return<div key={sz} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',minWidth:56,flexShrink:0}}>{sz} ({nums.length})</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nums.sort((a,b)=>Number(a)-Number(b)).map((n,ni)=>
                        <span key={ni} style={{display:'inline-block',minWidth:32,textAlign:'center',padding:'3px 6px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:4,fontSize:12,fontWeight:700,color:'#6d28d9'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
              {/* Names */}
              {names&&Object.keys(names).length>0&&<div style={{paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:6}}>🏷️ Names</div>
                {sortedSizes.map(sz=>{const nms=(names[sz]||[]).filter(n=>n!=='');
                  if(nms.length===0)return null;
                  return<div key={sz} style={{marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>{sz}</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {nms.map((n,ni)=>
                        <span key={ni} style={{padding:'3px 8px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:4,fontSize:11,fontWeight:600,color:'#0369a1'}}>{n}</span>)}
                    </div>
                  </div>})}
              </div>}
            </div>
          </div>})}
          {/* General mockups (not per-item) */}
          {mockups.length>0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:8}}>Artwork Mockups</div>
            {mockups.map((f,fi)=>{const url=typeof f==='string'?f:(f?.url||'');const name=fileDisplayName(f);const isImg=_isImgUrl(url);
              return<div key={fi} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:10,marginBottom:8,cursor:isUrl(url)?'pointer':'default'}} onClick={()=>{if(isUrl(url))setLightbox(url)}}>
                {isImg&&isUrl(url)&&<img src={url} alt={name} style={{width:'100%',borderRadius:8,marginBottom:6,maxHeight:400,objectFit:'contain',background:'#f8fafc'}}/>}
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#1e40af'}}>{name}</span>
                  {isUrl(url)&&<span style={{fontSize:10,color:'#64748b'}}>— tap to enlarge</span>}
                </div>
              </div>})}
          </div>}
          {mockups.length===0&&items.every(gi=>!_hasAnyItemMockup(gi))&&<div style={{padding:16,background:'#fff7ed',border:'1px dashed #fdba74',borderRadius:10,marginBottom:16,textAlign:'center'}}>
            <div style={{fontSize:24,marginBottom:4}}>🎨</div>
            <div style={{fontSize:12,color:'#9a3412',fontWeight:600}}>Mockup files haven't been uploaded yet</div>
          </div>}
          {j.art_status==='waiting_approval'&&!j.sent_to_coach_at&&<div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:10,padding:14,marginBottom:16,fontSize:12,color:'#0369a1',fontWeight:600}}>🎨 Proof in progress — your rep is reviewing this design and will send it to you for approval when it's ready.</div>}
          {j.art_status==='waiting_approval'&&j.sent_to_coach_at&&<div style={{border:'2px solid #f59e0b',background:'#fffbeb',borderRadius:16,padding:18,marginBottom:16}}>

            <div style={{fontWeight:700,color:'#92400e',marginBottom:10}}>⏳ This artwork needs your approval</div>
            {_portalDisclaimer&&<div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:12,marginBottom:12,fontSize:12,color:'#991b1b',lineHeight:1.5}}><strong>⚠️ Important:</strong> {_portalDisclaimer}</div>}
            <div style={{marginBottom:10}}>
              <textarea className="form-input" rows={3} placeholder="Add a note (optional for approval, required for rejection)..." value={comment} onChange={e=>setComment(e.target.value)} style={{fontSize:12,resize:'vertical',borderRadius:10}}/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-sm" style={{background:'#22c55e',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'12px 16px',borderRadius:10}} onClick={async()=>{
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                // A coach must never approve a proof with unmocked garments — they'd be
                // approving art they can't see. Same per-garment gate the rep side enforces
                // (skusMissingMockups honors mock links and legacy general-mockup art).
                const _liveJob=(liveSO.jobs||safeJobs(liveSO)).find(jj=>jj.id===j.id)||j;
                const _mmC=skusMissingMockups(_liveJob,liveSO);
                if(_mmC.length>0){alert('This proof is missing a mockup for: '+_mmC.join(', ')+'.\n\nPlease ask your rep to complete the proof — you can also use "Request Changes" below to send them a note.');return}
                // The SAME scoped set the view renders (_jobArtIds): seen_mocks are collected
                // from these files, so the RPC's pinning pools must be built from the same ids —
                // a narrower art_ids made every mixed-deco approval conflict (NSA_MOCKS_CHANGED).
                const jArtIds=[..._jobArtIds];
                const coachComment=comment.trim();
                // Folder already carries a confirmed production separation (checkbox, or an
                // embroidery .dst)? Approval sends it straight to art_complete instead of the
                // upload-files stage — mirrors the buildJobs derivation. Every art on the job
                // must be confirmed before we skip the stage.
                const _apArts=jArtIds.map(id=>safeArt(liveSO).find(a=>a.id===id)).filter(Boolean);const _apDeco=_apArts[0]?.deco_type||j.deco_type;const _apSt=(_apArts.length&&_apArts.every(a=>artProdFilesConfirmed(a)))?'art_complete':prodFilesStatusFor(_apDeco);
                // Pin the approval to the artwork on screen: every mock URL in view must still
                // exist server-side, or the approve conflicts instead of recording an approval
                // for an image the artist has since replaced.
                const _sm=new Set();const _seenMocks=[...mockups,..._jobArtFiles.flatMap(_af=>Object.values(_af?.item_mockups||{}).flat())].map(f=>typeof f==='string'?f:((f&&(f.url||f.name))||'')).filter(u=>{if(!u||_sm.has(u))return false;_sm.add(u);return true});
                // Rep to notify: creator → customer's primary rep → monitored inbox, so a rep
                // missing an email never silently swallows the decision (mirrors the estimate path).
                const rep=REPS.find(r=>r.id===liveSO.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _apprTo=rep?.email||'steve@nationalsportsapparel.com';
                const commentHtml=coachComment?'<p style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px"><strong>Coach\'s note:</strong> '+coachComment+'</p>':'';
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                // Server FIRST — apply_coach_art_decision (portal-action) verifies the job is
                // still awaiting the coach and applies the whole write set in one transaction;
                // local state only flips after it commits, so a stale tab never shows a phantom approval.
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  artDecision:{so_id:liveSO.id,job_id:j.id,decision:'approve',comment:coachComment||null,art_ids:jArtIds,approved_status:_apSt,seen_mocks:_seenMocks},
                  email:{to:[{email:_apprTo}],cc:_accCc,subject:'✅ Art approved by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Great news! <strong>'+customer.name+'</strong> approved the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p>'+commentHtml+'<p>The job is now ready for production file prep.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',...(rep?.email?{replyTo:{email:rep.email,name:rep.name}}:{})},
                });
                if(!_res.ok){alert(_res.error||'Could not save your approval — please try again or contact your rep.');return}
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:_apSt,coach_approved_at:new Date().toISOString(),coach_approval_comment:coachComment||undefined,coach_rejected:false}:jj),art_files:safeArt(liveSO).map(a=>jArtIds.includes(a.id)?{...a,status:'approved'}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                setComment('');// stay on the job view — it re-renders from live state to show the "approved" banner
              }}>✅ Approve Artwork</button>
              <button className="btn btn-sm" style={{background:'#dc2626',color:'white',flex:1,justifyContent:'center',fontWeight:700,padding:'12px 16px',borderRadius:10}} onClick={async()=>{
                if(!comment.trim()){alert('Please describe what changes you need.');return}
                const liveSO=sos.find(s=>s.id===so.id);if(!liveSO)return;
                const _fb=comment.trim();
                const _rejAt=new Date().toISOString();
                // Both key spellings on purpose: the portal reads `at`, the dashboard todo reads `rejected_at`.
                const rej={reason:_fb,by:'Coach',at:_rejAt,rejected_at:_rejAt};
                const rArtIds=j._art_ids||[j.art_file_id].filter(Boolean);
                const _curJob=(liveSO.jobs||safeJobs(liveSO)).find(jj=>jj.id===j.id);
                const _newRejections=[...((_curJob&&_curJob.rejections)||[]),rej];
                const rep=REPS.find(r=>r.id===liveSO.created_by)||REPS.find(r=>r.id===customer.primary_rep_id);
                const _rejTo=rep?.email||'steve@nationalsportsapparel.com';
                const _accCc=getBillingContacts(customer,allCustomers).filter(a=>a.email).map(a=>({email:a.email,name:a.name||''}));
                const _safeText=_fb.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');
                // Server FIRST — the guarded transaction sends the job back to the artist with the
                // COMPLETE write set (send timestamp cleared, seps confirmation cleared) or conflicts
                // if this tab is stale; local state only flips after it commits.
                const _res=await _portalAction({alphaTag:customer.alpha_tag,
                  artDecision:{so_id:liveSO.id,job_id:j.id,decision:'reject',comment:_fb,art_ids:rArtIds},
                  email:{to:[{email:_rejTo}],cc:_accCc,subject:'📝 Art changes requested by coach — '+j.art_name+' ('+liveSO.id+')',htmlContent:'<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p><strong>'+customer.name+'</strong> requested changes to the artwork for <strong>'+j.art_name+'</strong>.</p><p>Order: '+liveSO.id+(liveSO.memo?' — '+liveSO.memo:'')+'</p><div style="margin:12px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b"><div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;margin-bottom:4px">Coach\'s feedback</div>'+_safeText+'</div><p>Please revise the artwork and resend it for approval.</p><p style="margin:18px 0"><a href="https://nsa-portal.netlify.app/?so='+liveSO.id+'" style="display:inline-block;padding:11px 20px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Order '+liveSO.id+'</a></p></div>',senderName:'NSA Portal',senderEmail:'noreply@nationalsportsapparel.com',...(rep?.email?{replyTo:{email:rep.email,name:rep.name}}:{})},
                });
                if(!_res.ok){alert(_res.error||'Could not send your request — please try again or contact your rep.');return}
                const updSO={...liveSO,jobs:(liveSO.jobs||safeJobs(liveSO)).map(jj=>jj.id===j.id?{...jj,art_status:'art_requested',coach_rejected:true,rejections:_newRejections,sent_to_coach_at:null,coach_approved_at:null}:jj),art_files:safeArt(liveSO).map(a=>rArtIds.includes(a.id)?{...a,status:'waiting_for_art',notes:(a.notes?a.notes+'\n':'')+'Coach feedback: '+_fb,prod_files_attached:false}:a),updated_at:new Date().toLocaleString()};
                if(savSOFn)savSOFn(updSO);else if(onUpdateSOs)onUpdateSOs(prev=>prev.map(s=>s.id===so.id?updSO:s));
                setComment('');// stay on the job view — it re-renders from live state to show the "changes requested" banner
              }}>❌ Request Changes</button>
            </div>
          </div>}
          {(j.art_status==='art_complete'||j.art_status==='production_files_needed')&&<div style={{background:'#f0fdf4',borderRadius:12,padding:12,marginBottom:16,fontSize:12,color:'#166534',fontWeight:600}}>✅ You approved this artwork{j.coach_approval_comment&&<div style={{fontWeight:400,marginTop:6,color:'#15803d'}}>Your note: "{j.coach_approval_comment}"</div>}</div>}
          {(j.art_status==='art_requested'&&j.coach_rejected)&&<div style={{background:'#fef2f2',borderRadius:12,padding:12,marginBottom:16,fontSize:12,color:'#dc2626',fontWeight:600}}>🔄 Changes requested — your artist is working on revisions</div>}
          {(j.art_status==='art_complete'||j.art_status==='production_files_needed'||(j.art_status==='art_requested'&&j.coach_rejected))&&(()=>{
            const _next=waitingArtJobs.find(w=>!(w.so&&w.so.id===so.id&&w.id===j.id));
            return<div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              {_next&&<button style={{width:'100%',padding:'12px 16px',background:'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:800,cursor:'pointer'}} onClick={()=>{setSoView(_next.so);setJobView({job:_next,so:_next.so});setComment('')}}>Review next artwork ({waitingArtJobs.length} still need{waitingArtJobs.length===1?'s':''} approval) →</button>}
              <button style={{width:'100%',padding:'12px 16px',background:'#1e3a5f',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'}} onClick={()=>{setJobView(null);setSoView(null);setComment('')}}>← Back to all artwork</button>
            </div>;
          })()}
          {j.prod_status!=='hold'&&<div style={{padding:10,background:'#f8fafc',borderRadius:8,marginBottom:16}}>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>PRODUCTION STATUS</div>
            <div style={{fontSize:14,fontWeight:700,color:'#1e40af',marginTop:2}}>{prodLabelsP[j.prod_status]||j.prod_status}</div>
          </div>}
        </div>
      </div>
    </div>
  }

  // Invoice detail view
  if(invView){
    const inv=invView;const bal=(inv.total||0)-(inv.paid||0);
    const linkedSO=inv.so_id?custSOs.find(s=>s.id===inv.so_id):null;
    // Generate a printable/downloadable invoice PDF — mirrors the estimate download and
    // the admin invoice layout, but shows the school PO number (not the internal SO).
    const downloadInvPdf=()=>{
      const _$=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const poNum=inv._po_number||linkedSO?.po_number;
      const isDeposit=inv.inv_type==='deposit';const depPct=isDeposit?(inv.deposit_pct||50)/100:1;
      const rows=[];let subTotal=0;
      const soItems=linkedSO?safeItems(linkedSO):[];const soArt=linkedSO?safeArt(linkedSO):[];
      const _pAQ={};soItems.forEach(it=>{const sq2=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const q2=sq2>0?sq2:safeNum(it.est_qty);safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id){_pAQ[d.art_file_id]=(_pAQ[d.art_file_id]||0)+q2*(d.reversible?2:1)}})});
      if(soItems.length>0){
        soItems.forEach(it=>{
          const sqq=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const qty=sqq>0?sqq:safeNum(it.est_qty);if(!qty)return;
          const szStr=SZ_ORD.filter(sz=>safeSizes(it)[sz]>0).map(sz=>safeSizes(it)[sz]+(it.is_footwear?'/':' ')+sz).join(', ');
          const unitPrice=safeNum(it.unit_sell);const lineAmt=Math.round(qty*unitPrice*depPct*100)/100;subTotal+=lineAmt;
          let itemName=(safeStr(it.name)||'Item')+(it.color?' - '+it.color:'');
          if(szStr)itemName+='<br/><span style="color:#555">'+szStr+'</span>';
          rows.push({cells:[{value:qty,style:'text-align:center'},{value:it.sku||'',style:'font-weight:700'},{value:itemName},{value:_$(unitPrice),style:'text-align:right'},{value:_$(lineAmt),style:'text-align:right;font-weight:600'}]});
          safeDecos(it).forEach(d=>{
            const cq=d.kind==='art'&&d.art_file_id?_pAQ[d.art_file_id]:qty;const dp2=dP(d,qty,soArt,cq);
            const eq=dp2._nq!=null?dp2._nq:(d.reversible?qty*2:qty);const decoAmt=Math.round(eq*dp2.sell*depPct*100)/100;subTotal+=decoAmt;
            const artF=soArt.find(a2=>a2.id===d.art_file_id);const posLabel=d.position?' — '+d.position:'';
            rows.push({_class:'deco-row',cells:[{value:eq,style:'text-align:center'},{value:'',style:''},{value:'<span style="padding-left:16px">'+pdfDecoLabel(d,artF)+posLabel+'</span>'},{value:_$(dp2.sell),style:'text-align:right'},{value:_$(decoAmt),style:'text-align:right'}]});
          });
        });
      }else{
        (inv.line_items||[]).forEach(li=>{const qty=safeNum(li.qty);const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):qty*rate;subTotal+=amt;rows.push({cells:[{value:qty,style:'text-align:center'},{value:li._sku||li.sku||'',style:'font-weight:700'},{value:safeStr(li._name||li.name||li.desc)||'Item'},{value:_$(rate),style:'text-align:right'},{value:_$(amt),style:'text-align:right;font-weight:600'}]})});
      }
      const _ship=inv.shipping!=null?inv.shipping:(linkedSO?(linkedSO.shipping_type==='pct'?subTotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0)):0);
      const _tax=inv.tax||0;
      const billAddr=customer?.billing_address_line1?customer.billing_address_line1+(customer.billing_city?'<br/>'+customer.billing_city+(customer.billing_state?' '+customer.billing_state:'')+(customer.billing_zip?' '+customer.billing_zip:''):'')+'<br/>United States':(customer?.shipping_address_line1?customer.shipping_address_line1+(customer.shipping_city?'<br/>'+customer.shipping_city+(customer.shipping_state?' '+customer.shipping_state:'')+(customer.shipping_zip?' '+customer.shipping_zip:''):'')+'<br/>United States':'');
      const terms=inv.inv_type==='deposit'?(inv.deposit_pct||50)+'% Deposit':inv.inv_type==='partial'?'Partial Invoice':inv.inv_type==='full'?'Invoice':'Final Invoice';
      printDoc({
        title:customer?.name||'Customer',docNum:inv.id,docType:'INVOICE',date:inv.date,
        headerRight:'<div class="ta">'+_$(inv.total||0)+'</div><div class="ts">Balance Due: <strong>'+_$(bal)+'</strong></div>'+(poNum?'<div style="font-size:11px;margin-top:4px;font-family:monospace;font-weight:700;color:#1e40af">PO# '+poNum+'</div>':''),
        infoBoxes:[
          {label:'Bill To',value:customer?.name||'—',sub:billAddr||''},
          {label:'Invoice Date',value:inv.date||new Date().toLocaleDateString(),sub:inv.due_date?'Due: '+inv.due_date:''},
          {label:'PO Number',value:poNum||'—'},
          {label:'Payment Terms',value:terms,sub:'Rep: '+(rep?.name||'—')},
        ],
        tables:[{headers:['Quantity','SKU','Item','Rate','Amount'],aligns:['center','left','left','right','right'],
          rows:[...rows,
            {cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Subtotal</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'},{value:'<strong>'+_$(subTotal)+'</strong>',style:'text-align:right;border-top:2px solid #ccc;padding-top:8px'}]},
            ...(_ship>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Shipping</strong>',style:'text-align:right;border:none'},{value:_$(_ship),style:'text-align:right;border:none'}]}]:[]),
            ...(_tax>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Tax</strong>',style:'text-align:right;border:none'},{value:_$(_tax),style:'text-align:right;border:none'}]}]:[]),
            {_class:'totals-row',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong>Total</strong>',style:'text-align:right'},{value:'<strong style="font-size:14px">'+_$(inv.total||0)+'</strong>',style:'text-align:right'}]},
            ...(inv.paid>0?[{cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<span style="color:#166534">Paid</span>',style:'text-align:right;border:none'},{value:'<span style="color:#166534">'+_$(inv.paid)+'</span>',style:'text-align:right;border:none'}]}]:[]),
            ...(bal>0?[{_style:'background:#fef2f2',cells:[{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'',style:'border:none'},{value:'<strong style="color:#dc2626">Balance Due</strong>',style:'text-align:right'},{value:'<strong style="color:#dc2626;font-size:14px">'+_$(bal)+'</strong>',style:'text-align:right'}]}]:[]),
          ]}],
        footer:inv.inv_type==='deposit'?NSA.depositTerms:NSA.terms
      });
    };
    return<div style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:550,background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',overflow:'hidden'}}>
        <div style={{background:'linear-gradient(135deg,#991b1b,#dc2626)',color:'white',padding:'20px 24px',position:'relative'}}>
          <button style={{position:'absolute',top:8,left:12,background:'rgba(255,255,255,0.15)',border:'none',color:'white',borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>setInvView(null)}>← Back</button>
          <div style={{textAlign:'center',paddingTop:16}}>
            <div style={{fontSize:10,opacity:0.6}}>INVOICE</div>
            <div style={{fontSize:20,fontWeight:800}}>{inv.id}</div>
            <div style={{fontSize:13,opacity:0.8}}>{inv.memo||'—'}</div>
          </div>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{textAlign:'center',padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b'}}>Amount Due</div>
            <div style={{fontSize:36,fontWeight:800,color:'#dc2626'}}>${bal.toLocaleString()}</div>
            {inv.paid>0&&<div style={{fontSize:12,color:'#64748b'}}>Paid: ${inv.paid.toLocaleString()} of ${inv.total.toLocaleString()}</div>}
            <div style={{marginTop:14}}><button style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 6px rgba(30,58,95,0.25)'}} onClick={downloadInvPdf}>📄 Download Invoice PDF</button></div>
          </div>
          {/* Order details from linked sales order */}
          {linkedSO&&(()=>{const soAF=linkedSO.art_files||[];const soJobs=safeJobs(linkedSO);
            const itemSubtotal=safeItems(linkedSO).reduce((a,it)=>{const qty=Object.values(safeSizes(it)).reduce((s,v)=>s+safeNum(v),0);return a+qty*safeNum(it.unit_sell)},0);
            const shipAmt=inv.shipping!=null?inv.shipping:(linkedSO.shipping_type==='pct'?itemSubtotal*(linkedSO.shipping_value||0)/100:(linkedSO.shipping_value||0));
            const taxAmt=inv.tax||0;
            return<div style={{marginBottom:16,border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden'}}>
            <div style={{padding:'10px 14px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:12,fontWeight:700,color:'#1e3a5f'}}>📦 Order Details — {linkedSO.memo||linkedSO.id}</div>
              <span style={{fontSize:10,color:'#64748b'}}>{linkedSO.id}</span>
            </div>
            {safeItems(linkedSO).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);const sizes=Object.entries(safeSizes(it)).filter(([,v])=>v>0);
              const decos=safeDecos(it).filter(d=>d.type||d.deco_type||d.kind);
              const decoLabels=decos.map(d=>{const t=d.type||d.deco_type||d.kind||'';const pos=d.position||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(pos?' — '+pos:'')}).filter(Boolean);
              const matchedJobs=soJobs.filter(j=>(j.items||[]).some(ji=>ji===it.id||ji===ii)||(!j.items&&soAF.some(af=>af.id===j.art_file_id&&decos.some(d=>d.art_file_id===af.id))));
              const jobDecoLabels=matchedJobs.map(j=>{const t=j.deco_type||'';return(t.charAt(0).toUpperCase()+t.slice(1).replace(/_/g,' '))+(j.art_name?' — '+j.art_name:'')}).filter(Boolean);
              const allDecoLabels=[...new Set([...decoLabels,...jobDecoLabels])];
              return<div key={ii} style={{padding:'10px 14px',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{safeStr(it.name)||'Item'}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{it.sku} · {safeStr(it.color)||'—'}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{qty} units</div>
                    {/* Prefer the invoice's stored line rate (garment + decoration, what the customer is
                        actually billed) — it.unit_sell is garment-only, which made lines not add up to
                        the invoice total (INV-63089: $16 shown for an $18 all-in item). Match by the
                        canonical soLineKey (same helper that stamped _so_line_key at invoice creation);
                        the fallback requires sku + color + qty and refuses ambiguous matches. */}
                    <div style={{fontSize:10,color:'#64748b'}}>${(()=>{const lis=inv.line_items||[];let li=lis.find(l=>l._so_line_key===soLineKey(it,ii));if(!li){const cands=lis.filter(l=>(l._sku||l.sku)===it.sku&&(l._color==null||l._color===it.color)&&safeNum(l.qty)===qty);if(cands.length===1)li=cands[0]}return safeNum(li&&li.rate!=null?li.rate:it.unit_sell)})().toFixed(2)}/ea</div>
                  </div>
                </div>
                {allDecoLabels.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {allDecoLabels.map((label,di)=><span key={di} style={{padding:'2px 8px',background:'#ede9fe',color:'#6d28d9',borderRadius:6,fontSize:10,fontWeight:600}}>{label}</span>)}
                </div>}
                {sizes.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {sizes.sort((a,b)=>{const o=SZ_ORD;return(o.indexOf(a[0])<0?99:o.indexOf(a[0]))-(o.indexOf(b[0])<0?99:o.indexOf(b[0]))}).map(([sz,q])=><div key={sz} style={{textAlign:'center',padding:'2px 5px',background:'#f1f5f9',borderRadius:4,minWidth:28}}>
                    <div style={{fontSize:8,fontWeight:700,color:'#64748b'}}>{sz}</div>
                    <div style={{fontSize:11,fontWeight:700,color:'#1e3a5f'}}>{q}</div>
                  </div>)}
                </div>}
              </div>})}
            {linkedSO.expected_date&&<div style={{padding:'8px 14px',background:'#f8fafc',fontSize:11,color:'#64748b',display:'flex',justifyContent:'space-between'}}>
              <span>Expected Date</span><span style={{fontWeight:600,color:'#1e3a5f'}}>{linkedSO.expected_date}</span>
            </div>}
          </div>})()}
          {/* Invoice line items — only shown when there's no linked SO. When an SO is
              linked, the Order Details section above already lists every item (with
              correct pricing and sizes), so we don't repeat them here. */}
          {inv.line_items?.length>0&&!linkedSO&&<div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:6}}>Invoice Line Items</div>
            {inv.line_items.map((li,i)=>{const rate=safeNum(li.rate!=null?li.rate:li.unit_sell);const amt=li.amount!=null?safeNum(li.amount):safeNum(li.qty)*rate;
              return<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}>
              <div><div style={{fontWeight:600,fontSize:13}}>{safeStr(li._name||li.name||li.desc)||li._sku||li.sku}</div><div style={{fontSize:11,color:'#64748b'}}>{safeNum(li.qty)} × ${rate.toFixed(2)}</div></div>
              <div style={{fontWeight:700,fontSize:13}}>${amt.toFixed(2)}</div>
            </div>})}
          </div>}
          {/* Cost breakdown: subtotal, shipping, tax */}
          {(()=>{const _sub=(inv.total||0)-(inv.shipping||0)-(inv.tax||0);
            const _ship=inv.shipping||0;const _tax=inv.tax||0;
            const soForShip=linkedSO;
            const computedShip=_ship===0&&soForShip?(soForShip.shipping_type==='pct'?_sub*(soForShip.shipping_value||0)/100:(soForShip.shipping_value||0)):_ship;
            const showBreakdown=computedShip>0||_tax>0;
            return showBreakdown&&<div style={{marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Subtotal</span><span>${_sub.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>
              {computedShip>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Shipping</span><span>${computedShip.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
              {_tax>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:13,color:'#64748b'}}>
                <span>Tax</span><span>${_tax.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>}
            </div>})()}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:'2px solid #e2e8f0'}}>
            <span style={{fontWeight:800}}>Total</span><span style={{fontWeight:800,fontSize:18,color:'#dc2626'}}>${inv.total?.toLocaleString()}</span>
          </div>
          {bal>0&&!ccDisabled&&<button style={{width:'100%',marginTop:16,padding:'14px 20px',background:payLoading?'#86efac':'#22c55e',color:'white',border:'none',borderRadius:10,fontSize:16,fontWeight:800,cursor:payLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,opacity:payLoading?0.8:1,transition:'all 0.2s'}} disabled={payLoading} onClick={()=>{setPayLoading(true);setShowPay(inv)}}>
            {payLoading?<><span style={{display:'inline-block',width:18,height:18,border:'3px solid rgba(255,255,255,0.3)',borderTop:'3px solid white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>Opening secure checkout...</>:<>💳 Pay ${bal.toLocaleString()}</>}
          </button>}
          {bal>0&&ccDisabled&&<div style={{textAlign:'center',marginTop:16,padding:12,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,color:'#475569',fontSize:12,lineHeight:1.5}}>Please remit payment by check or ACH per your account terms. Contact your rep for details.</div>}
          {bal<=0&&<div style={{textAlign:'center',padding:12,background:'#f0fdf4',borderRadius:8,color:'#166534',fontWeight:700}}>✅ Paid in Full</div>}
        </div>
      </div>
      {payModalEl}
    </div>
  }

  // Coach store builder — full-screen guided flow
  if(storeBuilder) return <StoreBuilder mode="coach" customer={customer} rep={rep} onClose={()=>setStoreBuilder(false)} />;

  // ── Athletic-director Spend & Promo — full-screen dashboard opened from the portal link ──
  if(spendView&&adData){
    const{period,teams,totalSpend,adidasTotal,allocated,used,remaining,remainingDisplay,overspent,hasPromo,deptName,teamCount,usedPct,money,money2}=adData;
    const teamsActive=teams.filter(t=>t.orders>0);
    const teamsZero=teams.filter(t=>t.orders===0);
    const adiAvail=adidasTotal>0;const isAdi=adiAvail&&spendMode==='adidas';const metric=isAdi?'adidas':'spend';
    const modeMax=Math.max(1,...teamsActive.map(t=>t[metric]||0));const modeTotal=isAdi?adidasTotal:totalSpend;
    return<div style={{minHeight:'100vh',background:'#f1f5f9',padding:'32px 16px'}}>
      <style>{`.ad-teams{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}@media(max-width:680px){.ad-teams{grid-template-columns:1fr}}.ad-top{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:stretch}@media(max-width:800px){.ad-top{grid-template-columns:1fr}}`}</style>
      <div style={{maxWidth:1000,margin:'0 auto'}}>
        <button onClick={()=>setSpendView(false)} style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,textTransform:'uppercase',letterSpacing:.5,color:'#64748b',background:'none',border:'none',cursor:'pointer',padding:0,marginBottom:14}}>‹ Back to Dashboard</button>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:20,marginBottom:26,flexWrap:'wrap'}}>
          <div>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:2,textTransform:'uppercase',color:tAccent,marginBottom:8}}>Athletic Department</div>
            <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:0,lineHeight:1}}>{hasPromo?'Spend & Promo':'Spend Report'}</h1>
            <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',margin:'12px 0 10px'}}/>
            <div style={{fontSize:15,color:'#64748b'}}>{deptName} · {teamCount} team{teamCount!==1?'s':''}</div>
          </div>
          <div style={{display:'flex',background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:4,boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
            {[['period',period.label],['all','All time']].map(([k,lbl])=>(
              <button key={k} onClick={()=>setAdRange(k)} className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:.5,textTransform:'uppercase',padding:'9px 18px',border:'none',borderRadius:4,cursor:'pointer',background:adRange===k?tPrimary:'transparent',color:adRange===k?'#fff':'#64748b',transition:'all .15s'}}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="ad-top" style={{marginBottom:34}}>
          {hasPromo&&<div style={{position:'relative',overflow:'hidden',borderRadius:8,boxShadow:'0 8px 32px rgba(0,0,0,.18)',background:`linear-gradient(125deg,${tNavyDark} 0%,${tPrimary} 60%,${tNavyMid} 100%)`,padding:'28px 30px',color:'#fff'}}>
            <div style={{position:'absolute',inset:0,background:'repeating-linear-gradient(-55deg,transparent,transparent 26px,rgba(255,255,255,.02) 26px,rgba(255,255,255,.02) 52px)'}}/>
            <div style={{position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:18}}>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:1.5,textTransform:'uppercase',color:'rgba(255,255,255,.62)'}}>Promo Budget · {adRange==='all'?'All time':period.label}</div>
                {overspent&&<span className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:.5,textTransform:'uppercase',background:tAccent,color:'#fff',padding:'4px 11px',borderRadius:999,whiteSpace:'nowrap'}}>Over by {money2(-remaining)}</span>}
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:12}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:52,lineHeight:1,color:'#fff'}}>{money2(used)}</div>
                <div style={{fontSize:15,color:'rgba(255,255,255,.7)'}}>used of {money2(allocated)}</div>
              </div>
              <div style={{height:10,background:'rgba(255,255,255,.14)',borderRadius:999,overflow:'hidden',margin:'20px 0 8px'}}>
                <div style={{height:'100%',width:Math.min(usedPct,100)+'%',background:overspent?'linear-gradient(90deg,#f59e0b,#b45309)':'linear-gradient(90deg,#22c55e,#15803d)',borderRadius:999}}/>
              </div>
              <div style={{fontSize:13,color:'rgba(255,255,255,.6)'}}>{usedPct}% used{overspent?' · over budget':remainingDisplay>0?' · '+money2(remainingDisplay)+' remaining':''}</div>
              <div style={{display:'flex',gap:26,marginTop:22,paddingTop:20,borderTop:'1px solid rgba(255,255,255,.14)'}}>
                {[['Allocated',money2(allocated)],['Applied to Orders',money2(used)],['Remaining',money2(remainingDisplay)]].map(([lbl,val])=>(
                  <div key={lbl}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:11,letterSpacing:1,textTransform:'uppercase',color:'rgba(255,255,255,.55)'}}>{lbl}</div>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:22,color:lbl==='Remaining'?tAccentLight:'#fff',marginTop:2}}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>}
          <div style={{display:'flex',flexDirection:'column',gap:22,...(!hasPromo?{gridColumn:'1/-1'}:{})}}>
            <div style={{flex:1,background:'#fff',border:'1px solid #e2e8f0',borderTop:`3px solid ${tPrimary}`,borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'24px 26px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#94a3b8'}}>Department Spend</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:40,color:tPrimary,lineHeight:1.05,margin:'5px 0 3px'}}>{money(totalSpend)}</div>
              <div style={{fontSize:13,color:'#64748b'}}>{adRange==='all'?'All time':period.label} · {teamsActive.length} active</div>
            </div>
            {adiAvail&&<div style={{flex:1,background:'#fff',border:'1px solid #e2e8f0',borderTop:`3px solid ${tAccent}`,borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'24px 26px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#94a3b8'}}>Adidas Items</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:40,color:tPrimary,lineHeight:1.05,margin:'5px 0 3px'}}>{money(adidasTotal)}</div>
              <div style={{fontSize:13,color:'#64748b'}}>Items only · no deco</div>
            </div>}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:18,flexWrap:'wrap'}}>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:22,textTransform:'uppercase',color:tPrimary}}>{isAdi?'Adidas Spend by Team':'Spend by Team'}</div>
          {adiAvail&&<div style={{display:'flex',background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:4,boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
            {[['all','All Spend'],['adidas','Adidas Only']].map(([k,lbl])=>(
              <button key={k} onClick={()=>setSpendMode(k)} className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:.5,textTransform:'uppercase',padding:'8px 16px',border:'none',borderRadius:4,cursor:'pointer',background:spendMode===k?tPrimary:'transparent',color:spendMode===k?'#fff':'#64748b',transition:'all .15s'}}>{lbl}</button>
            ))}
          </div>}
        </div>
        {teamsActive.length===0?
          <div style={{color:'#94a3b8',fontSize:13,padding:'20px 4px',textAlign:'center',border:'1px dashed #e2e8f0',borderRadius:10}}>No team spend {adRange==='all'?'on record yet':'in '+period.label}.{adRange!=='all'?<> Try <button onClick={()=>setAdRange('all')} style={{border:'none',background:'none',color:tPrimary,fontWeight:700,cursor:'pointer',textDecoration:'underline',padding:0,font:'inherit'}}>All time</button>.</>:null}</div>:
          <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,.07)',padding:'10px 28px'}}>
            <div className="ad-teams">
              {teamsActive.map(t=>{const val=t[metric]||0;const w=Math.round(val/modeMax*100);const share=modeTotal>0?Math.round(val/modeTotal*100):0;
                return<div key={t.id} style={{padding:'16px 0',borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:14,marginBottom:9}}>
                    <div className="nsa-disp" style={{flex:1,minWidth:0,fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{t.isDept?'🏛️ ':''}{t.name}</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:9,flexShrink:0}}>
                      <span className="nsa-disp" style={{fontWeight:800,fontSize:16,color:tPrimary}}>{money2(val)}</span>
                      <span style={{fontSize:12,color:'#94a3b8',width:30,textAlign:'right'}}>{share}%</span>
                    </div>
                  </div>
                  <div style={{height:6,background:'#f1f5f9',borderRadius:999,overflow:'hidden'}}><div style={{height:'100%',width:w+'%',background:tAccent,borderRadius:999}}/></div>
                </div>;
              })}
            </div>
          </div>}
        {teamsZero.length>0&&<details style={{marginTop:16}}>
          <summary style={{cursor:'pointer',fontSize:12.5,fontWeight:700,color:'#64748b'}}>{teamsZero.length} team{teamsZero.length!==1?'s':''} with no orders {adRange==='all'?'on record':'in '+period.label}</summary>
          <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
            {teamsZero.map(t=><span key={t.id} style={{fontSize:12,color:'#64748b',background:'#f8fafc',border:'1px solid #eef2f7',borderRadius:999,padding:'4px 11px'}}>{t.name}</span>)}
          </div>
        </details>}
        <div style={{fontSize:11,color:'#94a3b8',marginTop:20,lineHeight:1.5,borderTop:'1px solid #f1f5f9',paddingTop:14}}>
          {isAdi?'Adidas items only — decoration, shipping & tax are excluded.':'Spend reflects products & decoration only — shipping and tax are excluded.'}{hasPromo?' Promo dollars are shared across the whole department.':''}
        </div>
      </div>
    </div>;
  }

  // Main portal view — a branded "Team HQ" shell: team-colored sidebar + bottom nav, paged content.
  const cpTint=cpShade(cpTheme.primary,84);// light team-tint for active nav pills & highlights
  const cpNav=[
    {key:'home',label:'Home',icon:'🏠'},
    {key:'orders',label:'Orders',icon:'📦',badge:activeSOs.length},
    ...(hasRoster?[{key:'roster',label:'Roster',icon:'📋'}]:[]),
    ...(hasStore?[{key:'store',label:'Store',icon:'🛍️',badge:openStoreCount}]:[]),
    {key:'billing',label:'Billing',icon:'💳',badge:openInvs.length},
    {key:'art',label:'Art',icon:'🎨'},
    {key:'shop',label:'Shop',icon:'🛍️'},
    ...(adData?[{key:'spend',label:adData.hasPromo?'Spend & Promo':'Spend',icon:'📊',onClick:()=>setSpendView(true)}]:[]),
  ];
  // Reorder a saved design through Live Look — deep-links the catalog with the artwork so the
  // coach picks gear and the design rides along to the rep on the order request.
  const cpOrderWithArt=(a,url)=>{
    const base=CP_LIVELOOK_URL;const sep=base.includes('?')?'&':'?';
    const href=base+sep+'art='+encodeURIComponent(url||a.urls[0]||'')+'&an='+encodeURIComponent(a.name||'Design')+(a.deco?'&ad='+encodeURIComponent(a.deco):'');
    try{window.open(href,CP_LINK_TARGET,'noopener');}catch(e){window.location.href=href;}
  };
  // ── NSA nav (design tokens are hoisted to the top of the component) ──
  const _nsaNav=[['home','Dashboard'],['orders','Orders'],...(hasRoster?[['roster','Roster']]:[]),...(hasStore?[['store','Team Store']]:[]),['art','Art Locker'],['billing','Billing'],['shop','Shop']];
  // AD-only "filter by sport" — the parent's sub-customers (teams) + the dept itself.
  const _teamName=id=>id==='all'?'all':(((allCustomers||[]).find(c=>c.id===id)||{}).name||'');
  const _teamOpts=isP?[{id:customer.id,name:'Athletic Dept.'},...[...subs].sort((a,b)=>(a.name||'').localeCompare(b.name||''))]:[];
  const _teamSort=(a,b)=>(_teamName(a.customer_id)||'').localeCompare(_teamName(b.customer_id)||'');
  const _teamSelect=(<select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} className="nsa-disp" style={{border:'1px solid #EEF1F6',borderRadius:4,padding:'10px 12px',fontSize:13,fontWeight:700,textTransform:'uppercase',letterSpacing:'.3px',color:tPrimary,background:'#fff',cursor:'pointer',maxWidth:260}}><option value="all">All teams</option>{_teamOpts.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>);
  return<div style={{minHeight:'100vh',background:'#F7F8FB',fontFamily:"'Source Sans 3',system-ui,sans-serif",color:'#2A2F3E'}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Source+Sans+3:wght@400;600;700&display=swap');
      .nsa-disp{font-family:'Barlow Condensed','Source Sans 3',system-ui,sans-serif}
      .nsa-tile{transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s,border-color .25s}
      .nsa-tile:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(25,40,83,.12)!important}
      .nsa-card{transition:background .2s}.nsa-card:hover{background:#F7F8FB}
      .nsa-nav{position:relative;background:none;border:none;cursor:pointer;height:84px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;text-transform:uppercase;letter-spacing:.8px;font-size:16px;font-weight:700;transition:color .2s}
      .nsa-skew{transform:skewX(-3deg);transition:transform .2s,background .2s,filter .2s}.nsa-skew>span{display:inline-block;transform:skewX(3deg)}.nsa-skew:hover{transform:skewX(-3deg) translateY(-2px)}
      .nsa-desknav{display:none}@media(min-width:881px){.nsa-desknav{display:flex}}
      @media(max-width:880px){.nsa-mkt-util{font-size:11px}}
      .cp-bottomnav{position:fixed;left:12px;right:12px;bottom:12px;display:flex;justify-content:space-around;z-index:40;padding:8px 4px;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,.22);background:#fff;border:1px solid #EEF1F6}@media(min-width:881px){.cp-bottomnav{display:none}}
      .cp-bottombtn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;border:none;background:none;cursor:pointer;padding:3px 2px;font-size:10px;font-weight:800}
      .cp-grid{display:block}.cp-col{min-width:0}.cp-page{max-width:1240px;margin:0 auto}
      .cp-tool{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid #EEF1F6;background:#fff;border-radius:6px;padding:14px 16px;cursor:pointer;text-decoration:none;color:inherit;transition:border-color .12s,box-shadow .12s}.cp-tool:hover{box-shadow:0 2px 10px rgba(0,0,0,.08)}
      .cp-adidas{transition:box-shadow .14s,transform .14s}.cp-adidas:hover{box-shadow:0 6px 18px rgba(0,0,0,.22);transform:translateY(-1px)}
    `}</style>
    {/* ── Utility bar ── */}
    <div className="nsa-mkt-util" style={{background:tNavyDark,color:'rgba(255,255,255,.85)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',padding:'8px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',fontSize:13}}>
        <span className="nsa-disp" style={{fontWeight:700,textTransform:'uppercase',letterSpacing:'1.5px'}}><span style={{color:tAccentLight}}>★</span> Team Portal — Powered by National Sports Apparel <span style={{color:tAccentLight}}>★</span></span>
        <span style={{display:'flex',gap:16,alignItems:'center',fontWeight:600}}><span style={{opacity:.6}}>Need help?</span><a href="mailto:hello@nationalsportsapparel.com" style={{color:'#fff',textDecoration:'none'}}>hello@nationalsportsapparel.com</a><a href="tel:7142798777" style={{color:'#fff',textDecoration:'none'}}>(714) 279-8777</a></span>
      </div>
    </div>
    {/* ── Sticky header ── */}
    <div style={{background:'#fff',position:'sticky',top:0,zIndex:50,boxShadow:'0 4px 24px rgba(0,0,0,.08)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',display:'flex',alignItems:'center',gap:16,padding:'0 24px',height:84}}>
        <img src="/NEW NSA Logo on white.png" alt="NSA" style={{height:50,cursor:'pointer',flexShrink:0}} onClick={()=>setPage('home')}/>
        <div className="nsa-desknav" style={{flex:1,justifyContent:'center',alignItems:'center'}}>
          {_nsaNav.map(([k,lbl])=>{const active=page===k;const badge=k==='orders'?activeSOs.length:k==='estimates'?openEstCount:k==='store'?openStoreCount:0;return(
            <button key={k} className="nsa-nav nsa-disp" onClick={()=>setPage(k)} style={{color:active?tAccent:tPrimary}}>
              <span>{lbl}</span>
              {badge>0?<span className="nsa-disp" style={{fontWeight:700,fontSize:11,background:k==='estimates'?tAccent:tPrimary,color:'#fff',borderRadius:999,padding:'2px 7px',lineHeight:1}}>{badge}</span>:null}
              <span style={{position:'absolute',left:12,right:12,bottom:20,height:3,background:tAccent,transform:`skewX(-12deg) scaleX(${active?1:0})`,transformOrigin:'left',transition:'transform .25s ease'}}/>
            </button>
          )})}
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10,border:'1px solid #EEF1F6',borderRadius:999,padding:'6px 6px 6px 14px',flexShrink:0}}>
          <div style={{textAlign:'right',lineHeight:1.15}}>
            <div className="nsa-disp" style={{fontWeight:700,fontSize:14,textTransform:'uppercase',letterSpacing:'.5px',color:tPrimary}}>{customer.name}</div>
            <div style={{fontSize:11,color:'#5A6075'}}>{(customer.contacts||[])[0]?.name||'Coach'}</div>
          </div>
          <div className="nsa-disp" style={{width:38,height:38,borderRadius:999,overflow:'hidden',background:cpLogo?'#fff':tPrimary,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:15,flexShrink:0}}>{cpLogo?<img src={cpLogo} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:cpMonogram}</div>
        </div>
      </div>
    </div>
    {/* ── Striped rule — sticks just below the header so the brand bar stays visible while scrolling ── */}
    <div style={{height:8,position:'sticky',top:84,zIndex:49,boxShadow:'0 2px 6px rgba(0,0,0,.12)',background:`repeating-linear-gradient(90deg, ${tAccent} 0 30%, ${tPrimary} 30% 32%, ${tAccent} 32% 70%, ${tPrimary} 70% 72%, ${tAccent} 72% 100%)`}}/>
    {/* ── MAIN ── */}
    <div className="cp-main" style={{maxWidth:1240,margin:'0 auto',padding:'36px 24px 110px'}}>
        <div className="cp-page">
        <div className="cp-grid">

        {/* ── content sections (each gated to a nav page) ── */}
        <div className="cp-col">
        {/* ── HOME HUB — school hero + color-coordinated section tiles (the launchpad) ── */}
        {page==='home'&&<div>
          <style>{`.nsa-qa{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.nsa-attn,.nsa-rep{display:grid;gap:24px}.nsa-attn{grid-template-columns:1fr 1fr}.nsa-rep{grid-template-columns:1.3fr 1fr}@media(max-width:880px){.nsa-qa{grid-template-columns:1fr}.nsa-attn,.nsa-rep{grid-template-columns:1fr}.nsa-herologo{display:none!important}.nsa-heroleft{max-width:100%!important}}
          /* ── Dashboard-only restyle tokens (flat/rounded, teamshop-aligned). Scoped to this
             home-page block only — NOT touching the shared .nsa-tile/.nsa-skew/.nsa-card rules
             above, which other pages (Orders/Billing/Art Locker/Shop) still rely on. ── */
          .nsa-dtile{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
          .nsa-dtile:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(25,40,83,.12)!important;border-color:#E2E6F0!important}
          .nsa-dbtn{transition:transform .15s ease,filter .15s ease}
          .nsa-dbtn:hover{transform:translateY(-1px);filter:brightness(1.07)}`}</style>
          {/* ── Pennant hero ── */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:16,minHeight:320,boxShadow:'0 10px 32px rgba(15,26,56,.18)',marginBottom:28,background:`linear-gradient(120deg, ${tPrimary} 0%, ${tNavyMid} 58%, ${tNavyTint} 100%)`}}>
            <div className="nsa-herologo" style={{position:'absolute',top:0,right:0,bottom:0,width:'42%',display:'flex',alignItems:'center',justifyContent:'center',padding:'34px 40px'}}>
              <div style={{width:'100%',height:'100%',borderRadius:16,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.16)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {cpLogo?<img src={cpLogo} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>:<div style={{textAlign:'center',color:'rgba(255,255,255,.45)'}}><div className="nsa-disp" style={{fontSize:64,fontWeight:800,letterSpacing:'-.04em',lineHeight:1}}>{cpMonogram}</div><div style={{fontSize:12,marginTop:6}}>Set team logo (customer detail)</div></div>}
              </div>
            </div>
            <div className="nsa-heroleft" style={{position:'relative',maxWidth:'56%',padding:'40px',color:'#fff'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'1px',color:tAccentLight,textTransform:'uppercase'}}>★ Team HQ ★</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:48,lineHeight:.98,textTransform:'uppercase',margin:'10px 0 0'}}>{customer.name}</h1>
              <div style={{fontSize:15,color:'rgba(255,255,255,.78)',marginTop:10}}>{isP?(adData?adData.teamCount:subs.length)+' teams · ':''}Powered by National Sports Apparel</div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:18}}>
                <span className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.6)'}}>Team Colors</span>
                {/* merge: main's cpSwatches (real school-color families) in the Team Shop branch's circle styling */}
                {cpSwatches.map((c,i)=><span key={i} style={{width:22,height:22,borderRadius:'50%',background:c,border:'2px solid rgba(255,255,255,.5)'}}/>)}
              </div>
              {totalDue>0&&<><div style={{height:1,background:'rgba(255,255,255,.15)',margin:'22px 0 18px',maxWidth:400}}/>
              <div style={{display:'flex',alignItems:'center',gap:22,flexWrap:'wrap'}}>
                <div><div className="nsa-disp" style={{fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.6)'}}>Balance Due</div><div className="nsa-disp" style={{fontWeight:800,fontSize:38,color:tAccentLight,lineHeight:1}}>${totalDue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
                <button className="nsa-dbtn nsa-disp" onClick={()=>setPage('billing')} style={{background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'13px 24px',borderRadius:8,cursor:'pointer'}}>Pay Balance →</button>
              </div></>}
            </div>
          </div>
          {/* ── Quick Access ── */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:22,textTransform:'uppercase',letterSpacing:'.5px',color:tPrimary,margin:'8px 0 16px'}}>Quick Access</div>
          <div className="nsa-qa">
            {(()=>{
              // Surface an open team store right on the dashboard — a live store is
              // time-sensitive (it closes), so it earns a tile, not just the nav tab.
              const _openStore=cpStores.find(s=>s.status==='open');
              const _storeClose=_openStore&&_openStore.close_at?new Date(_openStore.close_at).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):'';
              const qa=[
              {k:'orders',t:'Orders',sub:activeSOs.length+' active',icon:'📦',accent:false},
              // Estimates live inside the Orders section now (the "Estimates to Approve"
              // dropdown), so there's no separate Estimates tile here.
              ...(hasStore?[{k:'store',t:'Team Store',sub:openStoreCount>0?('Open now'+(_storeClose?' · closes '+_storeClose:'')):'View store',icon:'🛒',accent:true,sa:openStoreCount>0}]:[]),
              {k:'art',t:'Art Locker',sub:artLibrary.length+' design'+(artLibrary.length!==1?'s':''),icon:'🎨',accent:false},
              {k:'billing',t:'Billing',sub:totalDue>0?'$'+totalDue.toLocaleString(undefined,{minimumFractionDigits:2})+' due':'Up to date',icon:'💳',accent:true,sa:totalDue>0},
              {k:'shop',t:'Catalogs',sub:'Browse the team store',icon:'🛍️',accent:false},
              ...(adData?[{k:'spend',t:adData.hasPromo?'Promo & Spend':'Spend Report',sub:adData.hasPromo?adData.money2(adData.remainingDisplay)+' promo balance':'View report',icon:'📊',accent:false,onClick:()=>setSpendView(true)}]:[]),
            ];
            return qa.map(q=>(
              <button key={q.k} className="nsa-dtile" onClick={q.onClick||(()=>setPage(q.k))} style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,padding:22,display:'flex',alignItems:'center',gap:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',cursor:'pointer',textAlign:'left'}}>
                <span style={{width:48,height:48,flexShrink:0,borderRadius:12,background:q.accent?tAccent:tPrimary,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>{q.icon}</span>
                <span style={{minWidth:0}}>
                  <span className="nsa-disp" style={{display:'block',fontWeight:700,fontSize:19,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>{q.t}</span>
                  {q.sa?<span style={{display:'inline-flex',alignItems:'center',gap:6,marginTop:6,background:tAccentSoft,color:tAccent,fontSize:12,fontWeight:700,borderRadius:999,padding:'4px 10px 4px 8px'}}><span style={{width:6,height:6,borderRadius:999,background:tAccent,flexShrink:0}}/>{q.sub}</span>:<span style={{display:'block',fontSize:13,color:'#5A6075',marginTop:4}}>{q.sub}</span>}
                </span>
              </button>
            ));})()}
          </div>
          {/* ── Needs Your Attention ── */}
          <div className="nsa-attn" style={{marginTop:28}}>
            {(()=>{const openE=custEsts.filter(e=>e.status==='sent'||e.status==='open').slice(0,3);return(
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 22px'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Estimates to Approve</div>
                <button onClick={()=>setPage('orders')} className="nsa-disp" style={{background:'none',border:'none',cursor:'pointer',color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase'}}>View all →</button>
              </div>
              {openE.length===0?<div style={{padding:'0 22px 18px',color:'#5A6075',fontSize:13}}>You're all caught up — nothing waiting.</div>:
               openE.map(est=>{const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';const tt=calcEstTotal(est);
                return<div key={est.id} className="nsa-card" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn||est.memo||est.id}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo||est.id} · ${tt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  </div>
                  <button className="nsa-dbtn nsa-disp" onClick={(ev)=>{ev.stopPropagation();setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{flexShrink:0,background:tPrimary,color:'#fff',border:'none',fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 18px',borderRadius:8,cursor:'pointer'}}>Approve</button>
                </div>})}
            </div>);})()}
            {(()=>{const jobs=waitingArtJobs.slice(0,3);return(
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 22px'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>Designs to Review</div>
                <button onClick={()=>setPage('art')} className="nsa-disp" style={{background:'none',border:'none',cursor:'pointer',color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase'}}>Art Locker →</button>
              </div>
              {jobs.length===0?<div style={{padding:'0 22px 18px',color:'#5A6075',fontSize:13}}>No proofs waiting on you right now.</div>:
               jobs.map((j,ix)=>{const so=j.so;
                return<div key={j.id} className="nsa-card" style={{display:'flex',alignItems:'center',gap:12,padding:'12px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>{setSoView(so);setJobView({job:j,so});setComment('')}}>
                  <div className="nsa-disp" style={{width:46,height:54,flexShrink:0,borderRadius:12,background:`linear-gradient(150deg, ${tPrimary} 0%, ${tNavyMid} 100%)`,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,.85)',fontWeight:800,fontSize:16}}>{String(ix+1).padStart(2,'0')}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.art_name||so.memo||'Artwork'}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo||so.id}</div>
                  </div>
                  <button className="nsa-dbtn nsa-disp" onClick={(ev)=>{ev.stopPropagation();setSoView(so);setJobView({job:j,so});setComment('')}} style={{flexShrink:0,background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:12,letterSpacing:'.5px',textTransform:'uppercase',padding:'7px 14px',borderRadius:8,cursor:'pointer'}}>Review</button>
                </div>})}
            </div>);})()}
          </div>
          {/* ── Rep + Contact ── */}
          <div className="nsa-rep" style={{marginTop:24}}>
            <div style={{position:'relative',overflow:'hidden',borderRadius:16,padding:'24px 28px',color:'#fff',background:`linear-gradient(120deg, ${tPrimary}, ${tNavyMid})`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>
              <div style={{position:'relative',minWidth:0}}>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:tAccentLight}}>Your Dedicated Rep</div>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:26,textTransform:'uppercase',marginTop:4}}>{rep?.name||'NSA Team'}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,.7)',marginTop:3}}>Knows your teams, your colors, your deadlines.</div>
              </div>
              <a href={`mailto:${rep?.email||'team@nsa-teamwear.com'}`} className="nsa-dbtn nsa-disp" style={{position:'relative',flexShrink:0,background:tAccent,color:'#fff',textDecoration:'none',fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px 22px',borderRadius:8}}>Contact {(rep?.name||'NSA Team').split(' ')[0]}</a>
            </div>
            <div style={{background:'#fff',border:'1px dashed #D1D5DE',borderRadius:16,padding:'20px 22px'}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary}}>Contact &amp; Shipping</div>
              <div style={{fontSize:13,color:'#5A6075',margin:'6px 0 12px'}}>{(customer.contacts||[])[0]?.name||'—'}{(customer.contacts||[])[0]?.email?' · '+(customer.contacts||[])[0].email:''}{customer.shipping_city?' · '+customer.shipping_city+', '+(customer.shipping_state||''):''}</div>
              <button onClick={()=>setContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})} className="nsa-dbtn nsa-disp" style={{background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:13,textTransform:'uppercase',padding:'8px 16px',borderRadius:8,cursor:'pointer'}}>Request Update</button>
            </div>
          </div>
        </div>}
        {/* ── ART LOCKER (NSA spec — navy proof tiles) ── */}
        {page==='art'&&(()=>{
          const decos=['all',...Array.from(new Set(artLibrary.map(a=>a.deco).filter(Boolean)))];
          const q=artQuery.trim().toLowerCase();
          const _tfName=isP&&teamFilter!=='all'?_teamName(teamFilter):null;
          let filtered=artLibrary.filter(a=>(artDeco==='all'||a.deco===artDeco)&&(!q||a.name.toLowerCase().includes(q)||(a.deco||'').toLowerCase().includes(q))&&(!_tfName||(a.teams||[]).includes(_tfName)));
          if(isP)filtered=[...filtered].sort((a,b)=>((a.teams||[])[0]||'').localeCompare((b.teams||[])[0]||''));
          return<div>
            <style>{`.nsa-artgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}@media(max-width:980px){.nsa-artgrid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.nsa-artgrid{grid-template-columns:1fr}}.nsa-arttile{background:#fff;border:1px solid #EEF1F6;border-radius:16px;overflow:hidden;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .25s,box-shadow .25s}.nsa-arttile:hover{transform:translateY(-6px);box-shadow:0 16px 40px rgba(0,0,0,.22)}
            .nsa-dbtn{transition:transform .15s ease,filter .15s ease}.nsa-dbtn:hover{transform:translateY(-1px);filter:brightness(1.07)}`}</style>
            <div style={{marginBottom:24}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Proofs &amp; Approved Designs</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Art Locker</h1>
              <div style={{width:60,height:4,background:tAccent,borderRadius:999,marginTop:10}}/>
            </div>
            {artLibrary.length===0?
              <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,padding:'48px',textAlign:'center',color:'#5A6075'}}>Every design we mock up for your team is collected here — ready to view, download &amp; re-order.</div>
            :<>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:18}}>
                <input value={artQuery} onChange={e=>setArtQuery(e.target.value)} placeholder={'Search '+artLibrary.length+' design'+(artLibrary.length!==1?'s':'')+'…'} style={{flex:'1 1 220px',minWidth:160,padding:'11px 14px',border:'1px solid #EEF1F6',borderRadius:8,fontSize:14,fontFamily:'inherit'}}/>
                {isP&&_teamSelect}
                {decos.length>2&&decos.map(d=>{const on=artDeco===d;return<button key={d} onClick={()=>setArtDeco(d)} className="nsa-dbtn nsa-disp" style={{border:'none',background:on?tPrimary:'#fff',color:on?'#fff':'#5A6075',borderRadius:999,padding:'9px 16px',fontSize:12,fontWeight:700,cursor:'pointer',textTransform:'uppercase',letterSpacing:'.5px',boxShadow:on?'none':'0 1px 2px rgba(0,0,0,.06)'}}>{d==='all'?'All':d}</button>})}
              </div>
              {filtered.length===0?<div style={{color:'#5A6075',fontSize:14,padding:'24px',textAlign:'center'}}>No designs match your search.</div>:
              <div className="nsa-artgrid">
                {filtered.map(a=>{const u=a.urls[0];const isPdf=_isPdfUrl(u);const thumb=isPdf?_cloudinaryPdfThumb(u):u;
                  return<div key={a.key} className="nsa-arttile" onClick={()=>setArtView({art:a,idx:0})}>
                    <div style={{position:'relative',aspectRatio:'4 / 3.4',background:`linear-gradient(150deg, ${tNavyDark} 0%, ${tPrimary} 55%, ${tNavyMid} 100%)`,display:'flex',alignItems:'center',justifyContent:'center',padding:14,overflow:'hidden'}}>
                      <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
                      {thumb&&isUrl(thumb)?<img src={thumb} alt={a.name} loading="lazy" style={{position:'relative',maxWidth:'100%',maxHeight:'100%',objectFit:'contain',filter:'drop-shadow(0 6px 16px rgba(0,0,0,.35))'}}/>:<span className="nsa-disp" style={{position:'relative',color:'rgba(255,255,255,.9)',fontSize:48,fontWeight:800}}>{cpMonogram}</span>}
                      {a.deco&&<span className="nsa-disp" style={{position:'absolute',top:10,left:10,background:tAccent,color:'#fff',fontWeight:700,fontSize:10,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 10px',borderRadius:999}}>{a.deco}</span>}
                      {a.urls.length>1&&<span style={{position:'absolute',bottom:8,right:8,fontSize:10,fontWeight:800,background:'rgba(0,0,0,.5)',color:'#fff',borderRadius:999,padding:'2px 8px'}}>⊞ {a.urls.length}</span>}
                    </div>
                    <div style={{padding:'12px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                      <div style={{minWidth:0}}>
                        <div className="nsa-disp" style={{fontWeight:700,fontSize:15,textTransform:'uppercase',color:tPrimary,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
                        <div style={{fontSize:12,color:'#94A0B0',marginTop:1}}>{a.orders.length} order{a.orders.length!==1?'s':''}{isP&&a.teams.length?' · '+a.teams[0]:''}</div>
                      </div>
                      <span title="Approved" style={{width:9,height:9,borderRadius:'50%',background:'#1F7A43',flexShrink:0}}/>
                    </div>
                  </div>;
                })}
              </div>}
            </>}
          </div>;
        })()}

        {false&&(!waitingArtJobs.length&&!openInvs.length&&!paidInvs.length&&!activeSOs.length&&!completedSOs.length&&!custEsts.length&&!paySuccess)&&
          <div style={{color:'#94a3b8',fontSize:13,padding:'24px 4px',textAlign:'center',border:'1px dashed #e2e8f0',borderRadius:10}}>No orders, estimates, or invoices yet.<br/>Your rep will post them here as they come in.</div>}

        {/* Payment success banner */}
        {page==='home'&&paySuccess&&<div style={{padding:16,background:paySuccess.processing?'#fffbeb':'#f0fdf4',border:'2px solid '+(paySuccess.processing?'#f59e0b':'#22c55e'),borderRadius:12,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>{paySuccess.processing?'⏳':'✅'}</div>
          <div style={{fontSize:18,fontWeight:800,color:paySuccess.processing?'#92400e':'#166534',marginBottom:4}}>{paySuccess.processing?'Payment Processing':'Payment Successful!'}</div>
          <div style={{fontSize:14,color:paySuccess.processing?'#92400e':'#166534'}}>${paySuccess.amount.toLocaleString(undefined,{minimumFractionDigits:2})}{paySuccess.processing?' is processing':' paid'}{paySuccess.fee>0?' + $'+paySuccess.fee.toFixed(2)+' processing fee':''}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:4}}>{paySuccess.processing?'This can take a few minutes to confirm. Your invoice will update automatically once it clears.':'Your account has been updated. Download or email yourself an itemized receipt below.'}</div>
          {paySuccess.intentId&&<div style={{marginTop:14,paddingTop:14,borderTop:'1px solid '+(paySuccess.processing?'#fde68a':'#bbf7d0')}}>
            <a href={'/.netlify/functions/receipt?payment_intent_id='+encodeURIComponent(paySuccess.intentId)} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',background:'#1e3a5f',color:'white',textDecoration:'none',padding:'9px 18px',borderRadius:8,fontSize:14,fontWeight:700}}>📄 Download receipt</a>
            <div style={{marginTop:12,fontSize:12,color:'#475569',fontWeight:600}}>Or email a copy:</div>
            <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:6,flexWrap:'wrap'}}>
              <input type="email" value={receiptEmail} onChange={e=>{setReceiptEmail(e.target.value);if(receiptStatus)setReceiptStatus(null);}} placeholder="you@example.com" style={{flex:'1 1 200px',maxWidth:280,padding:'9px 12px',border:'1px solid #cbd5e1',borderRadius:8,fontSize:14}}/>
              <button onClick={sendReceipt} disabled={receiptStatus==='sending'} style={{background:receiptStatus==='sending'?'#94a3b8':'#2563eb',color:'white',border:'none',padding:'9px 18px',borderRadius:8,fontSize:14,fontWeight:700,cursor:receiptStatus==='sending'?'default':'pointer'}}>{receiptStatus==='sending'?'Sending…':'✉️ Email receipt'}</button>
            </div>
            {receiptStatus==='sent'&&<div style={{fontSize:12,color:'#166534',marginTop:8,fontWeight:600}}>✓ Receipt sent to {receiptEmail}</div>}
            {receiptStatus==='error'&&<div style={{fontSize:12,color:'#b91c1c',marginTop:8,fontWeight:600}}>Couldn't send — check the email address and try again.</div>}
          </div>}
        </div>}

        {/* Artwork awaiting approval — now surfaced via the Dashboard "Designs to Review" card */}
        {false&&waitingArtJobs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#d97706',marginBottom:10}}>🎨 Artwork to Approve ({waitingArtJobs.length})</div>
          {waitingArtJobs.map(j=>{const so=j.so;const soAF=safeArt(so);
            const _jArtIds=new Set((j._art_ids||[j.art_file_id].filter(Boolean)).filter(Boolean));
            (j.items||[]).forEach(gi=>{const it=safeItems(so)[gi.item_idx];if(!it)return;safeDecos(it).forEach(d=>{if(d.kind==='art'&&d.art_file_id&&d.art_file_id!=='__tbd')_jArtIds.add(d.art_file_id)})});
            const _jArtFiles=[..._jArtIds].map(aid=>soAF.find(a=>a.id===aid)).filter(Boolean);
            const _jSkus=new Set((j.items||[]).map(gi=>{const it=safeItems(so)[gi.item_idx];return it?.sku||gi.sku}).filter(Boolean));
            const _jIm=_filterDisplayable(_jArtFiles.flatMap(af3=>Object.entries(af3?.item_mockups||{}).filter(([k])=>_jSkus.has(k.split('|')[0])).flatMap(([,arr])=>arr||[])));
            const _jMf=_jIm.length===0?_filterDisplayable(_jArtFiles.flatMap(af3=>af3?.mockup_files||af3?.files||[])):[];
            const _seen=new Set();const mockups=[..._jIm,..._jMf].filter(f=>{const u=typeof f==='string'?f:(f?.url||'');if(!u||_seen.has(u))return false;_seen.add(u);return true});
            const firstMock=mockups[0];const fmUrl=firstMock?(typeof firstMock==='string'?firstMock:firstMock.url):'';
            const fmIsImg=fmUrl&&_isImgUrl(fmUrl,firstMock);const fmIsPdf=fmUrl&&_isPdfUrl(fmUrl,firstMock);const fmPdfThumb=fmIsPdf?_cloudinaryPdfThumb(fmUrl):null;
            return<div key={j.id} style={{border:'2px solid #f59e0b',borderRadius:10,marginBottom:10,background:'#fffbeb',cursor:'pointer',overflow:'hidden'}} onClick={()=>{setSoView(so);setJobView({job:j,so});setComment('')}}>
              <div style={{display:'flex',gap:12,alignItems:'center',padding:12}}>
                <div style={{width:72,height:72,flexShrink:0,borderRadius:8,overflow:'hidden',background:'white',border:'1px solid #fde68a',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {fmIsImg&&isUrl(fmUrl)?<img src={fmUrl} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :fmIsPdf&&fmPdfThumb?<img src={fmPdfThumb} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                  :<span style={{fontSize:28}}>🎨</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,color:'#92400e'}}>{j.art_name||'Artwork'}</div>
                  <div style={{fontSize:11,color:'#78350f',marginTop:2}}>{so.memo||so.id} · {(j.deco_type||'').replace(/_/g,' ')||'—'}</div>
                  <div style={{marginTop:6}}><span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e'}}>⏳ Awaiting Your Approval</span></div>
                </div>
                <span style={{color:'#94a3b8',fontSize:14}}>›</span>
              </div>
            </div>})}
        </>}

        {/* Estimates awaiting approval — needs coach attention */}
        {page==='estimates'&&(()=>{
          const _tf=e=>!isP||teamFilter==='all'||e.customer_id===teamFilter;
          const openEsts=custEsts.filter(e=>(e.status==='sent'||e.status==='open')&&_tf(e));
          const approvedEsts=custEsts.filter(e=>e.status==='approved'&&_tf(e));
          if(isP){openEsts.sort(_teamSort);approvedEsts.sort(_teamSort);}
          const cards=[...openEsts.map(e=>({e,ap:false})),...approvedEsts.map(e=>({e,ap:true}))];
          return<div>
            <style>{`.nsa-estgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:760px){.nsa-estgrid{grid-template-columns:1fr}}`}</style>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:24}}>
              <div>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Awaiting Your Approval</div>
                <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Estimates</h1>
                <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                {isP&&_teamSelect}
                {openEsts.length>0&&<div className="nsa-disp" style={{transform:'skewX(-6deg)',background:tAccent,color:'#fff',padding:'10px 18px',borderRadius:4}}><div style={{transform:'skewX(6deg)',textAlign:'center'}}><div style={{fontWeight:800,fontSize:30,lineHeight:1}}>{openEsts.length}</div><div style={{fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',opacity:.9}}>to approve</div></div></div>}
              </div>
            </div>
            {cards.length===0?<div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,padding:'40px',textAlign:'center',color:'#5A6075'}}>No estimates right now — your rep will post quotes here.</div>:
            <div className="nsa-estgrid">
              {cards.map(({e:est,ap})=>{const t=calcEstTotal(est);const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';
                return<div key={est.id} style={{position:'relative',background:'#fff',border:'1px solid #EEF1F6',borderLeft:`4px solid ${ap?'#1F7A43':tAccent}`,borderRadius:6,padding:'20px 22px',boxShadow:'0 2px 12px rgba(0,0,0,.06)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                    <div style={{minWidth:0}}>
                      <div className="nsa-disp" style={{fontWeight:800,fontSize:19,textTransform:'uppercase',color:tPrimary,lineHeight:1.05}}>{tn||est.memo||est.id}</div>
                      <div style={{fontSize:13,color:'#5A6075',marginTop:3}}>{est.memo||'Estimate'} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div>
                      <div style={{fontSize:12,color:'#94A0B0',marginTop:2}}>{est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
                    </div>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:24,color:tPrimary,textAlign:'right',flexShrink:0}}>${t.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  </div>
                  <div style={{marginTop:16}}>
                    {ap?
                      <div className="nsa-disp" style={{background:'#E8F5EC',color:'#1F7A43',borderRadius:4,padding:'10px',textAlign:'center',fontWeight:800,fontSize:14}}>✓ Approved</div>
                    :<div style={{display:'flex',gap:10}}>
                      <button className="nsa-skew nsa-disp" onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{flex:1,background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px',borderRadius:4,cursor:'pointer'}}><span>Approve Estimate</span></button>
                      <button className="nsa-disp" onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{background:'transparent',color:tPrimary,border:`2px solid ${tPrimary}`,fontWeight:700,fontSize:14,textTransform:'uppercase',padding:'11px 16px',borderRadius:4,cursor:'pointer'}}>Details</button>
                    </div>}
                  </div>
                </div>;
              })}
            </div>}
          </div>;
        })()}

        {/* ── BILLING (NSA spec — invoice history + balance panel) ── */}
        {page==='billing'&&(()=>{
          const allInv=[...openInvs,...paidInvs];
          return<div>
            <style>{`.nsa-bill{display:grid;grid-template-columns:1.5fr 1fr;gap:24px;align-items:start}@media(max-width:820px){.nsa-bill{grid-template-columns:1fr}}`}</style>
            <div style={{marginBottom:24}}>
              <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Invoices &amp; Payments</div>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Billing</h1>
              <div style={{width:60,height:4,background:tAccent,transform:'skewX(-12deg)',marginTop:10}}/>
            </div>
            <div className="nsa-bill">
              <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:6,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
                <div className="nsa-disp" style={{padding:'14px 22px',background:'#F7F8FB',fontWeight:800,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',color:tPrimary}}>Invoice History</div>
                {allInv.length===0?<div style={{padding:'28px 22px',color:'#5A6075',fontSize:13}}>No invoices yet.</div>:
                 allInv.map(inv=>{const open=inv.status==='open'||inv.status==='partial';const bal=(inv.total||0)-(inv.paid||0);
                  return<div key={inv.id} className="nsa-card" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'14px 22px',borderTop:'1px solid #EEF1F6',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                    <div style={{minWidth:0}}>
                      <div className="nsa-disp" style={{fontWeight:700,fontSize:16,color:tPrimary}}>{inv.id}</div>
                      <div style={{fontSize:13,color:'#5A6075',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{inv.date||''}{inv.memo?' · '+inv.memo:''}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                      <span className="nsa-disp" style={{fontWeight:700,fontSize:18,color:tPrimary}}>${(open?bal:(inv.total||0)).toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                      <span className="nsa-disp" style={{display:'inline-block',transform:'skewX(-6deg)',background:open?tAccentSoft:'#E8F5EC',color:open?tAccent:'#1F7A43',fontWeight:700,fontSize:11,letterSpacing:'.5px',textTransform:'uppercase',padding:'4px 11px',borderRadius:4}}><span style={{display:'inline-block',transform:'skewX(6deg)'}}>{open?'Open':'Paid'}</span></span>
                    </div>
                  </div>})}
              </div>
              <div style={{position:'relative',overflow:'hidden',borderRadius:6,padding:28,color:'#fff',background:`linear-gradient(135deg, ${tNavyDark}, ${tPrimary})`}}>
                <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
                <div style={{position:'relative'}}>
                  <div className="nsa-disp" style={{fontSize:13,letterSpacing:'1px',textTransform:'uppercase',color:'rgba(255,255,255,.7)'}}>Total Balance Due</div>
                  <div className="nsa-disp" style={{fontWeight:800,fontSize:48,color:tAccentLight,lineHeight:1,marginTop:4}}>${totalDue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style={{fontSize:13,color:'rgba(255,255,255,.7)',marginTop:6}}>{totalDue>0?'Net 30 terms · pay by card or PO':"You're all paid up — thank you!"}</div>
                  {!ccDisabled&&totalDue>0&&<button onClick={()=>{setPayLoading(true);setShowPay('all')}} disabled={payLoading} className="nsa-skew nsa-disp" style={{width:'100%',marginTop:18,background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:16,letterSpacing:'.5px',textTransform:'uppercase',padding:'14px',borderRadius:4,cursor:payLoading?'wait':'pointer'}}><span>{payLoading?'Opening checkout…':'Pay Balance'}</span></button>}
                  <div style={{height:1,background:'rgba(255,255,255,.15)',margin:'18px 0 12px'}}/>
                  <div style={{fontSize:12,color:'rgba(255,255,255,.6)'}}>💳 Credit card · Apple Pay · 🏦 ACH/Bank · or pay by PO</div>
                </div>
              </div>
            </div>
          </div>;
        })()}

        {/* ── ORDERS (NSA spec — embedded estimates panel + order history table) ── */}
        {page==='orders'&&(()=>{
          const statusMap={complete:['Delivered','#5A6075','#EEF1F6'],shipped:['Shipped','#1F7A43','#E8F5EC'],bagging:['Bagging','#1A3A6B','#E6ECF5'],in_production:['In Production','#1A3A6B','#E6ECF5'],received:['Received','#1A3A6B','#E6ECF5'],pending:['Ordered','#5A6075','#EEF1F6']};
          // Estimates to approve — embedded at top of orders page per new design
          const _tfEst=e=>!isP||teamFilter==='all'||e.customer_id===teamFilter;
          const openEsts=custEsts.filter(e=>(e.status==='sent'||e.status==='open')&&_tfEst(e));
          if(isP)openEsts.sort(_teamSort);
          // Approved-but-not-yet-converted estimates stay visible here (read-only)
          // so they don't vanish between the coach approving and the rep turning
          // them into an order — this panel is the only place estimates now live.
          const approvedEsts=custEsts.filter(e=>e.status==='approved'&&_tfEst(e));
          if(isP)approvedEsts.sort(_teamSort);
          let rows=[...activeSOs,...completedSOs];
          if(isP&&teamFilter!=='all')rows=rows.filter(so=>so.customer_id===teamFilter);
          if(isP)rows=[...rows].sort(_teamSort);
          return<div>
            <style>{`@media(max-width:760px){.nsa-otab{grid-template-columns:1fr!important;gap:8px!important}.nsa-ohead{display:none!important}}
            .nsa-dbtn{transition:transform .15s ease,filter .15s ease}.nsa-dbtn:hover{transform:translateY(-1px);filter:brightness(1.07)}
            .nsa-drow{transition:transform .15s ease,box-shadow .15s ease}.nsa-drow:hover{box-shadow:0 8px 20px rgba(25,40,83,.08)}`}</style>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16,flexWrap:'wrap',marginBottom:24}}>
              <div>
                <div className="nsa-disp" style={{fontWeight:700,fontSize:14,letterSpacing:'2px',textTransform:'uppercase',color:tAccent}}>Active &amp; Recent</div>
                <h1 className="nsa-disp" style={{fontWeight:800,fontSize:40,textTransform:'uppercase',color:tPrimary,margin:'2px 0 0'}}>Orders</h1>
                <div style={{width:60,height:4,background:tAccent,borderRadius:999,marginTop:10}}/>
              </div>
              {isP&&_teamSelect}
            </div>
            {/* ── Estimates — always present in the Orders section as a dropdown; lists
                open (to-approve) first, then approved-awaiting-conversion estimates. ── */}
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderLeft:`4px solid ${tAccent}`,borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden',marginBottom:28}}>
              <button onClick={()=>setEstOpen(o=>!o)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'16px 22px',borderBottom:estOpen?'1px solid #EEF1F6':'none',background:'#FAFBFC',border:'none',cursor:'pointer',textAlign:'left'}}>
                <span style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                  {openEsts.length>0&&<span className="nsa-disp" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:999,background:tAccent,color:'#fff',fontWeight:800,fontSize:13,flexShrink:0}}>{openEsts.length}</span>}
                  <span className="nsa-disp" style={{fontWeight:800,fontSize:18,textTransform:'uppercase',color:tPrimary}}>{openEsts.length>0?'Estimates to Approve':'Estimates'}</span>
                  <span style={{fontSize:13,color:'#5A6075',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{openEsts.length>0?'— approve to start production':approvedEsts.length>0?'— approved, awaiting your rep':'— your rep posts quotes here'}</span>
                </span>
                <span className="nsa-disp" style={{display:'inline-flex',alignItems:'center',gap:6,color:tAccent,fontWeight:700,fontSize:13,textTransform:'uppercase',letterSpacing:'.3px',whiteSpace:'nowrap'}}>{estOpen?'Hide':'Show'}<span style={{fontSize:12}}>{estOpen?'▾':'▸'}</span></span>
              </button>
              {estOpen&&openEsts.map(est=>{const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';const tt=calcEstTotal(est);
                return<div key={est.id} className="nsa-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'14px 22px',borderBottom:'1px solid #EEF1F6',cursor:'pointer',transition:'background .15s'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn||est.memo||est.id}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo||'Estimate'} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''} · {est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:16,flexShrink:0}}>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:18,color:tPrimary}}>${tt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                    <button className="nsa-dbtn nsa-disp" onClick={ev=>{ev.stopPropagation();setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}} style={{background:tAccent,color:'#fff',border:'none',fontWeight:700,fontSize:13,letterSpacing:'.5px',textTransform:'uppercase',padding:'9px 18px',borderRadius:8,cursor:'pointer'}}>Approve</button>
                  </div>
                </div>})}
              {estOpen&&approvedEsts.length>0&&openEsts.length>0&&<div style={{padding:'11px 22px 5px',fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.5px',color:'#94A0B0',background:'#FAFBFC',borderBottom:'1px solid #EEF1F6'}}>Approved — awaiting your rep</div>}
              {estOpen&&approvedEsts.map(est=>{const team=(allCustomers||[]).find(c=>c.id===est.customer_id);const tn=isP?(team?(team.id===customer.id?'Athletic Dept.':team.name):''):'';const tt=calcEstTotal(est);
                return<div key={est.id} className="nsa-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'14px 22px',borderBottom:'1px solid #EEF1F6',cursor:'pointer',transition:'background .15s'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:16,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn||est.memo||est.id}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{est.memo||'Estimate'} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''} · {est.id}{est.created_at?' · '+est.created_at.split(' ')[0]:''}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:16,flexShrink:0}}>
                    <div className="nsa-disp" style={{fontWeight:800,fontSize:18,color:tPrimary}}>${tt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                    <span className="nsa-disp" style={{display:'inline-flex',alignItems:'center',gap:6,background:'#E8F5EC',color:'#1F7A43',fontWeight:800,fontSize:12,letterSpacing:'.5px',textTransform:'uppercase',padding:'8px 14px 8px 12px',borderRadius:999,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:999,background:'#1F7A43',flexShrink:0}}/>Approved</span>
                  </div>
                </div>})}
              {estOpen&&openEsts.length===0&&approvedEsts.length===0&&<div style={{padding:'18px 22px',color:'#5A6075',fontSize:13}}>No estimates right now — your rep posts quotes here for you to review &amp; approve.</div>}
            </div>
            {/* ── Order History table ── */}
            <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Order History</div>
            {rows.length===0?<div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,padding:'40px',textAlign:'center',color:'#5A6075'}}>No orders yet — your rep will post them here.</div>:
            <div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.06)',overflow:'hidden'}}>
              <div className="nsa-disp nsa-otab nsa-ohead" style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 1fr .8fr',gap:16,padding:'14px 24px',background:'#F7F8FB',fontWeight:700,fontSize:12,letterSpacing:'1px',textTransform:'uppercase',color:'#5A6075'}}>
                <span>Order</span><span>Status</span><span>Delivery</span><span style={{textAlign:'right'}}>Total</span>
              </div>
              {rows.map(so=>{
                const st=calcSOStatus(so);const sm=statusMap[st]||['Ordered','#5A6075','#EEF1F6'];
                let totalU=0,fulU=0;safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
                const pct=totalU>0?Math.round(fulU/totalU*100):0;
                const team=(allCustomers||[]).find(c=>c.id===so.customer_id);const tn=isP&&team&&team.id!==customer.id?team.name:(so.memo||so.id);
                const tot=calcOrderTotals(so).grand;
                return<div key={so.id} className="nsa-card nsa-drow nsa-otab" onClick={()=>setSoView(so)} style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 1fr .8fr',gap:16,padding:'16px 24px',borderTop:'1px solid #EEF1F6',cursor:'pointer',alignItems:'center'}}>
                  <div style={{minWidth:0}}>
                    <div className="nsa-disp" style={{fontWeight:700,fontSize:17,textTransform:'uppercase',color:tPrimary,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tn}</div>
                    <div style={{fontSize:13,color:'#5A6075',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.memo||'Order'} · {totalU} pcs · {so.id}</div>
                    <div style={{height:5,background:'#EEF1F6',borderRadius:999,marginTop:9,overflow:'hidden',maxWidth:220}}><div style={{height:'100%',width:pct+'%',background:tPrimary,borderRadius:999}}/></div>
                  </div>
                  <div><span className="nsa-disp" style={{display:'inline-flex',alignItems:'center',gap:6,background:sm[2],color:sm[1],fontWeight:700,fontSize:12,letterSpacing:'.5px',textTransform:'uppercase',padding:'5px 12px 5px 10px',borderRadius:999}}><span style={{width:6,height:6,borderRadius:999,background:sm[1],flexShrink:0}}/>{sm[0]}</span></div>
                  <div style={{fontSize:14,color:'#2A2F3E'}}>{so.expected_date?(st==='shipped'?'Arrives ':'ETA ')+so.expected_date:'—'}</div>
                  <div className="nsa-disp" style={{textAlign:'right',fontWeight:700,fontSize:18,color:tPrimary}}>${tot.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                </div>;
              })}
            </div>}
          </div>;
        })()}
        {/* Active orders (legacy, retired in favor of the NSA table above) */}
        {false&&(activeSOs.length>0||recentEsts.length>0)&&<>
          <button onClick={()=>setOrdersOpen(o=>!o)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',background:'none',border:'none',padding:0,cursor:'pointer',marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:800,color:'#1e3a5f'}}>📦 Active Orders ({activeSOs.length}{recentEsts.length>0?' + '+recentEsts.length+' est':''})</span>
            <span style={{fontSize:11,fontWeight:700,color:'#64748b',display:'inline-flex',alignItems:'center',gap:6,textTransform:'uppercase',letterSpacing:'.04em'}}>{ordersOpen?'Hide':'Show'}<span style={{fontSize:12}}>{ordersOpen?'▾':'▸'}</span></span>
          </button>
          {ordersOpen&&activeSOs.map(so=>{
            let totalU=0,fulU=0;
            safeItems(so).forEach(it=>{Object.entries(safeSizes(it)).filter(([,v])=>v>0).forEach(([sz,v])=>{totalU+=v;const pQ=safePicks(it).filter(pk=>pk.status==='pulled').reduce((a,pk)=>a+safeNum(pk[sz]),0);const rQ=safePOs(it).reduce((a,pk)=>a+safeNum((pk.received||{})[sz]),0);fulU+=Math.min(v,pQ+rQ)})});
            const pct=totalU>0?Math.round(fulU/totalU*100):0;
            const daysOut=so.expected_date?Math.ceil((new Date(so.expected_date)-new Date())/(1000*60*60*24)):null;
            const soJobs=safeJobs(so);
            return<div key={so.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>setSoView(so)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{so.memo||so.id}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Order {so.id} · {so.created_at?.split(' ')[0]}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {so.expected_date&&<div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'#64748b'}}>EXPECTED</div>
                    <div style={{fontSize:14,fontWeight:700,color:daysOut!=null&&daysOut<=7?'#dc2626':'#1e3a5f'}}>{so.expected_date}</div>
                  </div>}
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#64748b'}}>Order Progress</span>
                  <span style={{fontSize:11,fontWeight:700,color:pct>=100?'#166534':'#1e3a5f'}}>{pct}%</span>
                </div>
                <div style={{background:'#e2e8f0',borderRadius:6,height:8,overflow:'hidden'}}>
                  <div style={{height:8,borderRadius:6,background:pct>=100?'#22c55e':pct>50?'#3b82f6':'#f59e0b',width:pct+'%',transition:'width 0.3s'}}/></div>
              </div>
              <div style={{fontSize:12}}>
                {safeItems(so).map((it,ii)=>{const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
                  return<div key={ii} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #f8fafc'}}>
                    <span>{safeStr(it.name)||'Item'} <span style={{color:'#94a3b8'}}>({safeStr(it.color)||'—'})</span></span>
                    <span style={{fontWeight:600,color:'#64748b'}}>{qty} units</span></div>})}
              </div>
              {soJobs.filter(j=>j.art_status==='waiting_approval').length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#fffbeb',border:'1px solid #f59e0b',borderRadius:6,fontSize:11,color:'#92400e',fontWeight:600}}>
                ⏳ {soJobs.filter(j=>j.art_status==='waiting_approval').length} artwork{soJobs.filter(j=>j.art_status==='waiting_approval').length!==1?'s':''} awaiting your approval</div>}
              {safeFirm(so).filter(f=>f.approved).length>0&&<div style={{marginTop:8,padding:'6px 10px',background:'#f0fdf4',borderRadius:6,fontSize:11,color:'#166534'}}>
                📌 Firm date: {(safeFirm(so).filter(f=>f.approved)[0]||{}).date||"TBD"}</div>}
            </div>})}
          {ordersOpen&&recentEsts.map(est=>{const t=calcEstTotal(est);
            const _stLabel={sent:'Awaiting Approval',open:'Open',approved:'Approved',draft:'Draft'}[est.status]||est.status;
            const _stStyle={sent:{background:'#fef3c7',color:'#92400e'},open:{background:'#fef3c7',color:'#92400e'},approved:{background:'#dcfce7',color:'#166534'},draft:{background:'#f1f5f9',color:'#64748b'}}[est.status]||{background:'#f1f5f9',color:'#64748b'};
            return<div key={'recest_'+est.id} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1e3a5f'}}>{est.memo||est.id} <span style={{fontSize:10,fontWeight:700,color:'#94a3b8',padding:'1px 6px',border:'1px solid #e2e8f0',borderRadius:6}}>ESTIMATE</span></div>
                  <div style={{fontSize:11,color:'#64748b'}}>{est.id} · {est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:800,fontSize:15,color:'#1e3a5f'}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,..._stStyle}}>{_stLabel}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>
            </div>})}
        </>}

        {/* Approved estimates — no action needed, listed for reference */}
        {false&&(()=>{const approvedEsts=custEsts.filter(e=>e.status==='approved');
          return approvedEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Approved Estimates ({approvedEsts.length})</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
            {approvedEsts.map((est,i,arr)=>{const t=calcEstTotal(est);
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:'#dcfce7',color:'#166534'}}>Approved</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>
          </>})()}

        {/* Paid invoices (legacy, retired — folded into the NSA Billing invoice history) */}
        {false&&paidInvs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Paid Invoices</div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {paidInvs.slice(0,10).map((inv,i,arr)=>
                <div key={inv.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setInvView(inv)}>
                  <div><span style={{fontWeight:600}}>{inv.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{inv.memo}</span>
                    <div style={{fontSize:10,color:'#64748b'}}>{inv.date}</div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:700,fontSize:13,color:'#166534'}}>${(inv.total||0).toLocaleString()}</span>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,background:'#dcfce7',color:'#166534'}}>Paid</span>
                    <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                  </div>
                </div>)}
            </div>
          </>}

        {/* Completed orders (legacy, retired — folded into the NSA Orders table) */}
        {false&&completedSOs.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#166534',marginBottom:10,marginTop:16}}>✅ Completed Orders</div>
          {completedSOs.slice(0,3).map(so=><div key={so.id} style={{padding:'10px 14px',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setSoView(so)}>
            <div><span style={{fontWeight:600}}>{so.memo||so.id}</span><span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{so.id}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span className="badge badge-green">Complete</span><span style={{color:'#94a3b8',fontSize:14}}>›</span></div></div>)}
        </>}

        {/* Past Estimates — converted/draft, de-emphasized at bottom */}
        {false&&(()=>{const pastEsts=custEsts.filter(e=>e.status==='converted'||e.status==='draft');
          const estBadge=(st)=>({background:st==='converted'?'#dbeafe':'#f1f5f9',color:st==='converted'?'#1e40af':'#64748b'});
          return pastEsts.length>0&&<>
          <div style={{fontSize:13,fontWeight:800,color:'#94a3b8',marginBottom:10,marginTop:16}}>📋 Past Estimates ({pastEsts.length})</div>
          <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginBottom:10,opacity:0.75}}>
            {pastEsts.map((est,i,arr)=>{const t=calcEstTotal(est);
              return<div key={est.id} style={{padding:'10px 14px',borderBottom:i<arr.length-1?'1px solid #f1f5f9':'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>{setEstView(est);setUpdateRequestSent(false);setUpdateRequestText('')}}>
                <div><span style={{fontWeight:600,fontSize:13}}>{est.memo||est.id}</span> <span style={{fontSize:11,color:'#94a3b8'}}>{est.id}</span>
                  <div style={{fontSize:10,color:'#64748b'}}>{est.created_at?.split(' ')[0]} · {(est.items||[]).length} item{(est.items||[]).length!==1?'s':''}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>${t.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:700,...estBadge(est.status)}}>{est.status==='converted'?'Converted':est.status.charAt(0).toUpperCase()+est.status.slice(1)}</span>
                  </div>
                  <span style={{color:'#94a3b8',fontSize:14}}>›</span>
                </div>
              </div>})}
          </div>
          </>})()}

        </div>{/* ── /LEFT COLUMN ── */}

        {/* ── Team store, shop & home tools ── */}
        <div className="cp-col">

        {/* ── SHOP / CATALOGS (NSA redesign — hero + Shop & Order tiles + Catalogs & Stores) ── */}
        {page==='store'&&<div>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:'clamp(26px,4vw,34px)',textTransform:'uppercase',color:tPrimary,lineHeight:1,marginBottom:6}}>Team Store Tracking</div>
          <div style={{fontSize:14,color:'#5A6075',marginBottom:22}}>Live orders, fundraising and production status for your team store{cpVisibleStores.length>1?'s':''}.</div>
          <CoachStore customer={customer} storeIds={cpStoreCustomerIds}/>
        </div>}

        {/* Roster orders — spreadsheet-style season kit ordering per team */}
        {page==='roster'&&<div>
          <div className="nsa-disp" style={{fontWeight:800,fontSize:'clamp(26px,4vw,34px)',textTransform:'uppercase',color:tPrimary,lineHeight:1,marginBottom:6}}>Roster Orders</div>
          <div style={{fontSize:14,color:'#5A6075',marginBottom:22}}>Build your team, fill in player sizes, and submit to {rep?.name||'your rep'} when you're ready.</div>
          <RosterOrdersCoach customer={customer} />
        </div>}

        {page==='shop'&&<div>
          {/* National Team Shop sign-in nudge — only when NO coach session exists.
              Verifying once creates the supabaseCoach session that turns the
              National Team Shop tile below into a one-click signed-in handoff. */}
          {ntsSession===null&&!ntsBannerHidden&&<div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',background:'#F7F8FB',border:'1px solid #EEF1F6',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#2A2F3E'}}>
            <span style={{fontWeight:600}}>Verify your email once to enable one-click shopping on National Team Shop</span>
            {ntsOtpState==='sent'?<span style={{color:'#1F7A43',fontWeight:600}}>Check your email for the sign-in link.</span>:<>
              <input type="email" value={ntsEmail} onChange={e=>setNtsEmail(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')ntsSendOtp();}} placeholder="coach@school.org" style={{flex:'1 1 180px',minWidth:150,padding:'6px 10px',border:'1px solid #D1D5DE',borderRadius:6,fontSize:13,fontFamily:'inherit'}}/>
              <button onClick={ntsSendOtp} disabled={ntsOtpState==='sending'} style={{background:tPrimary,color:'#fff',border:'none',borderRadius:6,padding:'7px 14px',fontSize:12.5,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{ntsOtpState==='sending'?'Sending…':'Email me a link'}</button>
              {ntsOtpState==='error'&&<span style={{color:'#962C32',fontSize:12}}>Couldn't send — try again.</span>}
            </>}
            <button onClick={()=>{setNtsBannerHidden(true);try{localStorage.setItem('cp_nts_banner_dismissed','1');}catch{/* won't persist */}}} aria-label="Dismiss" style={{marginLeft:'auto',background:'none',border:'none',color:'#94A0B0',fontSize:16,cursor:'pointer',lineHeight:1,padding:0}}>×</button>
          </div>}
          {/* Hero */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:8,boxShadow:'0 16px 40px rgba(0,0,0,.25)',background:`linear-gradient(120deg, ${tNavyDark} 0%, ${tPrimary} 55%, ${tNavyMid} 100%)`,color:'#fff',padding:'48px 44px',marginBottom:32}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:0,right:0,bottom:0,width:'40%',background:tAccent,opacity:.14,clipPath:'polygon(30% 0,100% 0,100% 100%,0 100%)',pointerEvents:'none'}}/>
            <div style={{position:'relative',maxWidth:560}}>
              <h1 className="nsa-disp" style={{fontWeight:800,fontSize:48,lineHeight:.98,textTransform:'uppercase',margin:'0 0 14px'}}>Outfit Your Team <em style={{fontStyle:'italic',color:tAccentLight}}>The Right Way</em></h1>
              <p style={{fontSize:16,lineHeight:1.6,color:'rgba(255,255,255,.82)',margin:'0 0 24px'}}>Browse live inventory at your team pricing and colors, build an order, or open a spirit-pack store — all in your team's gear.</p>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                <a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-skew nsa-disp" style={{background:tAccent,color:'#fff',textDecoration:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'13px 28px',borderRadius:4}}><span>Browse Gear</span></a>
                <a href={CP_MARKETING+'/design-lab'} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-disp" style={{background:'transparent',color:'#fff',border:'2px solid rgba(255,255,255,.6)',textDecoration:'none',fontWeight:700,fontSize:15,letterSpacing:'.5px',textTransform:'uppercase',padding:'11px 26px',borderRadius:4}}>Custom Quote</a>
              </div>
            </div>
          </div>

          {/* Build a team store — invite-only self-serve */}
          {coachAiBuilder&&<button onClick={()=>setStoreBuilder(true)} style={{width:'100%',textAlign:'left',border:'none',cursor:'pointer',background:`linear-gradient(135deg,${tNavyDark},${tPrimary})`,color:'#fff',borderRadius:8,padding:'18px 24px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,boxShadow:'0 2px 10px rgba(15,23,42,.12)'}}>
            <div>
              <div className="nsa-disp" style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',textTransform:'uppercase',opacity:.7}}>New</div>
              <div className="nsa-disp" style={{fontSize:20,fontWeight:800,marginTop:2,textTransform:'uppercase'}}>Build Your Team Store</div>
              <div style={{fontSize:13,opacity:.85,marginTop:3}}>Pick your gear, add your colors &amp; logo, and submit it — we'll publish it for you.</div>
            </div>
            <div className="nsa-disp" style={{fontSize:14,fontWeight:800,background:'rgba(255,255,255,.16)',border:'1px solid rgba(255,255,255,.3)',borderRadius:4,padding:'10px 18px',whiteSpace:'nowrap'}}>Start →</div>
          </button>}

          {/* Shop & Order section */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Shop &amp; Order</div>

          {/* National Team Shop tile — one-click handoff (Coach Crossover) */}
          <button onClick={openTeamShop} className="nsa-tile" style={{width:'100%',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',gap:22,background:`linear-gradient(120deg, ${tPrimary} 0%, ${tNavyMid} 100%)`,border:`1px solid ${tPrimary}`,borderRadius:8,padding:'26px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.1)',position:'relative',overflow:'hidden',marginBottom:14,fontFamily:'inherit'}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'relative',width:58,height:58,flexShrink:0,borderRadius:8,background:tAccent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>🛍️</div>
            <div style={{position:'relative',flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:24,textTransform:'uppercase',color:'#fff',lineHeight:1}}>National Team Shop</div>
                <span style={{display:'inline-flex',alignItems:'center',background:'rgba(150,44,50,.25)',border:`1px solid ${tAccentLight}`,color:tAccentLight,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:11,letterSpacing:'1px',textTransform:'uppercase',padding:'3px 9px',borderRadius:999}}>New</span>
              </div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.78)',marginTop:5}}>Quick-turn custom gear — your logos, your pricing</div>
            </div>
            <div style={{position:'relative',flexShrink:0,color:'rgba(255,255,255,.6)',fontSize:24}}>›</div>
          </button>

          {/* Team Shop orders — compact recent-orders peek (Stage 8). Only
              renders once a coach session exists; the verify-email banner
              above already invites sign-in when there's none. */}
          {ntsSession&&ntsOrders&&<div style={{background:'#fff',border:'1px solid #EEF1F6',borderRadius:16,padding:'18px 22px',marginBottom:14,boxShadow:'0 2px 12px rgba(0,0,0,.06)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:15,textTransform:'uppercase',color:tPrimary}}>Team Shop orders</div>
              <button onClick={openTeamShop} style={{background:'none',border:'none',color:tAccent,fontWeight:700,fontSize:12.5,cursor:'pointer',fontFamily:'inherit',padding:0}}>View all →</button>
            </div>
            {!ntsOrders.length&&<div style={{fontSize:13,color:'#64748b',padding:'6px 0'}}>No orders yet — browse National Team Shop to place your first one.</div>}
            {ntsOrders.slice(0,3).map(o=>{
              const first=o.items&&o.items[0];
              const extra=o.items?o.items.length-1:0;
              const label=first?(first.name||first.sku||'Item')+(extra>0?` + ${extra} more`:''):'Order';
              return(
                <div key={o.id} style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'9px 0',borderTop:'1px solid #F1F5F9'}}>
                  <div style={{flex:'1 1 200px',minWidth:0}}>
                    <div style={{fontSize:13.5,fontWeight:700,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</div>
                    <div style={{fontSize:11.5,color:'#64748b',marginTop:2}}>{o.created_at?new Date(o.created_at).toLocaleDateString():''}</div>
                  </div>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,fontWeight:800,padding:'4px 9px 4px 8px',borderRadius:999,background:'#F1F5F9',color:'#475569',whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:999,background:'#475569',flexShrink:0}}/>{ntsStatusLabel(o)}</span>
                  {/* /shop/order/<token> is host-agnostic (src/index.js checks the
                      PATH before any host routing — see OrderTrack.js's header
                      comment), so a relative link works from this portal's own
                      origin same as it would from nationalteamshop.com. */}
                  {o.status_token&&<a href={'/shop/order/'+o.status_token} target={CP_LINK_TARGET} rel="noopener noreferrer" style={{fontSize:11.5,fontWeight:700,color:tAccent,textDecoration:'none',whiteSpace:'nowrap'}}>Track ↗</a>}
                </div>
              );
            })}
          </div>}

          {/* Live Look tile — the highlight */}
          <a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:`linear-gradient(120deg, ${tPrimary} 0%, ${tNavyMid} 100%)`,border:`1px solid ${tPrimary}`,borderRadius:8,padding:'26px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.1)',position:'relative',overflow:'hidden',marginBottom:14}}>
            <div style={{position:'absolute',inset:0,background:_nsaHash,pointerEvents:'none'}}/>
            <div style={{position:'relative',width:58,height:58,flexShrink:0,borderRadius:8,background:tAccent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>👁️</div>
            <div style={{position:'relative',flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div className="nsa-disp" style={{fontWeight:800,fontSize:24,textTransform:'uppercase',color:'#fff',lineHeight:1}}>Live Look — Shop Live Inventory</div>
                <span style={{display:'inline-flex',alignItems:'center',gap:5,background:'rgba(31,122,67,.22)',border:'1px solid #2EC971',color:'#8FF0B5',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:11,letterSpacing:'1px',textTransform:'uppercase',padding:'3px 9px',borderRadius:999}}><span style={{width:7,height:7,borderRadius:999,background:'#2EC971',display:'inline-block'}}/> Live</span>
              </div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.78)',marginTop:5}}>Browse in-stock gear at your team pricing &amp; colors — real-time inventory.</div>
            </div>
            <div style={{position:'relative',flexShrink:0,color:'rgba(255,255,255,.6)',fontSize:24}}>›</div>
          </a>

          {/* Build & Submit an Order tile */}
          {coachBuildOrders&&<a href={CP_LIVELOOK_URL} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:'#fff',border:'1px solid #EEF1F6',borderRadius:8,padding:'22px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.06)',marginBottom:32}}>
            <div style={{width:54,height:54,flexShrink:0,borderRadius:8,background:'#F7F8FB',color:tPrimary,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>🧾</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:21,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>Build &amp; Submit an Order</div>
              <div style={{fontSize:14,color:'#5A6075',marginTop:5}}>Put an order together and send it to {rep?.name||'your rep'} for a quote.</div>
            </div>
            <div style={{flexShrink:0,color:'#94A0B0',fontSize:24}}>›</div>
          </a>}
          {!coachBuildOrders&&<div style={{marginBottom:32}}/>}

          {/* Catalogs & Stores section */}
          <div className="nsa-disp" style={{fontWeight:800,fontSize:20,textTransform:'uppercase',color:tPrimary,marginBottom:14}}>Catalogs &amp; Stores</div>

          {/* Team Stores — inline (CoachStore renders existing stores) */}
          <CoachStore customer={customer} storeIds={cpStoreCustomerIds} />

          {/* Custom & Catalog Gear tile */}
          <a href={CP_MARKETING+'/design-lab'} target={CP_LINK_TARGET} rel="noopener noreferrer" className="nsa-tile" style={{textDecoration:'none',display:'flex',alignItems:'center',gap:22,background:'#fff',border:'1px solid #EEF1F6',borderRadius:8,padding:'22px 28px',boxShadow:'0 2px 12px rgba(0,0,0,.06)',marginBottom:14}}>
            <div style={{width:54,height:54,flexShrink:0,borderRadius:8,background:'#F7F8FB',color:tPrimary,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>🎨</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:21,textTransform:'uppercase',color:tPrimary,lineHeight:1}}>Custom &amp; Catalog Gear</div>
              <div style={{fontSize:14,color:'#5A6075',marginTop:5}}>Browse our brand catalogs or request a custom quote.</div>
            </div>
            <div style={{flexShrink:0,color:'#94A0B0',fontSize:24}}>›</div>
          </a>

          {/* adidas catalog banner */}
          <a className="cp-adidas" href="https://www.adidas-team.com/usa/us-team/" target={CP_LINK_TARGET} rel="noopener noreferrer"
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,minHeight:100,borderRadius:8,overflow:'hidden',textDecoration:'none',color:'#fff',backgroundColor:'#0a0a0a',backgroundImage:`linear-gradient(110deg,rgba(8,8,8,.92) 0%,rgba(8,8,8,.58) 58%,rgba(8,8,8,.26) 100%),url('/adidas-team-catalog.webp')`,backgroundSize:'cover',backgroundPosition:'center 28%',padding:'28px 32px'}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,letterSpacing:'2px',textTransform:'lowercase',color:'rgba(255,255,255,.75)',marginBottom:4}}>adidas</div>
              <div className="nsa-disp" style={{fontWeight:800,fontSize:28,textTransform:'uppercase',lineHeight:1}}>Shop the adidas Catalog</div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.78)',marginTop:6}}>Browse the full adidas team collection at your pricing.</div>
            </div>
            <div className="nsa-skew nsa-disp" style={{flexShrink:0,background:'#fff',color:tPrimary,fontWeight:700,fontSize:14,letterSpacing:'.5px',textTransform:'uppercase',padding:'12px 24px',borderRadius:4}}><span>View Catalog</span></div>
          </a>
        </div>}

        {/* Contact update — summary lives in the Dashboard; this is the edit form when active */}
        {page==='home'&&contactEdit&&<div style={{marginTop:14,padding:14,border:'1px dashed #d1d5db',borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:6}}>📋 Update Contact / Shipping Info</div>
          {!contactEdit?<>
            <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Current: {(customer.contacts||[])[0]?.name} · {(customer.contacts||[])[0]?.email}{customer.shipping_city&&' · '+customer.shipping_city+', '+customer.shipping_state}</div>
            <button className="btn btn-sm btn-secondary" onClick={()=>setContactEdit({name:(customer.contacts||[])[0]?.name||'',email:(customer.contacts||[])[0]?.email||'',phone:(customer.contacts||[])[0]?.phone||'',shipping:safeStr(customer.shipping_address_line1)})}>✏️ Request Update</button>
          </>:<>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Name" style={{flex:1,fontSize:12}} value={contactEdit.name} onChange={e=>setContactEdit(p=>({...p,name:e.target.value}))}/><input className="form-input" placeholder="Email" style={{flex:1,fontSize:12}} value={contactEdit.email} onChange={e=>setContactEdit(p=>({...p,email:e.target.value}))}/></div>
              <div style={{display:'flex',gap:6}}><input className="form-input" placeholder="Phone" style={{flex:1,fontSize:12}} value={contactEdit.phone} onChange={e=>setContactEdit(p=>({...p,phone:e.target.value}))}/><input className="form-input" placeholder="Shipping Address" style={{flex:1,fontSize:12}} value={contactEdit.shipping} onChange={e=>setContactEdit(p=>({...p,shipping:e.target.value}))}/></div>
              <textarea className="form-input" placeholder="Notes for your rep (optional)" rows={2} style={{fontSize:12}} value={contactMsg} onChange={e=>setContactMsg(e.target.value)}/>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-sm btn-primary" onClick={()=>{alert('📩 Update request sent to '+rep?.name+' for approval! (demo)\n\nYour rep will review and update your info.');setContactEdit(null);setContactMsg('')}}>Send Request</button>
              <button className="btn btn-sm btn-secondary" onClick={()=>{setContactEdit(null);setContactMsg('')}}>Cancel</button>
            </div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6}}>Changes will be reviewed by your rep before updating</div>
          </>}
        </div>}
        </div>{/* /RIGHT */}
        </div>{/* /cp-grid */}
        </div>{/* /cp-page */}
      </div>{/* /cp-main */}

    {/* ── Footer ── */}
    <div style={{background:tNavyDark,color:'rgba(255,255,255,.6)'}}>
      <div style={{maxWidth:1240,margin:'0 auto',padding:'28px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <img src="/NEW NSA Logo on white.png" alt="National Sports Apparel" style={{height:34,filter:'brightness(0) invert(1)',opacity:.9}}/>
        <span style={{fontSize:13}}>© 2026 National Sports Apparel · 2238 N Glassell St, Orange, CA · (714) 279-8777</span>
      </div>
    </div>

    {/* ── BOTTOM NAV (mobile) — team-colored tab bar ── */}
    <nav className="cp-bottomnav">
      {/* 7 fits today's max real combo (home/orders/estimates/roster/billing/art/shop); if
          store and roster are ever both enabled for the same account this clips one item —
          revisit if that combo becomes common. */}
      {cpNav.filter(n=>n.key!=='spend').slice(0,7).map(it=>{const active=page===it.key;return(
        <button key={it.key} className="cp-bottombtn" onClick={it.onClick||(()=>setPage(it.key))} style={{color:active?cpTheme.primary:'#94a3b8'}}>
          <span style={{position:'relative',width:38,height:30,borderRadius:11,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:active?cpTint:'transparent',transition:'background .12s'}}>{it.icon}{it.badge>0?<span style={{position:'absolute',top:-3,right:-1,fontSize:9,fontWeight:800,background:cpTheme.accent,color:'#fff',borderRadius:999,padding:'0 5px',minWidth:14,textAlign:'center'}}>{it.badge}</span>:null}</span>
          <span>{it.label}</span>
        </button>
      )})}
    </nav>

    {/* Art Locker — rich design viewer with reorder-into-Live-Look CTA */}
    {artView&&(()=>{const a=artView.art;const idx=Math.min(artView.idx,a.urls.length-1);const u=a.urls[idx];const isPdf=_isPdfUrl(u);
      return<div style={{position:'fixed',inset:0,background:'rgba(8,11,18,.93)',zIndex:9999,display:'flex',flexDirection:'column',padding:16}} onClick={()=>setArtView(null)}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',color:'#fff',gap:12,marginBottom:8}} onClick={e=>e.stopPropagation()}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:17,fontWeight:800,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,.6)',textTransform:'capitalize'}}>{a.deco||'Design'}{a.orders.length>1?' · used on '+a.orders.length+' orders':''}{isP&&a.teams.length?' · '+a.teams.join(', '):''}</div>
          </div>
          <button onClick={()=>setArtView(null)} style={{flexShrink:0,background:'rgba(255,255,255,0.14)',border:'none',color:'#fff',fontSize:24,borderRadius:'50%',width:40,height:40,cursor:'pointer'}}>×</button>
        </div>
        <div onClick={e=>e.stopPropagation()} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',minHeight:0}}>
          {isPdf?<iframe title="Design" src={'https://docs.google.com/gview?url='+encodeURIComponent(u)+'&embedded=true'} style={{width:'90vw',height:'70vh',border:'none',borderRadius:10,background:'#fff'}}/>:<img src={u} alt={a.name} style={{maxWidth:'94vw',maxHeight:'64vh',objectFit:'contain',borderRadius:10}}/>}
        </div>
        {a.urls.length>1&&<div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',margin:'10px 0 2px'}}>
          {a.urls.map((url,i)=>{const t=_isPdfUrl(url)?_cloudinaryPdfThumb(url):url;return<button key={i} onClick={()=>setArtView({art:a,idx:i})} style={{width:48,height:48,borderRadius:8,overflow:'hidden',border:'2px solid '+(i===idx?cpTheme.accent:'rgba(255,255,255,.25)'),background:'#fff',cursor:'pointer',padding:0,flexShrink:0}}>{t&&isUrl(t)?<img src={t} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span style={{fontSize:18}}>🎨</span>}</button>})}
        </div>}
        <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap',marginTop:12}}>
          <a href={u} target="_blank" rel="noopener noreferrer" style={{background:'rgba(255,255,255,0.16)',color:'#fff',textDecoration:'none',padding:'11px 18px',borderRadius:10,fontSize:14,fontWeight:700}}>⬇ Download</a>
          <button onClick={()=>cpOrderWithArt(a,u)} style={{background:cpTheme.accent,color:'#fff',border:'none',padding:'11px 22px',borderRadius:10,fontSize:14,fontWeight:800,cursor:'pointer'}}>🛍️ Order with this design →</button>
        </div>
      </div>;
    })()}

    {/* Lightbox — full-size art/mockup viewer (Art Locker) */}
    {lightbox&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setLightbox(null)}>
      <button style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',border:'none',color:'white',fontSize:28,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setLightbox(null)}>×</button>
      {_isPdfUrl(lightbox)?<iframe title="Design preview" src={'https://docs.google.com/gview?url='+encodeURIComponent(lightbox)+'&embedded=true'} style={{width:'90vw',height:'90vh',border:'none',borderRadius:8,background:'white'}} onClick={e=>e.stopPropagation()}/>
      :<img src={lightbox} alt="Design" style={{maxWidth:'95vw',maxHeight:'86vh',objectFit:'contain',borderRadius:8}} onClick={e=>e.stopPropagation()}/>}
      <a href={lightbox} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{position:'absolute',bottom:20,background:'rgba(255,255,255,0.16)',color:'#fff',textDecoration:'none',padding:'9px 18px',borderRadius:999,fontSize:13,fontWeight:700}}>⬇ Download / open full size</a>
    </div>}

    {/* Stripe Payment Modal — shared element (also rendered in the invoice-detail view above) */}
    {payModalEl}
  </div>
}

// BarcodeScanner + extractPOFromText moved to src/BarcodeScanner.js (shared with App.js and
// MobilePortal.js) — import it from there if the coach portal ever needs camera scanning.

// MAIN APP


export default CoachPortal;
// Exported for unit tests — pure color-resolution helpers (no React/Supabase).
export { cpPantoneFamily, cpEffectiveFamilies, cpTeamTheme, CP_HEX };
