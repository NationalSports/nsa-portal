/* eslint-disable */
// Global "Build with AI" wizard. Mounted from the top nav. Three steps:
//   1) Order type (Estimate / Sales Order / [PO disabled in Phase 1])
//   2) Customer
//   3) AI parse (text / image / Google Sheets URL) → review → create
// On finish, calls the App.js callback that creates the estimate (and
// optionally converts to SO) with the parsed items pre-loaded.
import React, { useState } from 'react';
import { Icon, SearchSelect } from './components';
import { invokeEdgeFn, enrichAiLinesWithVendors } from './utils';
import { rQ } from './pricing';

const isAU = b => { const l = (b || '').toLowerCase(); return l === 'adidas' || l === 'under armour' || l === 'new balance'; };
const tD = { A: 0.4, B: 0.35, C: 0.3 };

const TYPE_OPTIONS = [
  { id: 'estimate', label: 'Estimate', icon: '📝', desc: 'Start a new estimate. You can convert to a Sales Order later.', enabled: true },
  { id: 'so',       label: 'Sales Order', icon: '📦', desc: 'Creates an estimate, then immediately converts to a Sales Order.', enabled: true },
  { id: 'po',       label: 'Purchase Order', icon: '🛒', desc: 'POs are created from inside a Sales Order. Pick "Sales Order" and use the in-order Create PO flow.', enabled: false },
];

const initialAi = () => ({
  inputMode: 'text', text: '', images: [], url: '',
  loading: false, error: null, statusMsg: null,
  parsed: [], warnings: [], build_id: null, hasParsed: false,
});

export function AiOrderWizard({ open, onClose, supabase, products, customers, vendors, defaultMarkup, onCreateEstimate, onCreateSO, nf, cu }) {
  const [step, setStep] = useState(1);
  const [orderType, setOrderType] = useState('estimate');
  const [customerId, setCustomerId] = useState(null);
  const [ai, setAi] = useState(initialAi);

  if (!open) return null;

  const customer = customerId ? (customers || []).find(c => c.id === customerId) : null;

  const reset = () => { setStep(1); setOrderType('estimate'); setCustomerId(null); setAi(initialAi()); };
  const close = () => { if (!ai.loading) { reset(); onClose(); } };

  // STEP 3 — invoke the existing ai-order-builder edge function
  const runParse = async () => {
    if (!supabase) { setAi(x => ({ ...x, error: 'Supabase not configured' })); return; }
    setAi(x => ({ ...x, loading: true, error: null, statusMsg: 'Sending to Claude…' }));
    try {
      const catalog = (products || []).map(p => ({ id: p.id, sku: p.sku, name: p.name, brand: p.brand, color: p.color, available_sizes: p.available_sizes }));
      const payload = {
        input_type: ai.inputMode,
        text: ai.text || '',
        image_data_urls: (ai.images || []).map(i => i.dataUrl),
        url: ai.url || '',
        catalog,
      };
      const statuses = ai.inputMode === 'image'
        ? ['Reading the image…', 'Identifying products…', 'Matching SKUs to catalog…', 'Almost done…']
        : ai.inputMode === 'url'
        ? ['Fetching the sheet…', 'Reading the order…', 'Matching SKUs to catalog…', 'Almost done…']
        : ['Reading the order…', 'Pulling out line items…', 'Matching SKUs to catalog…', 'Almost done…'];
      let si = 0;
      const ticker = setInterval(() => { si = (si + 1) % statuses.length; setAi(x => x && x.loading ? { ...x, statusMsg: statuses[si] } : x); }, 3500);
      let d;
      try { d = await invokeEdgeFn(supabase, 'ai-order-builder', payload); }
      finally { clearInterval(ticker); }
      if (!d?.ok) { setAi(x => ({ ...x, loading: false, statusMsg: null, error: d?.error || 'AI parse failed' })); return; }
      let lines = (d.lines || []).map(l => ({ ...l, _skip: false }));

      // Vendor enrichment: for unmatched SKUs, fan out to SanMar / S&S / Momentec
      // and splice in name + pricing if anyone has it. Keeps the loading bar up
      // so the user knows it's still working.
      const unmatchedCount = lines.filter(l => !l.product_id && (l.sku_guess || '').trim()).length;
      if (unmatchedCount > 0) {
        setAi(x => ({ ...x, statusMsg: `Looking up ${unmatchedCount} SKU${unmatchedCount === 1 ? '' : 's'} in vendor catalogs…` }));
        try {
          lines = await enrichAiLinesWithVendors(lines, (done, total) => {
            setAi(x => ({ ...x, statusMsg: `Vendor lookup: ${done}/${total}…` }));
          });
        } catch (e) { console.warn('[AiOrderWizard] vendor enrichment failed:', e); }
      }

      setAi(x => ({
        ...x,
        loading: false, statusMsg: null,
        parsed: lines,
        warnings: d.warnings || [],
        build_id: d.build_id || null,
        hasParsed: true,
      }));
    } catch (err) {
      console.error('[AiOrderWizard] parse error:', err);
      setAi(x => ({ ...x, loading: false, statusMsg: null, error: 'Unexpected error: ' + (err?.message || String(err)) }));
    }
  };

  // FINAL — convert parsed lines into estimate items and hand off
  const handleCreate = () => {
    const keeping = (ai.parsed || []).filter(p => !p._skip);
    if (keeping.length === 0) { setAi(x => ({ ...x, error: 'Nothing to import — uncheck "skip" on at least one line.' })); return; }
    const mk = customer?.catalog_markup || defaultMarkup || 1.65;
    const items = keeping.map(p => {
      const sku = (p.sku_guess || '').trim();
      const catMatch = p.product_id ? (products || []).find(pr => pr.id === p.product_id) :
        (sku ? ((products || []).find(pr => pr.sku === sku) || (products || []).find(pr => pr.sku.toLowerCase() === sku.toLowerCase())) : null);
      const brand = catMatch?.brand || p.brand || '';
      const au = isAU(brand);
      const cost = catMatch?.nsa_cost || p.vendor_price || 0;
      const retail = catMatch?.retail_price || p.vendor_retail || 0;
      const sell = au
        ? rQ(retail * (1 - (tD[customer?.adidas_ua_tier || 'B'] || 0.35)))
        : rQ(cost * mk);
      const szKeys = Object.keys(p.sizes || {});
      return {
        product_id: catMatch?.id || null,
        sku: sku || 'CUSTOM',
        name: catMatch?.name || p.name || '',
        brand,
        color: p.color || catMatch?.color || '',
        nsa_cost: cost,
        retail_price: retail,
        unit_sell: sell,
        available_sizes: szKeys.length > 0 ? szKeys : (catMatch?.available_sizes || ['S', 'M', 'L', 'XL', '2XL']),
        sizes: p.sizes || {},
        decorations: [],
        is_custom: !catMatch,
        pick_lines: [],
        po_lines: [],
      };
    });
    // Best-effort: record accepted lines on the audit row
    if (supabase && ai.build_id) {
      try { supabase.from('ai_order_builds').update({ accepted_lines: keeping, accepted_count: keeping.length }).eq('id', ai.build_id); } catch (_) {}
    }
    if (orderType === 'so' && onCreateSO) onCreateSO(customer, items);
    else onCreateEstimate(customer, items);
    if (nf) nf('✨ Created ' + (orderType === 'so' ? 'sales order' : 'estimate') + ' with ' + items.length + ' AI-parsed item' + (items.length === 1 ? '' : 's'));
    reset();
    onClose();
  };

  // STEP TABS
  const stepBubble = (n, label) => {
    const active = step === n;
    const done = step > n;
    return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: active ? '#7c3aed' : done ? '#a78bfa' : '#e2e8f0', color: active || done ? 'white' : '#64748b' }}>{done ? '✓' : n}</div>
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#7c3aed' : done ? '#7c3aed' : '#94a3b8' }}>{label}</span>
    </div>;
  };

  const canAdvanceFrom1 = !!orderType;
  const canAdvanceFrom2 = !!customerId;
  const inputReady = (ai.inputMode === 'text' && ai.text.trim()) || (ai.inputMode === 'image' && ai.images.length > 0) || (ai.inputMode === 'url' && ai.url.trim());

  return <div className="modal-overlay" onClick={close}>
    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 960, maxHeight: '92vh', overflow: 'auto' }}>
      <div className="modal-header" style={{ background: 'linear-gradient(135deg,#ede9fe,#dbeafe)' }}>
        <h2>✨ Build with AI</h2>
        <button className="modal-close" onClick={close} disabled={ai.loading}>×</button>
      </div>

      <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 18, alignItems: 'center', background: '#fafafa' }}>
        {stepBubble(1, 'Order Type')}
        <div style={{ flex: '0 0 24px', height: 1, background: '#e2e8f0' }} />
        {stepBubble(2, 'Customer')}
        <div style={{ flex: '0 0 24px', height: 1, background: '#e2e8f0' }} />
        {stepBubble(3, 'Describe / Upload')}
      </div>

      <div className="modal-body" style={{ minHeight: 360 }}>

        {/* STEP 1 — TYPE */}
        {step === 1 && <>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>What kind of order do you want to build?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {TYPE_OPTIONS.map(t => {
              const selected = orderType === t.id;
              const disabled = !t.enabled;
              return <div key={t.id}
                onClick={() => { if (!disabled) setOrderType(t.id); }}
                style={{ padding: 14, borderRadius: 10,
                  border: selected ? '2px solid #7c3aed' : '2px solid #e2e8f0',
                  background: selected ? '#faf5ff' : disabled ? '#f8fafc' : 'white',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1, transition: 'all 0.12s' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{t.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: selected ? '#7c3aed' : disabled ? '#94a3b8' : '#1e293b' }}>{t.label}{disabled && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#e2e8f0', color: '#64748b', fontWeight: 700 }}>SOON</span>}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>{t.desc}</div>
              </div>;
            })}
          </div>
        </>}

        {/* STEP 2 — CUSTOMER */}
        {step === 2 && <>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>Which customer is this {orderType === 'so' ? 'sales order' : 'estimate'} for?</div>
          <SearchSelect
            options={(customers || []).filter(c => c.is_active !== false).map(c => ({
              value: c.id,
              label: c.name + (c.alpha_tag ? ' (' + c.alpha_tag + ')' : ''),
            }))}
            value={customerId}
            onChange={v => setCustomerId(v)}
            placeholder="Search customer by name or tag…"
          />
          {customer && <div style={{ marginTop: 14, padding: 10, background: '#f0fdf4', borderRadius: 6, fontSize: 12, color: '#166534' }}>
            ✓ Selected: <b>{customer.name}</b>
            {customer.adidas_ua_tier && <span style={{ marginLeft: 8, fontSize: 10 }}>(Adidas/UA tier {customer.adidas_ua_tier})</span>}
            {customer.catalog_markup && <span style={{ marginLeft: 8, fontSize: 10 }}>(markup {customer.catalog_markup}x)</span>}
          </div>}
        </>}

        {/* STEP 3 — AI INPUT */}
        {step === 3 && !ai.hasParsed && <>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
            Paste the coach's order, drop screenshot(s), or paste a Google Sheets link. Claude will read it and pull out the line items.
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
            {[['text', '📝 Paste Text'], ['image', '📷 Upload Image'], ['url', '🔗 Sheets / URL']].map(([k, label]) =>
              <button key={k} onClick={() => setAi(x => ({ ...x, inputMode: k, error: null }))}
                style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: ai.inputMode === k ? '2px solid #7c3aed' : '2px solid transparent',
                  color: ai.inputMode === k ? '#7c3aed' : '#64748b' }}>{label}</button>)}
          </div>

          {ai.inputMode === 'text' && <textarea className="form-input" rows={12} value={ai.text}
            onChange={e => setAi(x => ({ ...x, text: e.target.value }))}
            placeholder={"Paste whatever the coach sent. Examples:\n\nTechfit Sleeveless Tee (Black) JY6033\nS/40  M/60  L/60  XL/60  2XL/15  3XL/15\n\nM Everyday Pro Reversible (Black) JM5094\nSizing S/50  M/50  L/50  XL/30  2XL/15"}
            style={{ fontFamily: 'monospace', fontSize: 12 }} />}

          {ai.inputMode === 'image' && <div>
            <input type="file" accept="image/*" multiple onChange={async e => {
              const files = Array.from(e.target.files || []);
              const imgs = await Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, dataUrl: r.result }); r.readAsDataURL(f); })));
              setAi(x => ({ ...x, images: [...(x.images || []), ...imgs] }));
            }} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Tip: drop images here, or paste from clipboard.</div>
            <div onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={async e => {
                e.preventDefault(); e.stopPropagation();
                const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
                if (files.length === 0) return;
                const imgs = await Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, dataUrl: r.result }); r.readAsDataURL(f); })));
                setAi(x => ({ ...x, images: [...(x.images || []), ...imgs] }));
              }}
              onPaste={async e => {
                const items = Array.from(e.clipboardData?.items || []).filter(it => it.type.startsWith('image/'));
                if (items.length === 0) return;
                const imgs = await Promise.all(items.map(it => new Promise(res => { const f = it.getAsFile(); const r = new FileReader(); r.onload = () => res({ name: f.name || 'pasted.png', dataUrl: r.result }); r.readAsDataURL(f); })));
                setAi(x => ({ ...x, images: [...(x.images || []), ...imgs] }));
              }}
              tabIndex={0}
              style={{ border: '2px dashed #c4b5fd', borderRadius: 8, padding: 20, minHeight: 120, background: '#faf5ff', textAlign: 'center', color: '#7c3aed', fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'text' }}>
              {(ai.images || []).length === 0 ? 'Drop or paste images here' : `${ai.images.length} image(s) attached`}
            </div>
            {(ai.images || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ai.images.map((im, i) => <div key={i} style={{ position: 'relative', border: '1px solid #e2e8f0', borderRadius: 6, padding: 4 }}>
                <img src={im.dataUrl} alt={im.name} style={{ maxWidth: 120, maxHeight: 120, display: 'block' }} />
                <button onClick={() => setAi(x => ({ ...x, images: x.images.filter((_, ii) => ii !== i) }))}
                  style={{ position: 'absolute', top: 2, right: 2, background: '#fee2e2', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, color: '#991b1b' }}>×</button>
              </div>)}
            </div>}
            <textarea className="form-input" rows={3} value={ai.text} placeholder="Optional: notes for Claude (e.g. 'youth sizes', 'add 2 of each for staff')"
              onChange={e => setAi(x => ({ ...x, text: e.target.value }))} style={{ marginTop: 8, fontSize: 12 }} />
          </div>}

          {ai.inputMode === 'url' && <div>
            <input className="form-input" type="url" value={ai.url} onChange={e => setAi(x => ({ ...x, url: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=…" style={{ fontSize: 12 }} />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              Google Sheets must be shared as "Anyone with the link can view." For private sheets, switch to "Paste Text" and copy the rows in.
            </div>
          </div>}

          {ai.error && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>⚠ {ai.error}</div>}

          {ai.loading && <div style={{ marginTop: 14 }}>
            <div style={{ height: 6, background: '#ede9fe', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', background: 'linear-gradient(90deg,#a78bfa,#7c3aed,#a78bfa)', borderRadius: 3, animation: 'aiWizSlide 1.4s infinite ease-in-out' }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{ai.statusMsg || 'Working…'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(typically 5–20s)</span></div>
            <style>{`@keyframes aiWizSlide{0%{left:-30%}50%{left:50%}100%{left:100%}}`}</style>
          </div>}
        </>}

        {/* STEP 3b — REVIEW */}
        {step === 3 && ai.hasParsed && <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ padding: 8, background: '#f0fdf4', borderRadius: 6, flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#166534' }}>{ai.parsed.length}</div><div style={{ fontSize: 10, color: '#64748b' }}>Items Parsed</div></div>
            <div style={{ padding: 8, background: '#ede9fe', borderRadius: 6, flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#7c3aed' }}>{ai.parsed.filter(p => p.product_id).length}</div><div style={{ fontSize: 10, color: '#64748b' }}>Catalog Matches</div></div>
            <div style={{ padding: 8, background: ai.parsed.some(p => p.vendor_source) ? '#dbeafe' : '#f8fafc', borderRadius: 6, flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: ai.parsed.some(p => p.vendor_source) ? '#1e40af' : '#94a3b8' }}>{ai.parsed.filter(p => p.vendor_source).length}</div><div style={{ fontSize: 10, color: '#64748b' }}>Vendor Matches</div></div>
            <div style={{ padding: 8, background: ai.parsed.some(p => !p.product_id && !p.vendor_source) ? '#fffbeb' : '#f8fafc', borderRadius: 6, flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: ai.parsed.some(p => !p.product_id && !p.vendor_source) ? '#d97706' : '#94a3b8' }}>{ai.parsed.filter(p => !p.product_id && !p.vendor_source).length}</div><div style={{ fontSize: 10, color: '#64748b' }}>Unmatched</div></div>
          </div>

          {(ai.warnings || []).length > 0 && <div style={{ marginBottom: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠️ Notes from Claude</div>
            {ai.warnings.map((w, i) => <div key={i} style={{ fontSize: 10, color: '#92400e' }}>{w}</div>)}
          </div>}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>📦 Review & Edit</div>
          <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <table style={{ fontSize: 11 }}>
              <thead><tr><th style={{ width: 30 }}>✓</th><th>SKU</th><th>Match</th><th>Name</th><th>Brand</th><th>Color</th><th>Sizes</th><th>Qty</th><th>Notes</th></tr></thead>
              <tbody>{ai.parsed.map((it, i) => {
                const toggle = () => setAi(x => ({ ...x, parsed: x.parsed.map((p, pi) => pi === i ? { ...p, _skip: !p._skip } : p) }));
                const upd = (k, v) => setAi(x => ({ ...x, parsed: x.parsed.map((p, pi) => pi === i ? { ...p, [k]: v } : p) }));
                const mq = it.match_quality;
                const isVendor = typeof mq === 'string' && mq.startsWith('vendor_');
                const vendorName = isVendor ? mq.slice('vendor_'.length) : null;
                const vendorLabel = vendorName === 'sanmar' ? '🟦 SanMar' : vendorName === 'ss' ? '🟪 S&S' : vendorName === 'momentec' ? '🟧 Momentec' : null;
                const mqLabel = vendorLabel || (mq === 'exact' ? '✓ Exact' : mq === 'stripped' ? '✓ Trimmed' : mq === 'fuzzy_name' ? '~ Fuzzy' : mq === 'no_sku' ? '? No SKU' : '✗ Unmatched');
                const mqColor = isVendor ? '#1e40af' : (mq === 'exact' || mq === 'stripped' ? '#166534' : mq === 'fuzzy_name' ? '#d97706' : '#dc2626');
                const mqBg = isVendor ? '#dbeafe' : (mq === 'exact' || mq === 'stripped' ? '#dcfce7' : mq === 'fuzzy_name' ? '#fef3c7' : '#fee2e2');
                const hasResolvedSource = !!it.product_id || isVendor;
                return <tr key={i} style={{ opacity: it._skip ? 0.4 : 1, background: !hasResolvedSource ? '#fffbeb' : 'white' }}>
                  <td><input type="checkbox" checked={!it._skip} onChange={toggle} /></td>
                  <td><input className="form-input" value={it.sku_guess || ''} onChange={e => upd('sku_guess', e.target.value)} style={{ width: 90, fontSize: 10, fontFamily: 'monospace' }} /></td>
                  <td><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: mqBg, color: mqColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{mqLabel}</span>
                    {it.confidence && <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>conf: {it.confidence}</div>}</td>
                  <td style={{ maxWidth: 180 }}><input className="form-input" value={it.name || ''} onChange={e => upd('name', e.target.value)} style={{ width: '100%', fontSize: 10 }} /></td>
                  <td><input className="form-input" value={it.brand || ''} onChange={e => upd('brand', e.target.value)} style={{ width: 70, fontSize: 10 }} /></td>
                  <td><input className="form-input" value={it.color || ''} onChange={e => upd('color', e.target.value)} style={{ width: 80, fontSize: 10 }} /></td>
                  <td style={{ fontSize: 9 }}>{Object.entries(it.sizes || {}).map(([s, q]) => s + ':' + q).join(', ')}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{it.total_qty || Object.values(it.sizes || {}).reduce((a, b) => a + (+b || 0), 0)}</td>
                  <td style={{ maxWidth: 160 }}>
                    {it.notes && <div style={{ fontSize: 9, color: '#64748b' }}>{it.notes}</div>}
                    {it.raw_line && <div style={{ fontSize: 8, color: '#94a3b8', fontStyle: 'italic', marginTop: 2, maxHeight: 30, overflow: 'hidden' }}>"{(it.raw_line || '').slice(0, 80)}"</div>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', borderRadius: 6, fontSize: 11, color: '#64748b' }}>
            💡 Unmatched items become custom items. You can fix SKUs here, or in the {orderType === 'so' ? 'sales order' : 'estimate'} editor afterward.
          </div>
          {ai.error && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>⚠ {ai.error}</div>}
        </>}

      </div>

      {/* FOOTER — navigation buttons */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
        <div>{step > 1 && !ai.loading && <button className="btn btn-secondary" onClick={() => {
          if (step === 3 && ai.hasParsed) { setAi(x => ({ ...x, hasParsed: false, parsed: [], warnings: [], build_id: null })); return; }
          setStep(s => Math.max(1, s - 1));
        }}>← Back</button>}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={close} disabled={ai.loading}>Cancel</button>
          {step === 1 && <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={!canAdvanceFrom1} onClick={() => setStep(2)}>Next →</button>}
          {step === 2 && <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={!canAdvanceFrom2} onClick={() => setStep(3)}>Next →</button>}
          {step === 3 && !ai.hasParsed && <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={ai.loading || !inputReady} onClick={runParse}>{ai.loading ? '🤖 Working…' : '✨ Parse with AI'}</button>}
          {step === 3 && ai.hasParsed && <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={ai.parsed.filter(p => !p._skip).length === 0} onClick={handleCreate}>✅ Create {orderType === 'so' ? 'Sales Order' : 'Estimate'} with {ai.parsed.filter(p => !p._skip).length} item{ai.parsed.filter(p => !p._skip).length === 1 ? '' : 's'}</button>}
        </div>
      </div>
    </div>
  </div>;
}

export default AiOrderWizard;
