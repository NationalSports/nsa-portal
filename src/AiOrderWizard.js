/* eslint-disable */
// Global "Build with AI" wizard. Mounted from the top nav. Two screens:
//   1) Build: pick customer + supply input (text / image / Google Sheets URL),
//      then parse with Claude (with vendor SKU enrichment for unmatched items).
//   2) Review: confirm parsed lines → creates an estimate prefilled with them.
// Hands off to App.js's `newE` callback which lands the user in the estimate
// editor with all items already populated.
import React, { useState } from 'react';
import { Icon, SearchSelect, ProductPicker } from './components';
import { invokeEdgeFn, enrichAiLinesWithVendors } from './utils';
import { rQ, auTierDisc, isAU } from './pricing';

const initialAi = () => ({
  inputMode: 'text', parseMode: 'order', combineNameNum: false, text: '', images: [], url: '',
  loading: false, error: null, statusMsg: null,
  parsed: [], rosters: [], warnings: [], build_id: null, hasParsed: false,
});

const SZ_ORDER = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'OSFA'];
const szSort = (a, b) => { const ia = SZ_ORDER.indexOf(a), ib = SZ_ORDER.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); };

export function AiOrderWizard({ open, onClose, supabase, products, customers, vendors, defaultMarkup, onCreateEstimate, nf, cu }) {
  const [customerId, setCustomerId] = useState(null);
  const [ai, setAi] = useState(initialAi);

  if (!open) return null;

  const customer = customerId ? (customers || []).find(c => c.id === customerId) : null;

  const reset = () => { setCustomerId(null); setAi(initialAi()); };
  const close = () => { if (!ai.loading) { reset(); onClose(); } };

  const runParse = async () => {
    if (!supabase) { setAi(x => ({ ...x, error: 'Supabase not configured' })); return; }
    setAi(x => ({ ...x, loading: true, error: null, statusMsg: 'Sending to Claude…' }));
    try {
      const catalog = (products || []).map(p => ({ id: p.id, sku: p.sku, name: p.name, brand: p.brand, color: p.color, available_sizes: p.available_sizes }));
      const payload = {
        input_type: ai.inputMode,
        mode: ai.parseMode,
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

      if (ai.parseMode === 'roster') {
        let rosters = (d.rosters || []).map(r => ({
          ...r, _skip: false,
          players: (r.players || []).map(p => ({ ...p, _skip: false })),
        }));
        const unmatched = rosters.filter(r => !r.product_id && (r.sku_guess || '').trim()).length;
        if (unmatched > 0) {
          setAi(x => ({ ...x, statusMsg: `Looking up ${unmatched} SKU${unmatched === 1 ? '' : 's'} in vendor catalogs…` }));
          try { rosters = await enrichAiLinesWithVendors(rosters, (done, total) => setAi(x => ({ ...x, statusMsg: `Vendor lookup: ${done}/${total}…` }))); }
          catch (e) { console.warn('[AiOrderWizard] vendor enrichment failed:', e); }
        }
        setAi(x => ({ ...x, loading: false, statusMsg: null, rosters, warnings: d.warnings || [], build_id: d.build_id || null, hasParsed: true }));
        return;
      }

      let lines = (d.lines || []).map(l => ({ ...l, _skip: false }));

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

  const findCatMatch = (sku, product_id) => product_id
    ? (products || []).find(pr => pr.id === product_id)
    : (sku ? ((products || []).find(pr => pr.sku === sku) || (products || []).find(pr => pr.sku.toLowerCase() === sku.toLowerCase())) : null);

  const buildRosterItems = (mk) => {
    const keeping = (ai.rosters || []).filter(r => !r._skip);
    return keeping.map(r => {
      const sku = (r.sku_guess || '').trim();
      const catMatch = findCatMatch(sku, r.product_id);
      const brand = catMatch?.brand || r.brand || '';
      const au = isAU(brand) && !String(catMatch?.id||'').startsWith('ssa-');
      const cost = catMatch?.nsa_cost || r.vendor_price || 0;
      const retail = catMatch?.retail_price || r.vendor_retail || 0;
      const sell = au
        ? rQ(retail * (1 - auTierDisc(customer?.adidas_ua_tier || 'B', catMatch?.pricing_group, catMatch?.category)))
        : rQ(cost * mk);
      // One row = one garment unit. Build size counts plus parallel
      // numbers/names arrays (same index = same player) keyed by size, the
      // exact shape the number/name deco lines expect.
      const combine = !!ai.combineNameNum;
      const players = (r.players || []).filter(p => !p._skip);
      const sizes = {}, numbers = {}, names = {};
      players.forEach(p => {
        const sz = (p.size || 'M').toUpperCase();
        sizes[sz] = (sizes[sz] || 0) + 1;
        const num = p.number ? String(p.number).trim() : '';
        const nm = (p.name || '').trim();
        if (combine) {
          // Name + number share a single line, e.g. "MATRO - 22".
          (names[sz] = names[sz] || []).push(nm && num ? `${nm} - ${num}` : (nm || num));
        } else {
          (numbers[sz] = numbers[sz] || []).push(num);
          (names[sz] = names[sz] || []).push(nm);
        }
      });
      const hasNums = Object.values(numbers).some(a => a.some(v => v && String(v).trim()));
      const hasNames = Object.values(names).some(a => a.some(v => v && String(v).trim()));
      const decorations = [];
      if (hasNums) decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '8"', two_color: false, sell_override: null, custom_font_art_id: null, roster: numbers });
      if (hasNames) decorations.push({ kind: 'names', position: 'Back Center', name_method: 'heat_press', sell_override: null, sell_each: 6, cost_each: 3, names });
      const szKeys = Object.keys(sizes).sort(szSort);
      return {
        product_id: catMatch?.id || null,
        sku: sku || 'CUSTOM',
        name: catMatch?.name || r.name || '',
        brand,
        vendor_id: catMatch?.vendor_id || null,
        pricing_group: catMatch?.pricing_group || null,
        color: catMatch?.color || r.color || '',
        nsa_cost: cost,
        retail_price: retail,
        unit_sell: sell,
        available_sizes: szKeys.length > 0 ? szKeys : (catMatch?.available_sizes || ['S', 'M', 'L', 'XL', '2XL']),
        sizes,
        decorations,
        no_deco: decorations.length === 0,
        is_custom: !catMatch && !r.vendor_source,
        vendor_source: r.vendor_source || null,
        pick_lines: [],
        po_lines: [],
      };
    });
  };

  const handleCreate = () => {
    if (ai.parseMode === 'roster') {
      const keepingR = (ai.rosters || []).filter(r => !r._skip && (r.players || []).some(p => !p._skip));
      if (keepingR.length === 0) { setAi(x => ({ ...x, error: 'Nothing to import — keep at least one roster with players.' })); return; }
      const mk = customer?.catalog_markup || defaultMarkup || 1.65;
      const items = buildRosterItems(mk);
      if (supabase && ai.build_id) {
        try { supabase.from('ai_order_builds').update({ accepted_lines: keepingR, accepted_count: keepingR.length }).eq('id', ai.build_id); } catch (_) {}
      }
      onCreateEstimate(customer, items);
      const players = items.reduce((a, it) => a + Object.values(it.sizes).reduce((b, v) => b + v, 0), 0);
      if (nf) nf('✨ Created estimate with ' + items.length + ' roster item' + (items.length === 1 ? '' : 's') + ' (' + players + ' players)');
      reset();
      onClose();
      return;
    }
    const keeping = (ai.parsed || []).filter(p => !p._skip);
    if (keeping.length === 0) { setAi(x => ({ ...x, error: 'Nothing to import — uncheck "skip" on at least one line.' })); return; }
    const mk = customer?.catalog_markup || defaultMarkup || 1.65;
    const items = keeping.map(p => {
      const sku = (p.sku_guess || '').trim();
      const catMatch = p.product_id ? (products || []).find(pr => pr.id === p.product_id) :
        (sku ? ((products || []).find(pr => pr.sku === sku) || (products || []).find(pr => pr.sku.toLowerCase() === sku.toLowerCase())) : null);
      const brand = catMatch?.brand || p.brand || '';
      const au = isAU(brand) && !String(catMatch?.id||'').startsWith('ssa-');
      const cost = catMatch?.nsa_cost || p.vendor_price || 0;
      const retail = catMatch?.retail_price || p.vendor_retail || 0;
      const sell = au
        ? rQ(retail * (1 - auTierDisc(customer?.adidas_ua_tier || 'B', catMatch?.pricing_group, catMatch?.category)))
        : rQ(cost * mk);
      const szKeys = Object.keys(p.sizes || {});
      return {
        product_id: catMatch?.id || null,
        sku: sku || 'CUSTOM',
        name: catMatch?.name || p.name || '',
        brand,
        vendor_id: catMatch?.vendor_id || null,
        pricing_group: catMatch?.pricing_group || null,
        color: catMatch?.color || p.color || '',
        nsa_cost: cost,
        retail_price: retail,
        unit_sell: sell,
        available_sizes: szKeys.length > 0 ? szKeys : (catMatch?.available_sizes || ['S', 'M', 'L', 'XL', '2XL']),
        sizes: p.sizes || {},
        decorations: [],
        // Vendor-matched items aren't "custom" — they have a real SKU and
        // pricing from SanMar/S&S/Momentec. Only flag is_custom when there's
        // no internal catalog match AND no vendor source.
        is_custom: !catMatch && !p.vendor_source,
        vendor_source: p.vendor_source || null,
        pick_lines: [],
        po_lines: [],
      };
    });
    if (supabase && ai.build_id) {
      try { supabase.from('ai_order_builds').update({ accepted_lines: keeping, accepted_count: keeping.length }).eq('id', ai.build_id); } catch (_) {}
    }
    onCreateEstimate(customer, items);
    if (nf) nf('✨ Created estimate with ' + items.length + ' AI-parsed item' + (items.length === 1 ? '' : 's'));
    reset();
    onClose();
  };

  const inputReady = (ai.inputMode === 'text' && ai.text.trim()) || (ai.inputMode === 'image' && ai.images.length > 0) || (ai.inputMode === 'url' && ai.url.trim());
  const canParse = !ai.loading && !!customerId && inputReady;

  return <div className="modal-overlay" onClick={close}>
    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 960, maxHeight: '92vh', overflow: 'auto' }}>
      <div className="modal-header" style={{ background: 'linear-gradient(135deg,#ede9fe,#dbeafe)' }}>
        <h2>✨ Build Estimate with AI</h2>
        <button className="modal-close" onClick={close} disabled={ai.loading}>×</button>
      </div>

      <div className="modal-body" style={{ minHeight: 360 }}>

        {/* BUILD — customer + input on one screen */}
        {!ai.hasParsed && <>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>Customer</label>
            <SearchSelect
              options={(customers || []).filter(c => c.is_active !== false).map(c => ({
                value: c.id,
                label: c.name + (c.alpha_tag ? ' (' + c.alpha_tag + ')' : ''),
              }))}
              value={customerId}
              onChange={v => setCustomerId(v)}
              placeholder="Search customer by name or tag…"
            />
            {customer && <div style={{ marginTop: 8, padding: '6px 10px', background: '#f0fdf4', borderRadius: 6, fontSize: 11, color: '#166534' }}>
              ✓ <b>{customer.name}</b>
              {customer.adidas_ua_tier && <span style={{ marginLeft: 8, fontSize: 10 }}>Adidas/UA tier {customer.adidas_ua_tier}</span>}
              {customer.catalog_markup && <span style={{ marginLeft: 8, fontSize: 10 }}>markup {customer.catalog_markup}x</span>}
            </div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>What are we building?</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['order', '📦 Order', 'Sizes & quantities → line items'], ['roster', '🧍 Roster', 'Names / numbers / sizes → deco lines']].map(([k, label, sub]) =>
                <button key={k} onClick={() => setAi(x => ({ ...x, parseMode: k, error: null }))}
                  style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: ai.parseMode === k ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                    background: ai.parseMode === k ? '#f5f3ff' : 'white' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ai.parseMode === k ? '#6d28d9' : '#334155' }}>{label}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{sub}</div>
                </button>)}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>{ai.parseMode === 'roster' ? 'Paste / upload the roster' : 'What did the coach send?'}</label>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
              {[['text', '📝 Paste Text'], ['image', '📷 Upload Image'], ['url', '🔗 Sheets / URL']].map(([k, label]) =>
                <button key={k} onClick={() => setAi(x => ({ ...x, inputMode: k, error: null }))}
                  style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: ai.inputMode === k ? '2px solid #7c3aed' : '2px solid transparent',
                    color: ai.inputMode === k ? '#7c3aed' : '#64748b' }}>{label}</button>)}
            </div>

            {ai.inputMode === 'text' && <textarea className="form-input" rows={10} value={ai.text}
              onChange={e => setAi(x => ({ ...x, text: e.target.value }))}
              placeholder={ai.parseMode === 'roster'
                ? "Paste the roster — one player per row. Examples:\n\nGame Jersey JY6033 (Black)\nName     #    Size\nSmith    12   M\nJones    7    L\nWilliams 23   XL\n\n(SKU can be one for the whole team, or a column per row.)"
                : "Paste whatever the coach sent. Examples:\n\nTechfit Sleeveless Tee (Black) JY6033\nS/40  M/60  L/60  XL/60  2XL/15  3XL/15\n\nM Everyday Pro Reversible (Black) JM5094\nSizing S/50  M/50  L/50  XL/30  2XL/15"}
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
                style={{ border: '2px dashed #c4b5fd', borderRadius: 8, padding: 20, minHeight: 100, background: '#faf5ff', textAlign: 'center', color: '#7c3aed', fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'text' }}>
                {(ai.images || []).length === 0 ? 'Drop or paste images here' : `${ai.images.length} image(s) attached`}
              </div>
              {(ai.images || []).length > 0 && <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ai.images.map((im, i) => <div key={i} style={{ position: 'relative', border: '1px solid #e2e8f0', borderRadius: 6, padding: 4 }}>
                  <img src={im.dataUrl} alt={im.name} style={{ maxWidth: 120, maxHeight: 120, display: 'block' }} />
                  <button onClick={() => setAi(x => ({ ...x, images: x.images.filter((_, ii) => ii !== i) }))}
                    style={{ position: 'absolute', top: 2, right: 2, background: '#fee2e2', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, color: '#991b1b' }}>×</button>
                </div>)}
              </div>}
              <textarea className="form-input" rows={2} value={ai.text} placeholder="Optional: notes for Claude (e.g. 'youth sizes', 'add 2 of each for staff')"
                onChange={e => setAi(x => ({ ...x, text: e.target.value }))} style={{ marginTop: 8, fontSize: 12 }} />
            </div>}

            {ai.inputMode === 'url' && <div>
              <input className="form-input" type="url" value={ai.url} onChange={e => setAi(x => ({ ...x, url: e.target.value }))}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=…" style={{ fontSize: 12 }} />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                Google Sheets must be shared as "Anyone with the link can view." For private sheets, switch to "Paste Text" and copy the rows in.
              </div>
            </div>}
          </div>

          {ai.error && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>⚠ {ai.error}</div>}

          {ai.loading && <div style={{ marginTop: 14 }}>
            <div style={{ height: 6, background: '#ede9fe', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', background: 'linear-gradient(90deg,#a78bfa,#7c3aed,#a78bfa)', borderRadius: 3, animation: 'aiWizSlide 1.4s infinite ease-in-out' }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{ai.statusMsg || 'Working…'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(typically 5–20s)</span></div>
            <style>{`@keyframes aiWizSlide{0%{left:-30%}50%{left:50%}100%{left:100%}}`}</style>
          </div>}
        </>}

        {/* REVIEW — ROSTER */}
        {ai.hasParsed && ai.parseMode === 'roster' && (() => {
          const totalPlayers = (ai.rosters || []).reduce((a, r) => a + (r.players || []).length, 0);
          const matched = (ai.rosters || []).filter(r => r.product_id || r.vendor_source).length;
          const updR = (ri, k, v) => setAi(x => ({ ...x, rosters: x.rosters.map((r, i) => i === ri ? { ...r, [k]: v } : r) }));
          const updP = (ri, pi, k, v) => setAi(x => ({ ...x, rosters: x.rosters.map((r, i) => i === ri ? { ...r, players: r.players.map((p, j) => j === pi ? { ...p, [k]: v } : p) } : r) }));
          const togglePlayer = (ri, pi) => setAi(x => ({ ...x, rosters: x.rosters.map((r, i) => i === ri ? { ...r, players: r.players.map((p, j) => j === pi ? { ...p, _skip: !p._skip } : p) } : r) }));
          const addPlayer = ri => setAi(x => ({ ...x, rosters: x.rosters.map((r, i) => i === ri ? { ...r, players: [...r.players, { name: '', number: '', size: 'M', _skip: false }] } : r) }));
          // Bind a group to a real catalog product. Sets the SKU/name/color/brand
          // from the catalog and marks it a manual match so the build step uses
          // this product's pricing. Clears any prior vendor match.
          const bindProductR = (ri, p) => setAi(x => ({ ...x, rosters: x.rosters.map((r, i) => i === ri ? { ...r, product_id: p.id, sku_guess: p.sku, name: p.name || r.name, color: p.color || r.color, brand: p.brand || r.brand, match_quality: 'manual', vendor_source: null } : r) }));
          return <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ padding: 8, background: '#ede9fe', borderRadius: 6, flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#7c3aed' }}>{(ai.rosters || []).length}</div><div style={{ fontSize: 10, color: '#64748b' }}>Roster Items</div></div>
              <div style={{ padding: 8, background: '#dbeafe', borderRadius: 6, flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1e40af' }}>{totalPlayers}</div><div style={{ fontSize: 10, color: '#64748b' }}>Players</div></div>
              <div style={{ padding: 8, background: '#f0fdf4', borderRadius: 6, flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#166534' }}>{matched}</div><div style={{ fontSize: 10, color: '#64748b' }}>SKU Matches</div></div>
            </div>

            {(ai.warnings || []).length > 0 && <div style={{ marginBottom: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠️ Notes from Claude</div>
              {ai.warnings.map((w, i) => <div key={i} style={{ fontSize: 10, color: '#92400e' }}>{w}</div>)}
            </div>}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 10px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={ai.combineNameNum} onChange={e => setAi(x => ({ ...x, combineNameNum: e.target.checked }))} />
              <span><b>Combine name + number onto one line</b> — e.g. “MATRO - 22” as a single names deco, instead of separate name and number decos.</span>
            </label>

            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {(ai.rosters || []).map((r, ri) => {
                const mq = r.match_quality;
                const isVendor = typeof mq === 'string' && mq.startsWith('vendor_');
                const vendorName = isVendor ? mq.slice('vendor_'.length) : null;
                const vendorLabel = vendorName === 'sanmar' ? '🟦 SanMar' : vendorName === 'ss' ? '🟪 S&S' : vendorName === 'momentec' ? '🟧 Momentec' : null;
                const mqLabel = vendorLabel || (mq === 'manual' ? '✓ Picked' : mq === 'exact' ? '✓ Exact' : mq === 'stripped' ? '✓ Trimmed' : mq === 'fuzzy_name' ? '~ Fuzzy' : mq === 'no_sku' ? '? No SKU' : '✗ Unmatched');
                const matchedSrc = !!r.product_id || isVendor;
                const activePlayers = (r.players || []).filter(p => !p._skip).length;
                return <div key={ri} style={{ marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, opacity: r._skip ? 0.5 : 1, background: matchedSrc ? 'white' : '#fffbeb' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                    <input type="checkbox" checked={!r._skip} onChange={() => updR(ri, '_skip', !r._skip)} title="Include this item" />
                    <input className="form-input" value={r.sku_guess || ''} onChange={e => updR(ri, 'sku_guess', e.target.value)} placeholder="SKU" style={{ width: 90, fontSize: 11, fontFamily: 'monospace' }} />
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap', background: matchedSrc ? '#dcfce7' : mq === 'fuzzy_name' ? '#fef3c7' : '#fee2e2', color: matchedSrc ? '#166534' : mq === 'fuzzy_name' ? '#d97706' : '#dc2626' }}>{mqLabel}</span>
                    <input className="form-input" value={r.name || ''} onChange={e => updR(ri, 'name', e.target.value)} placeholder="Product name" style={{ flex: 1, minWidth: 120, fontSize: 11 }} />
                    <input className="form-input" value={r.color || ''} onChange={e => updR(ri, 'color', e.target.value)} placeholder="Color" style={{ width: 80, fontSize: 11 }} />
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{activePlayers} player{activePlayers === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #f8fafc' }}>
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>🔗 Attach item:</span>
                    <div style={{ flex: 1, maxWidth: 320 }}>
                      <ProductPicker products={products} value={r.product_id} onPick={p => bindProductR(ri, p)} placeholder={r.product_id ? 'Change catalog item…' : 'Search catalog SKU / name to attach…'} />
                    </div>
                  </div>
                  <div style={{ padding: '6px 10px' }}>
                    <table style={{ fontSize: 11, width: '100%' }}>
                      <thead><tr><th style={{ width: 24 }}>✓</th><th style={{ textAlign: 'left' }}>Name</th><th style={{ width: 60 }}>Number</th><th style={{ width: 70 }}>Size</th></tr></thead>
                      <tbody>{(r.players || []).map((p, pi) => <tr key={pi} style={{ opacity: p._skip ? 0.4 : 1 }}>
                        <td><input type="checkbox" checked={!p._skip} onChange={() => togglePlayer(ri, pi)} /></td>
                        <td><input className="form-input" value={p.name || ''} onChange={e => updP(ri, pi, 'name', e.target.value)} placeholder="—" style={{ width: '100%', fontSize: 11 }} /></td>
                        <td><input className="form-input" value={p.number || ''} onChange={e => updP(ri, pi, 'number', e.target.value)} placeholder="—" style={{ width: 50, fontSize: 11, textAlign: 'center' }} /></td>
                        <td><input className="form-input" value={p.size || ''} onChange={e => updP(ri, pi, 'size', e.target.value.toUpperCase())} placeholder="M" style={{ width: 60, fontSize: 11, textAlign: 'center' }} /></td>
                      </tr>)}</tbody>
                    </table>
                    <button className="btn btn-sm btn-secondary" style={{ fontSize: 10, marginTop: 4 }} onClick={() => addPlayer(ri)}>+ Add player</button>
                  </div>
                </div>;
              })}
            </div>
            <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', borderRadius: 6, fontSize: 11, color: '#64748b' }}>
              💡 {ai.combineNameNum
                ? 'Each item gets one names deco with name + number combined (e.g. “MATRO - 22”).'
                : 'Each item gets a numbers deco (Back, 8" screen print) and a names deco (Back Center, heat press) pre-filled from the roster.'} Adjust methods, positions and pricing in the estimate editor.
            </div>
            {ai.error && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>⚠ {ai.error}</div>}
          </>;
        })()}

        {/* REVIEW — ORDER */}
        {ai.hasParsed && ai.parseMode !== 'roster' && <>
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
              <thead><tr><th style={{ width: 30 }}>✓</th><th>SKU</th><th>Match</th><th>Attach item</th><th>Name</th><th>Brand</th><th>Color</th><th>Sizes</th><th>Qty</th><th>Notes</th></tr></thead>
              <tbody>{ai.parsed.map((it, i) => {
                const toggle = () => setAi(x => ({ ...x, parsed: x.parsed.map((p, pi) => pi === i ? { ...p, _skip: !p._skip } : p) }));
                const upd = (k, v) => setAi(x => ({ ...x, parsed: x.parsed.map((p, pi) => pi === i ? { ...p, [k]: v } : p) }));
                const mq = it.match_quality;
                const isVendor = typeof mq === 'string' && mq.startsWith('vendor_');
                const vendorName = isVendor ? mq.slice('vendor_'.length) : null;
                const vendorLabel = vendorName === 'sanmar' ? '🟦 SanMar' : vendorName === 'ss' ? '🟪 S&S' : vendorName === 'momentec' ? '🟧 Momentec' : null;
                const mqLabel = vendorLabel || (mq === 'manual' ? '✓ Picked' : mq === 'exact' ? '✓ Exact' : mq === 'stripped' ? '✓ Trimmed' : mq === 'fuzzy_name' ? '~ Fuzzy' : mq === 'no_sku' ? '? No SKU' : '✗ Unmatched');
                const mqColor = isVendor ? '#1e40af' : (mq === 'manual' || mq === 'exact' || mq === 'stripped' ? '#166534' : mq === 'fuzzy_name' ? '#d97706' : '#dc2626');
                const mqBg = isVendor ? '#dbeafe' : (mq === 'manual' || mq === 'exact' || mq === 'stripped' ? '#dcfce7' : mq === 'fuzzy_name' ? '#fef3c7' : '#fee2e2');
                const bindOrder = p => setAi(x => ({ ...x, parsed: x.parsed.map((q, qi) => qi === i ? { ...q, product_id: p.id, sku_guess: p.sku, name: p.name || q.name, brand: p.brand || q.brand, color: p.color || q.color, match_quality: 'manual', vendor_source: null } : q) }));
                const hasResolvedSource = !!it.product_id || isVendor;
                return <tr key={i} style={{ opacity: it._skip ? 0.4 : 1, background: !hasResolvedSource ? '#fffbeb' : 'white' }}>
                  <td><input type="checkbox" checked={!it._skip} onChange={toggle} /></td>
                  <td><input className="form-input" value={it.sku_guess || ''} onChange={e => upd('sku_guess', e.target.value)} style={{ width: 90, fontSize: 10, fontFamily: 'monospace' }} /></td>
                  <td><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: mqBg, color: mqColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{mqLabel}</span>
                    {it.confidence && !isVendor && !it.product_id && <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>conf: {it.confidence}</div>}</td>
                  <td style={{ minWidth: 150 }}><ProductPicker products={products} value={it.product_id} onPick={bindOrder} placeholder={it.product_id ? 'Change…' : '🔍 Attach SKU…'} /></td>
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
            💡 Unmatched items become custom items. You can fix SKUs here, or in the estimate editor afterward.
          </div>
          {ai.error && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#991b1b' }}>⚠ {ai.error}</div>}
        </>}

      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
        <div>{ai.hasParsed && !ai.loading && <button className="btn btn-secondary" onClick={() => setAi(x => ({ ...x, hasParsed: false, parsed: [], rosters: [], warnings: [], build_id: null }))}>← Back</button>}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={close} disabled={ai.loading}>Cancel</button>
          {!ai.hasParsed && <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={!canParse} onClick={runParse}>{ai.loading ? '🤖 Working…' : '✨ Parse with AI'}</button>}
          {ai.hasParsed && (() => {
            const keptCount = ai.parseMode === 'roster'
              ? (ai.rosters || []).filter(r => !r._skip && (r.players || []).some(p => !p._skip)).length
              : ai.parsed.filter(p => !p._skip).length;
            return <button className="btn btn-primary" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} disabled={keptCount === 0} onClick={handleCreate}>✅ Create Estimate with {keptCount} item{keptCount === 1 ? '' : 's'}</button>;
          })()}
        </div>
      </div>
    </div>
  </div>;
}

export default AiOrderWizard;
