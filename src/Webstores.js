/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// Webstores admin (steps 2/4/5): list + detail, store create/edit, and
// catalog management (single products + bundles, jersey-number and
// fundraising config). Reads & writes the migration-011 tables directly
// via the Supabase client — intentionally isolated from the central
// _dbLoad/_diffSave engine so it can never affect existing estimate/SO
// persistence. Degrades to an "apply migration" message when absent.
// ─────────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  open: { bg: '#dcfce7', fg: '#166534' },
  closed: { bg: '#dbeafe', fg: '#1e40af' },
  draft: { bg: '#f1f5f9', fg: '#64748b' },
  archived: { bg: '#fef3c7', fg: '#92400e' },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg }}>{(status || 'draft').toUpperCase()}</span>;
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumSizes = (jsonb) => Object.values(jsonb || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

function Webstores({ cust = [], REPS = [] }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('catalog');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // null | 'new' | storeObj (settings edit)
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  const custName = useCallback((id) => cust.find((c) => c.id === id)?.name || '—', [cust]);
  const repName = useCallback((id) => REPS.find((r) => r.id === id)?.name || '—', [REPS]);

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    const { data, error } = await supabase.from('webstores').select('*').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true); else setErr(error.message);
      setStores([]);
    } else setStores(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  const loadDetail = useCallback(async (store) => {
    setDetailLoading(true);
    const sid = store.id;
    const [catRes, bundleRes, stockRes, ordRes, itemRes, rosterRes, claimRes] = await Promise.all([
      supabase.from('webstore_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_storefront_products').select('webstore_product_id,product_id,size_stock,on_order_qty,earliest_eta,name,color,category,image_front_url').eq('store_id', sid),
      supabase.from('webstore_orders').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      supabase.from('webstore_order_items').select('*'),
      supabase.from('webstore_roster').select('*').eq('store_id', sid).order('player_name'),
      supabase.from('webstore_number_claims').select('*').eq('store_id', sid).order('player_number'),
    ]);
    const catalog = catRes.data || [];
    const catIds = new Set(catalog.map((c) => c.id));
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const stockByWp = {}; (stockRes.data || []).forEach((s) => { stockByWp[s.webstore_product_id] = s; });
    setDetail({
      catalog,
      bundleItems: (bundleRes.data || []).filter((b) => catIds.has(b.bundle_id)),
      stockByWp,
      orders,
      orderItems: (itemRes.data || []).filter((i) => orderIds.has(i.order_id)),
      roster: rosterRes.data || [],
      claims: claimRes.data || [],
    });
    setDetailLoading(false);
  }, []);

  const openStore = useCallback(async (store) => {
    setSel(store); setTab('catalog'); setDetail(null);
    await loadDetail(store);
  }, [loadDetail]);

  // ── writes ──────────────────────────────────────────────────────────
  const saveStore = useCallback(async (form, existingId) => {
    if (existingId) {
      const { data, error } = await supabase.from('webstores').update({ ...form, updated_at: new Date().toISOString() }).eq('id', existingId).select().single();
      if (error) return { error };
      setStores((prev) => prev.map((s) => (s.id === existingId ? data : s)));
      if (sel?.id === existingId) setSel(data);
      flash('Store saved'); return { data };
    }
    const { data, error } = await supabase.from('webstores').insert(form).select().single();
    if (error) return { error };
    setStores((prev) => [data, ...prev]);
    flash('Store created'); return { data };
  }, [sel, flash]);

  const addSingle = useCallback(async (product) => {
    const row = { store_id: sel.id, kind: 'single', product_id: product.id, sku: product.sku, retail_price: product.retail_price || 0, active: true, sort_order: (detail?.catalog?.length || 0) };
    const { error } = await supabase.from('webstore_products').insert(row);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Added ' + (product.name || product.sku)); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  const createBundle = useCallback(async ({ name, price, components }) => {
    const { data: bundle, error } = await supabase.from('webstore_products').insert({ store_id: sel.id, kind: 'bundle', display_name: name, retail_price: price, active: true, sort_order: (detail?.catalog?.length || 0) }).select().single();
    if (error) { flash('Error: ' + error.message); return; }
    if (components.length) {
      const rows = components.map((c, i) => ({ bundle_id: bundle.id, product_id: c.product_id, sku: c.sku, qty: c.qty || 1, size_required: c.size_required !== false, takes_number: !!c.takes_number, sort_order: i }));
      const { error: e2 } = await supabase.from('webstore_bundle_items').insert(rows);
      if (e2) { flash('Bundle created but items failed: ' + e2.message); loadDetail(sel); return; }
    }
    flash('Package created'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  const removeCatalogItem = useCallback(async (id, label) => {
    if (!window.confirm('Remove "' + label + '" from this store?')) return;
    const { error } = await supabase.from('webstore_products').delete().eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Removed'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // ── render gates ─────────────────────────────────────────────────────
  if (needsMigration) return <MigrationNotice onRetry={loadStores} />;
  if (loading) return <div style={{ padding: 40, color: '#64748b', fontSize: 14 }}>Loading webstores…</div>;
  if (err) return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}><div className="card-body" style={{ padding: 24 }}>
      <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Couldn't load webstores</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>{err}</div>
      <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={loadStores}>Retry</button>
    </div></div>
  );

  return (
    <>
      {toast && <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>}

      {editing ? (
        <StoreForm cust={cust} REPS={REPS} store={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async (form) => { const r = await saveStore(form, editing === 'new' ? null : editing.id); if (r.error) return r; setEditing(null); return r; }} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab}
          custName={custName} repName={repName}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)}
          onAddSingle={addSingle} onCreateBundle={createBundle} onRemove={removeCatalogItem} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} onOpen={openStore} onNew={() => setEditing('new')} />
      )}
    </>
  );
}

function MigrationNotice({ onRetry }) {
  return (
    <div className="card" style={{ maxWidth: 620, margin: '40px auto' }}><div className="card-body" style={{ padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
      <h2 style={{ margin: '0 0 8px', color: '#1e293b' }}>Webstores not set up yet</h2>
      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
        The webstore tables haven't been created in the database yet. Apply migration <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>supabase_migration_011_webstores.sql</code> in the Supabase SQL editor, then reload this page.
        <br /><br />The migration is purely additive — it only creates new tables and does not touch any existing data.
      </div>
      <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onRetry}>Retry</button>
    </div></div>
  );
}

function ListView({ stores, custName, repName, onOpen, onNew }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{stores.length} store{stores.length === 1 ? '' : 's'}</div>
        <button className="btn btn-primary" onClick={onNew}>+ New Store</button>
      </div>
      {stores.length === 0 ? (
        <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No webstores yet. Click <b>+ New Store</b> to create the first one.
        </div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {stores.map((s) => (
            <div key={s.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onOpen(s)}>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{s.name}</div>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <Chip label={s.payment_mode === 'either' ? 'Paid + Invoice' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'} />
                  {s.fundraise_enabled && <Chip label="Fundraising" tone="green" />}
                  {s.number_enabled && <Chip label={s.number_unique ? 'Unique #s' : 'Numbers'} tone="blue" />}
                  <Chip label={'/shop/' + s.slug} tone="gray" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone = 'slate' }) {
  const tones = { slate: { bg: '#f1f5f9', fg: '#475569' }, green: { bg: '#dcfce7', fg: '#166534' }, blue: { bg: '#dbeafe', fg: '#1e40af' }, gray: { bg: '#f8fafc', fg: '#94a3b8' } };
  const t = tones[tone] || tones.slate;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: t.bg, color: t.fg, fontFamily: tone === 'gray' ? 'monospace' : 'inherit' }}>{label}</span>;
}

// ── Store create / edit form ─────────────────────────────────────────
const BLANK = {
  name: '', slug: '', customer_id: '', rep_id: '', status: 'draft',
  payment_mode: 'paid', require_login: false,
  number_enabled: false, number_unique: true, number_min: 0, number_max: 99,
  so_creation: 'manual',
  fundraise_enabled: false, fundraise_pct: 0, fundraise_flat: 0, fundraise_show_parents: false,
  theme: 'classic', primary_color: '#0f172a', accent_color: '#2563eb', logo_url: '', banner_url: '', hero_blurb: '',
};
function StoreForm({ store, cust, REPS, onCancel, onSave }) {
  const [f, setF] = useState(() => ({ ...BLANK, ...(store || {}) }));
  const [slugTouched, setSlugTouched] = useState(!!store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setName = (v) => setF((p) => ({ ...p, name: v, slug: slugTouched ? p.slug : slugify(v) }));

  const submit = async () => {
    setError('');
    if (!f.name.trim()) return setError('Store name is required.');
    if (!f.slug.trim()) return setError('A URL slug is required.');
    setBusy(true);
    // Only send known columns (strip view-only / id fields if editing).
    const payload = { ...BLANK, ...f };
    delete payload.id; delete payload.created_at; delete payload.updated_at;
    payload.fundraise_pct = Number(payload.fundraise_pct) || 0;
    payload.fundraise_flat = Number(payload.fundraise_flat) || 0;
    payload.number_min = Number(payload.number_min) || 0;
    payload.number_max = Number(payload.number_max) || 99;
    payload.customer_id = payload.customer_id || null;
    payload.rep_id = payload.rep_id || null;
    const r = await onSave(payload);
    setBusy(false);
    if (r?.error) setError(r.error.message || 'Save failed.');
  };

  const parents = cust.filter((c) => !c.parent_id);
  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-sm btn-secondary" onClick={onCancel} style={{ marginBottom: 12 }}>← Cancel</button>
      <h2 style={{ margin: '0 0 14px' }}>{store ? 'Edit store' : 'New store'}</h2>
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <Section title="Basics">
        <Row label="Store name"><input className="form-input" value={f.name} onChange={(e) => setName(e.target.value)} placeholder="Tartan FC Team Store" /></Row>
        <Row label="URL slug"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>/shop/</span><input className="form-input" value={f.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} placeholder="tartan-fc" /></div></Row>
        <Row label="Club (customer)"><select className="form-select" value={f.customer_id || ''} onChange={(e) => set('customer_id', e.target.value)}><option value="">—</option>{parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Row>
        <Row label="Rep"><select className="form-select" value={f.rep_id || ''} onChange={(e) => set('rep_id', e.target.value)}><option value="">—</option>{REPS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Row>
        <Row label="Status"><select className="form-select" value={f.status} onChange={(e) => set('status', e.target.value)}>{['draft', 'open', 'closed', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
      </Section>

      <Section title="Ordering & payment">
        <Row label="Payment mode"><select className="form-select" value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
          <option value="paid">Card only (parents pay)</option><option value="unpaid">Invoice only (team tab)</option><option value="either">Both — card or team tab</option>
        </select></Row>
        <Row label="SO creation"><select className="form-select" value={f.so_creation} onChange={(e) => set('so_creation', e.target.value)}>{['manual', 'on_close', 'daily', 'weekly'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
        <Toggle label="Require login (club members only)" checked={f.require_login} onChange={(v) => set('require_login', v)} />
      </Section>

      <Section title="Jersey numbers">
        <Toggle label="Let players choose a number" checked={f.number_enabled} onChange={(v) => set('number_enabled', v)} />
        {f.number_enabled && <>
          <Toggle label="Numbers must be unique (block once taken)" checked={f.number_unique} onChange={(v) => set('number_unique', v)} />
          <div style={{ display: 'flex', gap: 12 }}>
            <Row label="Min #"><input className="form-input" type="number" value={f.number_min} onChange={(e) => set('number_min', e.target.value)} /></Row>
            <Row label="Max #"><input className="form-input" type="number" value={f.number_max} onChange={(e) => set('number_max', e.target.value)} /></Row>
          </div>
        </>}
      </Section>

      <Section title="Fundraising">
        <Toggle label="Enable fundraising markup" checked={f.fundraise_enabled} onChange={(v) => set('fundraise_enabled', v)} />
        {f.fundraise_enabled && <>
          <div style={{ display: 'flex', gap: 12 }}>
            <Row label="Percent (e.g. 0.15 = 15%)"><input className="form-input" type="number" step="0.01" value={f.fundraise_pct} onChange={(e) => set('fundraise_pct', e.target.value)} /></Row>
            <Row label="Or flat $/item"><input className="form-input" type="number" step="0.01" value={f.fundraise_flat} onChange={(e) => set('fundraise_flat', e.target.value)} /></Row>
          </div>
          <Toggle label='Show "$X supports the team" to parents' checked={f.fundraise_show_parents} onChange={(v) => set('fundraise_show_parents', v)} />
        </>}
      </Section>

      <Section title="Branding">
        <Row label="Theme"><select className="form-select" value={f.theme} onChange={(e) => set('theme', e.target.value)}>{['classic', 'bold', 'minimal'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="Primary color"><input className="form-input" value={f.primary_color || ''} onChange={(e) => set('primary_color', e.target.value)} placeholder="#0f172a" /></Row>
          <Row label="Accent color"><input className="form-input" value={f.accent_color || ''} onChange={(e) => set('accent_color', e.target.value)} placeholder="#2563eb" /></Row>
        </div>
        <Row label="Logo URL"><input className="form-input" value={f.logo_url || ''} onChange={(e) => set('logo_url', e.target.value)} /></Row>
        <Row label="Banner URL"><input className="form-input" value={f.banner_url || ''} onChange={(e) => set('banner_url', e.target.value)} /></Row>
        <Row label="Hero blurb"><textarea className="form-input" rows={2} value={f.hero_blurb || ''} onChange={(e) => set('hero_blurb', e.target.value)} /></Row>
      </Section>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : store ? 'Save changes' : 'Create store'}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5, marginBottom: 12 }}>{title}</div>
    {children}
  </div></div>;
}
function Row({ label, children }) {
  return <div style={{ marginBottom: 12, flex: 1 }}><label className="form-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#64748b' }}>{label}</label>{children}</div>;
}
function Toggle({ label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer', fontSize: 13 }}>
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />{label}
  </label>;
}

// ── Store detail (with catalog editing) ──────────────────────────────
function StoreDetail({ store: s, detail, loading, tab, setTab, custName, repName, onBack, onEdit, onAddSingle, onCreateBundle, onRemove }) {
  const orders = detail?.orders || [];
  const orderItems = detail?.orderItems || [];
  const catalog = detail?.catalog || [];
  const roster = detail?.roster || [];
  const bundleItems = detail?.bundleItems || [];
  const stockByWp = detail?.stockByWp || {};

  const totalSales = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraiseTotal = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const playerCount = new Set(orderItems.map((i) => (i.player_name || '').trim().toLowerCase()).filter(Boolean)).size;
  const notOrdered = roster.filter((r) => !r.ordered);

  const TABS = [
    { id: 'catalog', label: `Catalog (${catalog.length})` },
    { id: 'orders', label: `Orders (${orders.length})` },
    { id: 'roster', label: roster.length ? `Roster (${roster.length})` : 'Roster' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-sm btn-secondary" onClick={onBack}>← Back to All Stores</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-sm btn-secondary" href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer">↗ View storefront</a>
          <button className="btn btn-sm btn-primary" onClick={onEdit}>Edit settings</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.name}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)} · <span style={{ fontFamily: 'monospace' }}>/shop/{s.slug}</span></div>
            <div style={{ marginTop: 6 }}><StatusBadge status={s.status} /></div>
          </div>
          <div style={{ display: 'flex', gap: 18, textAlign: 'right' }}>
            <Stat label="Orders" value={orders.length} />
            <Stat label="Players" value={playerCount} />
            <Stat label="Sales" value={money(totalSales)} />
            {s.fundraise_enabled && <Stat label="Fundraising" value={money(fundraiseTotal)} tone="#166534" />}
          </div>
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {loading ? <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading store details…</div> : (
        <>
          {tab === 'catalog' && <CatalogTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} onAddSingle={onAddSingle} onCreateBundle={onCreateBundle} onRemove={onRemove} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} />}
          {tab === 'roster' && <RosterTab roster={roster} notOrdered={notOrdered} />}
          {tab === 'settings' && <SettingsTab store={s} />}
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }) {
  return <div><div style={{ fontSize: 18, fontWeight: 800, color: tone || '#1e293b' }}>{value}</div><div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div></div>;
}

function stockText(stock) {
  const onHand = sumSizes(stock?.size_stock);
  if (onHand > 0) return { text: `In stock (${onHand})`, color: '#166534' };
  if (stock?.on_order_qty > 0) return { text: stock.earliest_eta ? `Arriving ~${stock.earliest_eta}` : `On order (${stock.on_order_qty})`, color: '#92400e' };
  return { text: 'Out of stock', color: '#b91c1c' };
}

// ── Catalog tab with editing ─────────────────────────────────────────
function CatalogTab({ catalog, bundleItems, stockByWp, onAddSingle, onCreateBundle, onRemove }) {
  const [mode, setMode] = useState(null); // null | 'single' | 'bundle'
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-sm btn-primary" onClick={() => setMode(mode === 'single' ? null : 'single')}>+ Add product</button>
        <button className="btn btn-sm btn-secondary" onClick={() => setMode(mode === 'bundle' ? null : 'bundle')}>+ Create package</button>
      </div>

      {mode === 'single' && <ProductSearch label="Add a product to this store" onPick={(p) => { onAddSingle(p); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'bundle' && <BundleBuilder onCreate={(b) => { onCreateBundle(b); setMode(null); }} onClose={() => setMode(null)} />}

      {catalog.length === 0 ? <Empty msg="No products in this store's catalog yet. Add one above." /> : (
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>Product</th><th style={th}>Type</th><th style={th}>Price</th><th style={th}>Stock / ETA</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {catalog.map((p) => {
                const stock = stockByWp[p.id];
                const st = stockText(stock);
                const comps = p.kind === 'bundle' ? bundleItems.filter((b) => b.bundle_id === p.id) : [];
                const label = p.display_name || stock?.name || p.sku || '(unnamed)';
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, stock?.color, stock?.category].filter(Boolean).join(' · ')}</div>
                      {comps.length > 0 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        {comps.map((c) => <div key={c.id}>• {c.qty}× {c.sku || c.product_id}{c.size_required ? '' : ' (one size)'}{c.takes_number ? ' #' : ''}</div>)}
                      </div>}
                    </td>
                    <td style={td}>{p.kind === 'bundle' ? <Chip label="Bundle" tone="blue" /> : <Chip label="Single" />}</td>
                    <td style={td}>{money(p.retail_price)}</td>
                    <td style={{ ...td, color: st.color, fontWeight: 600 }}>{p.kind === 'bundle' ? '—' : st.text}</td>
                    <td style={{ ...td, textAlign: 'right' }}><button className="btn btn-sm btn-secondary" style={{ color: '#b91c1c' }} onClick={() => onRemove(p.id, label)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
    </>
  );
}

// Search the master products table (read-only) to pick catalog items.
function ProductSearch({ label, onPick, onClose, compact }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.from('products').select('id,sku,name,color,category,retail_price,image_front_url').or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(25);
      if (!cancelled) { setResults(data || []); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14 }}>
      {label && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>{onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button>}</div>}
      <input className="form-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU…" />
      <div style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
        {searching && <div style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>Searching…</div>}
        {!searching && q.trim().length >= 2 && results.length === 0 && <div style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>No matches.</div>}
        {results.map((p) => (
          <div key={p.id} onClick={() => onPick(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
            <div style={{ width: 34, height: 34, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>{p.image_front_url && <img src={p.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, p.color].filter(Boolean).join(' · ')}</div></div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{money(p.retail_price)}</div>
          </div>
        ))}
      </div>
    </div></div>
  );
}

function BundleBuilder({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [components, setComponents] = useState([]);
  const [picking, setPicking] = useState(false);
  const addComp = (p) => { setComponents((c) => [...c, { product_id: p.id, sku: p.sku, name: p.name, qty: 1, size_required: true, takes_number: false }]); setPicking(false); };
  const upd = (i, k, v) => setComponents((c) => c.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const rm = (i) => setComponents((c) => c.filter((_, idx) => idx !== i));
  const valid = name.trim() && Number(price) > 0 && components.length > 0;
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontWeight: 700 }}>Create a package</div><button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button></div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Row label="Package name"><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player Kit" /></Row>
        <Row label="Package price"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="120.00" /></Row>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Items in this package</div>
      {components.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}><b>{c.name}</b> <span style={{ color: '#94a3b8' }}>{c.sku}</span></div>
          <label style={{ fontSize: 12 }}>Qty <input type="number" min={1} value={c.qty} onChange={(e) => upd(i, 'qty', Number(e.target.value) || 1)} style={{ width: 50, marginLeft: 4 }} /></label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.size_required} onChange={(e) => upd(i, 'size_required', e.target.checked)} />needs size</label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.takes_number} onChange={(e) => upd(i, 'takes_number', e.target.checked)} />carries #</label>
          <button onClick={() => rm(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }}>remove</button>
        </div>
      ))}
      {picking ? <ProductSearch label="Add an item to the package" onPick={addComp} onClose={() => setPicking(false)} /> :
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setPicking(true)}>+ Add item</button>}
      <div style={{ marginTop: 14 }}><button className="btn btn-primary" disabled={!valid} onClick={() => onCreate({ name: name.trim(), price: Number(price), components })}>Create package</button></div>
    </div></div>
  );
}

function OrdersTab({ orders, orderItems, numbersEnabled }) {
  if (!orders.length) return <Empty msg="No orders placed in this store yet." />;
  const itemsByOrder = {};
  orderItems.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  return (
    <div className="card"><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {orders.map((o) => {
            const items = itemsByOrder[o.id] || [];
            const players = [...new Set(items.map((i) => i.player_name).filter(Boolean))];
            const numbers = [...new Set(items.map((i) => i.player_number).filter(Boolean))];
            const lineStatus = items[0]?.line_status || 'pending';
            return (
              <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0)}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(lineStatus || 'pending').replace(/_/g, ' ')} tone={lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div></div>
  );
}

function RosterTab({ roster, notOrdered }) {
  if (!roster.length) return <Empty msg="No roster uploaded. Upload one (coming in a later step) to track who hasn't ordered." />;
  return (
    <>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>{notOrdered.length} of {roster.length} players have not ordered yet.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Player</th><th style={th}>#</th><th style={th}>Parent email</th><th style={th}>Ordered?</th>
          </tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}>{r.player_name}</td><td style={td}>{r.player_number || '—'}</td><td style={td}>{r.parent_email || '—'}</td>
                <td style={td}>{r.ordered ? <Chip label="Ordered" tone="green" /> : <Chip label="Not yet" tone="gray" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

function SettingsTab({ store: s }) {
  const rows = [
    ['Slug', '/shop/' + s.slug],
    ['Status', (s.status || 'draft').toUpperCase()],
    ['Payment mode', s.payment_mode === 'either' ? 'Card + invoice-later' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'],
    ['Login required', s.require_login ? 'Yes (club members only)' : 'No (public)'],
    ['Shipping', 'Ship (ShipStation)'],
    ['Numbers', s.number_enabled ? `Enabled (${s.number_min}–${s.number_max}${s.number_unique ? ', unique' : ''})` : 'Off'],
    ['SO creation', s.so_creation],
    ['Fundraising', s.fundraise_enabled ? `On (${s.fundraise_pct ? s.fundraise_pct * 100 + '%' : money(s.fundraise_flat) + '/item'}${s.fundraise_show_parents ? ', shown to parents' : ''})` : 'Off'],
    ['Theme', s.theme || 'classic'],
  ];
  return (
    <div className="card"><div style={{ padding: 16 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
          <div style={{ width: 160, color: '#64748b' }}>{k}</div><div style={{ fontWeight: 600 }}>{v}</div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>Use “Edit settings” above to change these.</div>
    </div></div>
  );
}

function Empty({ msg }) {
  return <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>{msg}</div></div>;
}

const th = { padding: '10px 12px', fontWeight: 600 };
const td = { padding: '10px 12px', verticalAlign: 'top' };

export default Webstores;
