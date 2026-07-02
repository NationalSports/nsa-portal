/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';

// ─── Size lists ───────────────────────────────────────────────────────────────
const SZ_YOUTH = ['YXS','YS','YM','YL','YXL'];
const SZ_ADULT = ['2XS','XS','S','M','L','XL','2XL','3XL','OSFA'];
const SZ_STANDARD = [...SZ_YOUTH, ...SZ_ADULT];
const SZ_SOCKS = ['3XS','2XS','XS','Youth Sleeves','Small','Medium','Large'];
const STATUS_LABELS = { draft:'Draft', open:'Open', submitted:'Submitted', processing:'Processing', fulfilled:'Fulfilled' };
const STATUS_COLORS = { draft:'#94a3b8', open:'#2563eb', submitted:'#7c3aed', processing:'#d97706', fulfilled:'#15803d' };

// Which size groups actually have a SKU linked for a kit item — a group is
// only a real choice if there's a product behind it.
const linkedGroups = (ki) => ['YM', 'WM', 'AM'].filter(g =>
  g === 'YM' ? !!ki.product_youth_id : g === 'WM' ? !!ki.product_womens_id : !!ki.product_id);

// Which group a given size string belongs to. Youth sizes (YXS/YS/YM/YL/YXL)
// never collide with the Adult/Women's scale (2XS…3XL/OSFA), so the size a
// coach TYPES already says Youth-or-not — no separate control needed. The
// player's own roster category only breaks the rare Adult-vs-Women's tie,
// since those two share the identical size scale.
const resolveSizeGroup = (sz, player, groups) => {
  if (SZ_YOUTH.includes(sz)) return 'YM';
  if (groups.includes('WM') && (player.category || 'AM') === 'WM') return 'WM';
  return 'AM';
};

// Required kit items a player still needs a size for. "Required" = not flagged
// optional in the catalog and not a checkbox (no_size) item; keeper gear only
// counts for keepers. Drives the per-team completeness indicator and the
// lock/submit warnings.
const missingSizesFor = (player, kitItems, cellsForPlayer) => (kitItems || [])
  .filter(ki => !ki.optional && !ki.no_size && (!ki.gk_only || player.is_gk))
  .filter(ki => { const sz = ((cellsForPlayer || {})[ki.slot] || {}).size; return !sz || sz === '-'; });

// Parse rows pasted from a spreadsheet (Sheets/Excel copy = tab-separated;
// plain CSV also accepted). Per row: any 1–3 digit cell is the jersey number,
// a YM/WM/AM cell is the category, remaining text is first + last name (a
// single "First Last" cell is split on the first space). A leading
// header-looking row ("First", "Name", …) is skipped.
const parsePastedRoster = (text) => {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim());
    if (!rows.length && /\b(first|last|name|player|number|cat)\b/i.test(cells.join(' ')) && !cells.some(c => /^\d{1,3}$/.test(c))) return;
    let num = '', cat = '';
    const rest = [];
    cells.forEach(c => {
      if (!c) return;
      if (/^#?\d{1,3}$/.test(c) && !num) num = c.replace('#', '');
      else if (/^(ym|wm|am)$/i.test(c) && !cat) cat = c.toUpperCase();
      else rest.push(c);
    });
    let first = '', last = '';
    if (rest.length >= 2) { first = rest[0]; last = rest.slice(1).join(' '); }
    else if (rest.length === 1) { const parts = rest[0].split(/\s+/); first = parts[0]; last = parts.slice(1).join(' '); }
    if (first || last || num) rows.push({ first_name: first, last_name: last, jersey_number: num, category: cat || null });
  });
  return rows;
};

// ─── Inventory hook (product_inventory + inventory_unified) ───────────────────
function useKitInventory(items) {
  const [inv, setInv] = useState({});
  const pidKey = (items || []).flatMap(i => [i.product_id, i.product_youth_id, i.product_womens_id]).filter(Boolean).join(',');

  useEffect(() => {
    const productIds = [...new Set((items || []).flatMap(i => [i.product_id, i.product_youth_id, i.product_womens_id]).filter(Boolean))];
    if (!productIds.length) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: prods }, { data: inHouse }] = await Promise.all([
          supabase.from('products').select('id,sku').in('id', productIds),
          supabase.from('product_inventory').select('product_id,size,quantity').in('product_id', productIds),
        ]);
        const skuByPid = {};
        (prods || []).forEach(p => { if (p.sku) skuByPid[p.id] = p.sku; });
        const skus = [...new Set(Object.values(skuByPid))];
        let vendorRows = [];
        if (skus.length) {
          const { data: v } = await supabase
            .from('inventory_unified')
            .select('sku,size,stock_qty,future_delivery_qty,future_delivery_date')
            .in('sku', skus);
          vendorRows = v || [];
        }
        if (cancelled) return;
        const map = {};
        (inHouse || []).forEach(r => {
          if (!map[r.product_id]) map[r.product_id] = {};
          const s = map[r.product_id][r.size] || { ih: 0, vendor: 0, incoming: 0, eta: null };
          s.ih += (r.quantity || 0);
          map[r.product_id][r.size] = s;
        });
        const pidBySku = {};
        Object.entries(skuByPid).forEach(([pid, sku]) => { pidBySku[sku] = pid; });
        vendorRows.forEach(r => {
          const pid = pidBySku[r.sku];
          if (!pid) return;
          if (!map[pid]) map[pid] = {};
          const s = map[pid][r.size] || { ih: 0, vendor: 0, incoming: 0, eta: null };
          s.vendor += (r.stock_qty || 0);
          if ((r.future_delivery_qty || 0) > 0) {
            s.incoming += r.future_delivery_qty;
            if (!s.eta) s.eta = r.future_delivery_date;
          }
          map[pid][r.size] = s;
        });
        setInv(map);
      } catch (e) { console.error('[RosterOrders] inv:', e); }
    })();
    return () => { cancelled = true; };
  }, [pidKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getStock = useCallback((productId, size) => {
    const s = inv[productId]?.[size];
    if (!s) return { avail: 0, incoming: 0, eta: null };
    return { avail: (s.ih || 0) + (s.vendor || 0), incoming: s.incoming || 0, eta: s.eta };
  }, [inv]);

  return { inv, getStock };
}

// Availability dot color
const _dotColor = (avail, incoming) =>
  avail > 0 ? '#15803d' : incoming > 0 ? '#b45309' : '#dc2626';

// ─── Dismissible step-by-step instructions ─────────────────────────────────────
// A small "how this works" card a coach can dismiss for good (per browser, via
// localStorage) once they've read it — reappears for a fresh device/coach.
function InstructionsCard({ storageKey, title, steps }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '1'; } catch { return true; }
  });
  if (!open) return null;
  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* noop */ }
    setOpen(false);
  };
  return (
    <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: '#1e3a5f', marginBottom: 6 }}>{title}</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#334155', lineHeight: 1.7 }}>
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }} title="Dismiss">×</button>
      </div>
    </div>
  );
}

// Default Encinitas-style kit — used to seed a brand-new item catalog so staff
// have a starting point to attach product IDs to.
const DEFAULT_KIT = [
  { slot: 'jersey_white', label: 'Jersey (White)', color: '', takes_number: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'jersey_navy', label: 'Jersey (Navy)', color: '', takes_number: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'shorts', label: 'Shorts', color: '', qty: 2, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'training_shirt', label: 'Training Shirt', color: '', qty: 2, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'game_day_shirt', label: 'Game Day Shirt', color: '', takes_number: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'socks', label: 'Socks', color: '', qty: 2, product_id: '', product_youth_id: '', product_womens_id: '', sock: true },
  { slot: 'jacket', label: 'Jacket', color: '', optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'pants', label: 'Pants', color: '', optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'backpack', label: 'Backpack', color: '', optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '', no_size: true },
  { slot: 'keeper_jersey', label: 'Keeper Jersey', color: '', gk_only: true, optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'keeper_shorts', label: 'Keeper Shorts', color: '', gk_only: true, optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' },
  { slot: 'keeper_socks', label: 'Keeper Socks', color: '', gk_only: true, optional: true, qty: 1, product_id: '', product_youth_id: '', product_womens_id: '', sock: true },
];

// A session's working kit: its own kit_items wins; otherwise fall back to the
// linked template's items (older sessions created before kit_items existed).
const effectiveKit = (session, template) =>
  (session && Array.isArray(session.kit_items) && session.kit_items.length)
    ? session.kit_items
    : (template?.items || []);

// Load a customer's master item catalog row (is_catalog = true).
async function fetchCatalog(customerId) {
  if (!customerId) return null;
  const { data } = await supabase.from('roster_kit_templates')
    .select('*').eq('customer_id', customerId).eq('is_catalog', true).maybeSingle();
  return data || null;
}

// Invite a coach to a team. Goes through the coach-invite function which, given a
// team_id, provisions the coach_accounts row + roster_team_coaches assignment with
// the service role (works for both staff and coach-initiated invites) and emails
// the magic-link. Returns { coach_id } (may be null if service creds are absent).
async function inviteRosterCoach({ email, name, teamId, teamLabel, customerId, role }) {
  try {
    const res = await fetch('/.netlify/functions/coach-invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: name || email, team: teamLabel || '', team_id: teamId, customer_id: customerId, role: role || 'editor' }),
    });
    const j = await res.json().catch(() => ({}));
    return { coach_id: j.coach_id || null, ok: j.ok !== false, emailed: !!j.emailed };
  } catch (e) {
    console.error('[inviteRosterCoach]', e);
    return { coach_id: null, ok: false };
  }
}

// ─── Product picker — typeahead search of products in the system ──────────────
// Attaches a real product (SKU) to a kit item so inventory/availability resolves.
function ProductPicker({ value, sku, productName, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const safe = term.replace(/[%,()]/g, ' '); // keep the PostgREST or-filter well-formed
    const t = setTimeout(async () => {
      const { data } = await supabase.from('products')
        .select('id,sku,name,color,brand,category')
        .or('is_active.is.null,is_active.eq.true')
        .or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`)
        .limit(20);
      if (!cancelled) { setResults(data || []); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  if (value && !open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '2px 8px', fontSize: 11, maxWidth: 220, overflow: 'hidden' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#047857' }}>{sku || value}</span>
          {productName && <span style={{ color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{productName}</span>}
        </span>
        <button type="button" onClick={() => { setOpen(true); setQ(''); }} title="Change" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 11, padding: 0 }}>change</button>
        <button type="button" onClick={() => onPick(null)} title="Unlink" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 13, padding: 0 }}>×</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', minWidth: 180 }}>
      <input autoFocus={open} value={q} placeholder="search SKU or name…" onChange={e => setQ(e.target.value)}
        style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11.5, padding: '4px 7px', outline: 'none' }} />
      {q.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 3, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(15,23,42,.14)' }}>
          {searching && <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#94a3b8' }}>Searching…</div>}
          {!searching && results.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#94a3b8' }}>No products found.</div>}
          {results.map(p => (
            <button type="button" key={p.id}
              onClick={() => { onPick(p); setOpen(false); setQ(''); setResults([]); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', padding: '6px 10px' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11.5, color: '#0b1220' }}>{p.sku}</span>
              <span style={{ fontSize: 11.5, color: '#475569' }}> · {p.name}{p.color ? ` (${p.color})` : ''}</span>
              {p.brand && <span style={{ fontSize: 10, color: '#94a3b8' }}> · {p.brand}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared kit-items table editor (used by catalog + new-session) ────────────
// Add/remove rows, name them, set color, attach SKUs. Every item carries an
// Adult SKU by default; Youth and Women's are optional and added per item only
// when it actually splits that way (jerseys, shorts). Single-SKU pieces like a
// backpack stay clean with just the one product. The roster's size dropdowns and
// inventory lookup resolve a player's SKU by their category, falling back to the
// Adult product whenever a Youth/Women's variant isn't set — so an Adult-only
// item still works for every player.
function KitItemRow({ ki, idx, patchItem, removeItem }) {
  const hasYouth = !!(ki.product_youth_id || ki.sku_youth);
  const hasWomens = !!(ki.product_womens_id || ki.sku_womens);
  const [showYouth, setShowYouth] = useState(hasYouth);
  const [showWomens, setShowWomens] = useState(hasWomens);

  const pickAdult = (p) => patchItem(idx, p
    ? { product_id: p.id, sku: p.sku, product_name: p.name }
    : { product_id: '', sku: '', product_name: '' });
  const pickYouth = (p) => patchItem(idx, p
    ? { product_youth_id: p.id, sku_youth: p.sku, product_youth_name: p.name }
    : { product_youth_id: '', sku_youth: '', product_youth_name: '' });
  const pickWomens = (p) => patchItem(idx, p
    ? { product_womens_id: p.id, sku_womens: p.sku, product_womens_name: p.name }
    : { product_womens_id: '', sku_womens: '', product_womens_name: '' });

  const variant = (label, color, picker, onRemove) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 50, flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color }}>{label}</span>
      {picker}
      {onRemove && <button type="button" onClick={onRemove} title="Remove this size group"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>}
    </div>
  );
  const addBtn = (label, onClick) => (
    <button type="button" onClick={onClick}
      style={{ padding: '2px 9px', borderRadius: 999, border: '1px dashed #cbd5e1', background: '#fff', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', color: '#475569' }}>+ {label}</button>
  );

  return (
    <tr style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
      <td style={{ padding: '8px 6px' }}>
        <input value={ki.label || ''} placeholder="e.g. Jersey" onChange={e => patchItem(idx, { label: e.target.value })}
          style={{ border: 'none', fontSize: 12, fontWeight: 600, outline: 'none', minWidth: 100 }} />
      </td>
      <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{ki.slot}</td>
      <td style={{ padding: '8px 6px' }}>
        <input value={ki.color || ''} placeholder="e.g. White" onChange={e => patchItem(idx, { color: e.target.value })}
          style={{ border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11.5, padding: '3px 6px', width: 78, outline: 'none' }} />
      </td>
      <td style={{ padding: '8px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>$</span>
          <input type="number" min={0} step="0.01" value={ki.price ?? ''} placeholder="0.00"
            onChange={e => patchItem(idx, { price: e.target.value === '' ? '' : parseFloat(e.target.value) })}
            style={{ border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11.5, padding: '3px 6px', width: 62, outline: 'none' }} />
        </div>
      </td>
      <td style={{ padding: '8px 6px', minWidth: 280 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {variant('Adult', '#0b1220', <ProductPicker value={ki.product_id} sku={ki.sku} productName={ki.product_name} onPick={pickAdult} />)}
          {showYouth && variant('Youth', '#b45309', <ProductPicker value={ki.product_youth_id} sku={ki.sku_youth} productName={ki.product_youth_name} onPick={pickYouth} />, () => { pickYouth(null); setShowYouth(false); })}
          {showWomens && variant("Women's", '#9d174d', <ProductPicker value={ki.product_womens_id} sku={ki.sku_womens} productName={ki.product_womens_name} onPick={pickWomens} />, () => { pickWomens(null); setShowWomens(false); })}
          {(!showYouth || !showWomens) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 1 }}>
              {!showYouth && addBtn('Youth', () => setShowYouth(true))}
              {!showWomens && addBtn("Women's", () => setShowWomens(true))}
            </div>
          )}
        </div>
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'center' }} title="Default quantity per player — coaches can override this for individual players">
        <input type="number" min={1} max={9} value={ki.qty || 1} onChange={e => patchItem(idx, { qty: parseInt(e.target.value) || 1 })}
          style={{ width: 40, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12.5, padding: '3px 2px', outline: 'none' }} />
      </td>
      <td style={{ padding: '8px 6px' }}>
        <select value={ki.no_size ? 'no_size' : ki.sock ? 'sock' : 'standard'}
          onChange={e => patchItem(idx, e.target.value === 'no_size' ? { no_size: true, sock: false } : e.target.value === 'sock' ? { no_size: false, sock: true } : { no_size: false, sock: false })}
          style={{ border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11.5, padding: '4px 5px', outline: 'none', cursor: 'pointer', background: '#fff' }}>
          <option value="standard">Standard sizes</option>
          <option value="sock">Socks</option>
          <option value="no_size">No sizes (checkbox)</option>
        </select>
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'center' }} title="Gets a player number / name printed">
        <input type="checkbox" checked={!!ki.takes_number} onChange={e => patchItem(idx, { takes_number: e.target.checked })} />
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'center' }} title="Goalkeeper-only item">
        <input type="checkbox" checked={!!ki.gk_only} onChange={e => patchItem(idx, { gk_only: e.target.checked })} />
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
        <button type="button" onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 15 }}>×</button>
      </td>
    </tr>
  );
}

function KitItemsTableEditor({ items, setItems }) {
  const patchItem = (idx, patch) => setItems(p => p.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addItem = () => setItems(p => [...p, { slot: 'item_' + Math.random().toString(36).slice(2, 7), label: '', color: '', qty: 1, product_id: '', product_youth_id: '', product_womens_id: '' }]);
  const removeItem = (idx) => setItems(p => p.filter((_, i) => i !== idx));

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflowX: 'auto', marginBottom: 20 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 820 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {['Item', 'Slot key', 'Color', 'Price', 'Products / SKU', 'Qty/player', 'Sizing', '#?', 'GK', ''].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((ki, idx) => (
            <KitItemRow key={ki.slot} ki={ki} idx={idx} patchItem={patchItem} removeItem={removeItem} />
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 10px', borderTop: '1px solid #f1f5f9' }}>
        <button type="button" onClick={addItem} style={{ padding: '5px 12px', borderRadius: 7, border: '1px dashed #cbd5e1', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#374151' }}>+ Add item</button>
      </div>
    </div>
  );
}

// ─── Item Catalog manager (staff) ─────────────────────────────────────────────
// NSA loads the available kit pieces here and links each to a product (SKU) so
// live inventory/availability works. Coaches then add these items to their kits.
function ItemCatalogManager({ customer, onClose }) {
  const [items, setItems] = useState([]);
  const [rowId, setRowId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cat = await fetchCatalog(customer.id);
      if (cancelled) return;
      if (cat) { setRowId(cat.id); setItems(cat.items || []); }
      else { setItems(DEFAULT_KIT.map(i => ({ ...i }))); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [customer.id]);

  const save = async () => {
    setSaving(true);
    const clean = items.filter(it => (it.label || '').trim());
    try {
      if (rowId) {
        await supabase.from('roster_kit_templates').update({ items: clean }).eq('id', rowId);
      } else {
        const { data } = await supabase.from('roster_kit_templates')
          .insert({ customer_id: customer.id, name: (customer.name || 'Customer') + ' Item Catalog', is_catalog: true, items: clean })
          .select().single();
        setRowId(data?.id);
      }
      onClose && onClose(true);
    } catch (e) { console.error(e); setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 1040, margin: '0 16px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0b1220' }}>Item Catalog — {customer.name}</h2>
          <button onClick={() => onClose && onClose(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16 }}>
          Load the kit pieces this account can order. Each item takes an <b>Adult SKU</b> by default — add a <b>Youth</b> or <b>Women's</b> SKU only when the item splits that way. Link a real product so coaches see live size availability; single-SKU pieces like a backpack just need the one. Coaches pick from these when building their teams' kits.
        </div>
        {loading ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div> : (
          <KitItemsTableEditor items={items} setItems={setItems} />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={() => onClose && onClose(false)} style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 24px', border: 'none', borderRadius: 8, background: '#0b1220', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Kit items bar — add/remove items on a session from the catalog ───────────
function KitItemsBar({ session, catalog, onChange, readOnly }) {
  const items = (session.kit_items && session.kit_items.length) ? session.kit_items : [];
  const catItems = catalog?.items || [];
  const available = catItems.filter(ci => !items.some(it => it.slot === ci.slot));
  const [busy, setBusy] = useState(false);

  const persist = async (next) => {
    setBusy(true);
    onChange({ ...session, kit_items: next });
    await supabase.from('roster_order_sessions').update({ kit_items: next, updated_at: new Date().toISOString() }).eq('id', session.id);
    setBusy(false);
  };
  const addItem = (slot) => { const ci = catItems.find(c => c.slot === slot); if (ci) persist([...items, { ...ci }]); };
  const removeItem = (slot) => persist(items.filter(it => it.slot !== slot));

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Kit items {items.length ? `(${items.length})` : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {items.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>No items yet — add the gear this order needs.</span>}
        {items.map(it => {
          const hasProduct = !!(it.product_id || it.product_youth_id || it.product_womens_id);
          return (
            <span key={it.slot} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#0b1220' }}>
              {it.label}{it.color ? <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{it.color}</span> : null}
              {hasProduct ? <span title="linked to inventory" style={{ width: 6, height: 6, borderRadius: '50%', background: '#15803d' }} /> : <span title="no product linked — no availability" style={{ width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1' }} />}
              {!readOnly && <button onClick={() => removeItem(it.slot)} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {available.length > 0 ? (
            <select value="" disabled={busy} onChange={e => { if (e.target.value) addItem(e.target.value); e.target.value = ''; }}
              style={{ fontSize: 12.5, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
              <option value="">+ Add item…</option>
              {available.map(ci => <option key={ci.slot} value={ci.slot}>{ci.label}</option>)}
            </select>
          ) : catItems.length === 0 ? (
            <span style={{ fontSize: 11.5, color: '#b45309' }}>No item catalog yet — ask National Sports Apparel to load your items.</span>
          ) : (
            <span style={{ fontSize: 11.5, color: '#94a3b8' }}>All catalog items added.</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Typeahead cell — fast keyboard entry for the roster grid ─────────────────
// A plain text input (not a dropdown) backed by a <datalist> for suggestions, so
// a coach can type a value and Tab straight to the next cell — no clicking to
// open a menu. Whatever is typed must match one of `options` (case-insensitive)
// to be accepted; an unmatched value reverts to the last committed value and
// briefly flashes red. Typing nothing and tabbing away clears the cell.
let _typeaheadSeq = 0;
function TypeaheadInput({ value, options, onCommit, placeholder, width, center = true, title }) {
  const [listId] = useState(() => `ta-${++_typeaheadSeq}`);
  const [text, setText] = useState(value || '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(value || ''); }, [value]);

  const commit = () => {
    const raw = text.trim();
    if (!raw) { setInvalid(false); if (raw !== (value || '')) onCommit(''); return; }
    const match = options.find(o => o.toLowerCase() === raw.toLowerCase());
    if (match) {
      setText(match);
      setInvalid(false);
      if (match !== value) onCommit(match);
    } else {
      setText(value || '');
      setInvalid(true);
      setTimeout(() => setInvalid(false), 900);
    }
  };

  return (
    <>
      <input
        list={listId}
        value={text}
        placeholder={placeholder}
        title={title}
        className="rst-in"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="next"
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        style={{
          width, textAlign: center ? 'center' : 'left', fontSize: 13.5, padding: '5px 4px',
          border: invalid ? '1px solid #dc2626' : '1px solid #e2e8f0', borderRadius: 6,
          background: invalid ? '#fef2f2' : (text ? '#fff' : '#f8fafc'), outline: 'none',
          transition: 'border-color .15s, background .15s',
        }}
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

// ─── Roster Table Editor ──────────────────────────────────────────────────────
function TeamRosterEditor({ team, kitTemplate, readOnly }) {
  const [players, setPlayers] = useState([]);
  const [sizes, setSizes] = useState({});
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState({ first_name: '', last_name: '', jersey_number: '', is_gk: false, category: '' });
  const [addingRow, setAddingRow] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(team?.locked || false);
  const [paste, setPaste] = useState({ open: false, text: '', busy: false });

  const kitItems = useMemo(() => kitTemplate?.items || [], [kitTemplate]);
  const { getStock } = useKitInventory(kitItems);
  const hasGK = players.some(p => p.is_gk);
  const gkItems = kitItems.filter(ki => ki.gk_only);
  const mainItems = kitItems.filter(ki => !ki.gk_only);

  // Players still missing a size on a required item — feeds the "N of M
  // complete" indicator and the lock warning.
  const incomplete = useMemo(() => players
    .map(p => ({ p, missing: missingSizesFor(p, kitItems, sizes[p.id]) }))
    .filter(x => x.missing.length), [players, kitItems, sizes]);

  useEffect(() => {
    setIsLocked(team?.locked || false);
  }, [team?.locked]);

  useEffect(() => {
    if (!team?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ps } = await supabase.from('roster_players').select('*')
        .eq('team_id', team.id).order('sort_order').order('created_at');
      if (cancelled) return;
      const playerList = ps || [];
      setPlayers(playerList);
      if (playerList.length) {
        const { data: sz } = await supabase.from('roster_player_sizes').select('*')
          .in('player_id', playerList.map(p => p.id));
        if (!cancelled) {
          const smap = {};
          (sz || []).forEach(r => {
            if (!smap[r.player_id]) smap[r.player_id] = {};
            smap[r.player_id][r.kit_slot] = { size: r.size, qty: r.qty };
          });
          setSizes(smap);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [team?.id]);

  // Persist a player's size and/or qty for one kit item. Pass only the field
  // that changed; the other is read from current state so the size box and the
  // qty box can update independently.
  const saveCell = useCallback(async (playerId, kitSlot, patch) => {
    let nextCell;
    setSizes(prev => {
      const cur = (prev[playerId] || {})[kitSlot] || { size: '-', qty: null };
      nextCell = { ...cur, ...patch };
      return { ...prev, [playerId]: { ...(prev[playerId] || {}), [kitSlot]: nextCell } };
    });
    // nextCell is set synchronously by the updater above before this line runs.
    await supabase.from('roster_player_sizes').upsert(
      { player_id: playerId, kit_slot: kitSlot, size: nextCell.size, qty: nextCell.qty, updated_at: new Date().toISOString() },
      { onConflict: 'player_id,kit_slot' }
    );
  }, []);

  const updatePlayer = useCallback((id, field, val) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p));
  }, []);

  const savePlayer = useCallback(async (id, field, val) => {
    await supabase.from('roster_players').update({ [field]: val }).eq('id', id);
  }, []);

  const addPlayer = async () => {
    const { first_name, last_name, jersey_number, is_gk, category } = addRow;
    if (!first_name.trim() && !last_name.trim()) return;
    setAddingRow(true);
    const { data, error } = await supabase.from('roster_players').insert({
      team_id: team.id, first_name: first_name.trim(), last_name: last_name.trim(),
      jersey_number: jersey_number.trim(), is_gk, sort_order: players.length,
      category: category || null,
    }).select().single();
    setAddingRow(false);
    if (!error && data) {
      setPlayers(prev => [...prev, data]);
      setAddRow({ first_name: '', last_name: '', jersey_number: '', is_gk: false, category: '' });
    }
  };

  const deletePlayer = async (id) => {
    if (!window.confirm('Remove this player from the roster?')) return;
    await supabase.from('roster_players').delete().eq('id', id);
    setPlayers(prev => prev.filter(p => p.id !== id));
  };

  const toggleLock = async () => {
    const newLocked = !isLocked;
    if (newLocked && incomplete.length) {
      const detail = incomplete.slice(0, 5).map(x =>
        `• ${[x.p.first_name, x.p.last_name].filter(Boolean).join(' ') || 'Unnamed'} — ${x.missing.map(ki => ki.label).join(', ')}`).join('\n');
      const more = incomplete.length > 5 ? `\n…and ${incomplete.length - 5} more` : '';
      if (!window.confirm(`${incomplete.length} player${incomplete.length === 1 ? ' is' : 's are'} still missing sizes:\n\n${detail}${more}\n\nLock the roster anyway?`)) return;
    }
    setLockLoading(true);
    await supabase.from('roster_teams').update({ locked: newLocked }).eq('id', team.id);
    setIsLocked(newLocked);
    setLockLoading(false);
  };

  // Bulk-add players pasted from a spreadsheet (the old Google Sheet workflow).
  const importPaste = async () => {
    const rows = parsePastedRoster(paste.text);
    if (!rows.length) { window.alert('Nothing to import — paste rows copied from your spreadsheet (name, number…).'); return; }
    setPaste(p => ({ ...p, busy: true }));
    const { data, error } = await supabase.from('roster_players').insert(rows.map((r, i) => ({
      team_id: team.id, first_name: r.first_name, last_name: r.last_name,
      jersey_number: r.jersey_number, is_gk: false, category: r.category,
      sort_order: players.length + i,
    }))).select();
    if (error) {
      console.error('[importPaste]', error);
      window.alert('Import failed — ' + error.message);
      setPaste(p => ({ ...p, busy: false }));
      return;
    }
    setPlayers(prev => [...prev, ...(data || [])]);
    setPaste({ open: false, text: '', busy: false });
  };

  const editable = !readOnly && !isLocked;

  const cellInput = (playerId, field, value, opts = {}) => (
    <input value={value || ''} placeholder={opts.placeholder || ''}
      className="rst-in" inputMode={opts.numeric ? 'numeric' : undefined} enterKeyHint="next"
      onChange={e => updatePlayer(playerId, field, e.target.value)}
      onBlur={e => savePlayer(playerId, field, e.target.value)}
      style={{ width: opts.width || '100%', border: 'none', background: 'transparent',
        fontSize: 14.5, outline: 'none', textAlign: opts.center ? 'center' : 'left' }} />
  );

  // Quick per-item, per-size totals for THIS team — reuses the same {size,qty}
  // state already loaded for the grid above, so no extra query. The full
  // cross-team buy-sheet still lives in the session's separate Totals view.
  const teamTotals = useMemo(() => {
    const result = {};
    kitItems.forEach(ki => {
      const byCat = {};
      const groups = linkedGroups(ki);
      players.forEach(p => {
        if (ki.gk_only && !p.is_gk) return;
        const cell = (sizes[p.id] || {})[ki.slot];
        const sz = cell?.size;
        if (!sz || sz === '-') return;
        const cat = resolveSizeGroup(sz, p, groups);
        if (!byCat[cat]) byCat[cat] = {};
        if (!byCat[cat][sz]) byCat[cat][sz] = [];
        byCat[cat][sz].push({ player: p, qty: cell.qty ?? (ki.qty || 1) });
      });
      result[ki.slot] = byCat;
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitItems, players, sizes]);

  const sizeCell = (player, ki) => {
    const cell = (sizes[player.id] || {})[ki.slot] || { size: '-', qty: null };
    const val = cell.size || '-';
    const groups = linkedGroups(ki);
    // One combined list — Youth and Adult/Women's sizes never share text, so
    // typing a size is enough to say which group it belongs to (no separate
    // picker needed). Falls back to the full Adult scale for an item that
    // isn't linked to any SKU yet.
    const sizeList = ki.sock ? SZ_SOCKS : [
      ...(groups.includes('YM') ? SZ_YOUTH : []),
      ...(groups.includes('WM') || groups.includes('AM') || !groups.length ? SZ_ADULT : []),
    ];
    const group = resolveSizeGroup(val, player, groups);
    const productId =
      group === 'YM' && ki.product_youth_id ? ki.product_youth_id :
      group === 'WM' && ki.product_womens_id ? ki.product_womens_id :
      ki.product_id;
    const stock = productId ? getStock(productId, val) : null;
    const checked = val === 'OSFA';
    const effectiveQty = cell.qty ?? (ki.qty || 1);
    // Only show a quantity control when this item's default is already more
    // than one (shorts, socks, etc.) — a plain number box, not a stepper, so a
    // coach can type "1" to cut a specific player down from the team default.
    const showQty = (ki.qty || 1) > 1 && val !== '-';

    return (
      <td key={ki.slot} style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap',
        background: ki.gk_only ? '#f0f9ff' : 'transparent' }}>
        {editable ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {ki.no_size ? (
              <input type="checkbox" checked={checked} onChange={e => saveCell(player.id, ki.slot, { size: e.target.checked ? 'OSFA' : '-' })}
                style={{ width: 20, height: 20, cursor: 'pointer' }} />
            ) : (
              <TypeaheadInput value={val === '-' ? '' : val} options={sizeList} placeholder="size" width={72}
                onCommit={v => saveCell(player.id, ki.slot, { size: v || '-' })} />
            )}
            {showQty && (
              <input type="number" min={1} max={9} value={effectiveQty}
                title="How many of this item this player needs"
                onChange={e => saveCell(player.id, ki.slot, { qty: Math.min(9, Math.max(1, parseInt(e.target.value) || 1)) })}
                style={{ width: 34, textAlign: 'center', fontSize: 12.5, padding: '5px 2px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc', outline: 'none' }} />
            )}
            {stock && val !== '-' && productId && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                background: _dotColor(stock.avail, stock.incoming) }} title={`${stock.avail} avail${stock.incoming ? ` + ${stock.incoming} incoming` : ''}`} />
            )}
          </div>
        ) : (
          <div>
            <span style={{ fontWeight: val !== '-' ? 600 : 400, color: val === '-' ? '#94a3b8' : '#0b1220', fontSize: 13.5 }}>
              {ki.no_size ? (checked ? '✓' : '—') : val}
            </span>
            {val !== '-' && effectiveQty > 1 && (
              <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>×{effectiveQty}</span>
            )}
          </div>
        )}
      </td>
    );
  };

  if (loading) return <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>Loading roster…</div>;

  return (
    <div>
      {/* On phones, sub-16px inputs make iOS Safari zoom the whole page on focus —
          bump the grid's inputs to 16px on coarse pointers only. */}
      <style>{`@media (pointer: coarse){ .rst-in{ font-size:16px !important } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0b1220' }}>{team.name}</div>
        <span style={{ fontSize: 11, color: '#64748b' }}>{players.length} player{players.length !== 1 ? 's' : ''}</span>
        {players.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 10px',
            background: incomplete.length ? '#fffbeb' : '#dcfce7',
            border: incomplete.length ? '1px solid #fde68a' : '1px solid #bbf7d0',
            color: incomplete.length ? '#b45309' : '#15803d' }}
            title={incomplete.length ? incomplete.slice(0, 8).map(x => `${[x.p.first_name, x.p.last_name].filter(Boolean).join(' ') || 'Unnamed'}: ${x.missing.map(ki => ki.label).join(', ')}`).join('\n') : 'Every player has all required sizes'}>
            {players.length - incomplete.length} of {players.length} complete
          </span>
        )}
        {isLocked && <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>LOCKED</span>}
        {!readOnly && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {editable && (
              <button onClick={() => setPaste(p => ({ ...p, open: !p.open }))}
                style={{ padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                  border: '1px solid #e2e8f0', background: paste.open ? '#eff6ff' : '#f8fafc', color: '#374151' }}>
                📋 Paste roster
              </button>
            )}
            <button onClick={toggleLock} disabled={lockLoading}
              style={{ padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                border: isLocked ? '1px solid #15803d' : '1px solid #e2e8f0',
                background: isLocked ? '#f0fdf4' : '#f8fafc', color: isLocked ? '#15803d' : '#374151' }}>
              {lockLoading ? '…' : isLocked ? '🔓 Unlock roster' : '🔒 Lock roster'}
            </button>
          </div>
        )}
      </div>

      {paste.open && editable && (
        <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', marginBottom: 6 }}>
            Paste your roster from Google Sheets or Excel
          </div>
          <div style={{ fontSize: 11.5, color: '#475569', marginBottom: 8 }}>
            Copy the rows in your spreadsheet (name, number — category too if you have it) and paste below. One player per line; sizes get typed in the grid after.
          </div>
          <textarea value={paste.text} onChange={e => setPaste(p => ({ ...p, text: e.target.value }))}
            placeholder={'Steve\tPeterson\t10\tYM\nJordan\tSmith\t7'}
            rows={6}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, padding: 10, fontFamily: 'monospace', outline: 'none', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button onClick={importPaste} disabled={paste.busy || !parsePastedRoster(paste.text).length}
              style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              {paste.busy ? 'Importing…' : `Add ${parsePastedRoster(paste.text).length} player${parsePastedRoster(paste.text).length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => setPaste({ open: false, text: '', busy: false })}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12.5, cursor: 'pointer', color: '#475569' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#0b1220', color: '#fff' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12.5, fontWeight: 700, minWidth: 100 }}>First</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12.5, fontWeight: 700, minWidth: 100 }}>Last</th>
              <th style={{ padding: '12px 10px', textAlign: 'center', fontSize: 12.5, fontWeight: 700, minWidth: 46 }}>#</th>
              <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 12.5, fontWeight: 700, minWidth: 58 }} title="Youth / Women's / Adult">Cat</th>
              {mainItems.map(ki => (
                <th key={ki.slot} style={{ padding: '12px 10px', textAlign: 'center', fontSize: 11.5, fontWeight: 700, minWidth: 92, lineHeight: 1.3, maxWidth: 110 }}>
                  {ki.label}
                  {ki.takes_number && <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>w/ #</div>}
                </th>
              ))}
              {hasGK && gkItems.map(ki => (
                <th key={ki.slot} style={{ padding: '12px 10px', textAlign: 'center', fontSize: 11.5, fontWeight: 700, minWidth: 92, background: '#1e3a5f' }}>{ki.label}</th>
              ))}
              {editable && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {players.map((player, idx) => {
              const rowBg = player.is_loaner ? '#fefce8' : player.is_gk ? '#f0f9ff' : idx % 2 === 0 ? '#fff' : '#fafafa';
              return (
                <tr key={player.id} style={{ borderTop: '1px solid #f1f5f9', background: rowBg }}>
                  <td style={{ padding: '10px 14px' }}>
                    {editable ? cellInput(player.id, 'first_name', player.first_name, { placeholder: 'First' })
                      : <span>{player.first_name || '—'}</span>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {editable ? cellInput(player.id, 'last_name', player.last_name, { placeholder: 'Last' })
                      : <span>{player.last_name || '—'}</span>}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    {editable ? cellInput(player.id, 'jersey_number', player.jersey_number, { placeholder: '#', width: 40, center: true, numeric: true })
                      : <span style={{ fontWeight: 700 }}>{player.jersey_number || '—'}</span>}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    {editable ? (
                      <TypeaheadInput value={player.category || 'AM'} options={['YM', 'WM', 'AM']} width={46}
                        onCommit={v => { const val = v || 'AM'; updatePlayer(player.id, 'category', val); savePlayer(player.id, 'category', val); }} />
                    ) : (
                      <span style={{ fontSize: 13, color: '#64748b' }}>{player.category || 'AM'}</span>
                    )}
                  </td>
                  {mainItems.map(ki => sizeCell(player, ki))}
                  {hasGK && gkItems.map(ki => {
                    if (!player.is_gk) return (
                      <td key={ki.slot} style={{ background: '#f0f9ff', padding: '10px 8px', textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>—</td>
                    );
                    return sizeCell(player, ki);
                  })}
                  {editable && (
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <button onClick={() => deletePlayer(player.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}
                        title="Remove player">×</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {editable && (
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <td style={{ padding: '10px 14px' }}>
                  <input value={addRow.first_name} placeholder="First" className="rst-in" enterKeyHint="next" onChange={e => setAddRow(r => ({ ...r, first_name: e.target.value }))}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 14, outline: 'none' }} />
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <input value={addRow.last_name} placeholder="Last" className="rst-in" enterKeyHint="next" onChange={e => setAddRow(r => ({ ...r, last_name: e.target.value }))}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 14, outline: 'none' }} />
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <input value={addRow.jersey_number} placeholder="#" className="rst-in" inputMode="numeric" onChange={e => setAddRow(r => ({ ...r, jersey_number: e.target.value }))}
                    style={{ width: 40, textAlign: 'center', border: 'none', background: 'transparent', fontSize: 14, outline: 'none' }} />
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <TypeaheadInput value={addRow.category || 'AM'} options={['YM', 'WM', 'AM']} width={46}
                    onCommit={v => setAddRow(r => ({ ...r, category: v || 'AM' }))} />
                </td>
                {kitItems.map(ki => <td key={ki.slot}></td>)}
                <td style={{ padding: '10px 6px' }}>
                  <button onClick={addPlayer} disabled={addingRow || (!addRow.first_name.trim() && !addRow.last_name.trim())}
                    style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff',
                      fontSize: 13, cursor: 'pointer', fontWeight: 700, color: '#0b1220' }}>
                    {addingRow ? '…' : '+ Add'}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
        {players.length} player{players.length !== 1 ? 's' : ''}
        {hasGK && ` · ${players.filter(p => p.is_gk).length} GK`}
        {players.some(p => p.is_loaner) && ` · ${players.filter(p => p.is_loaner).length} loaner`}
        {!editable && isLocked && <span style={{ color: '#15803d', marginLeft: 6 }}>· Roster locked</span>}
        {!editable && !isLocked && readOnly && <span style={{ color: '#94a3b8', marginLeft: 6 }}>· Read-only</span>}
      </div>

      {/* Quick totals — every size entered so far on this team, summed live as
          the grid above is filled in. The full cross-team buy-sheet with
          availability/incoming/ETA lives in the session's separate Totals view. */}
      {players.length > 0 && kitItems.some(ki => Object.values(teamTotals[ki.slot] || {}).some(bySz => Object.keys(bySz).length)) && (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: '#f8fafc', padding: '10px 14px', fontWeight: 800, fontSize: 12.5, color: '#0b1220', borderBottom: '1px solid #e2e8f0' }}>
            📊 {team.name}'s totals so far
          </div>
          <div style={{ padding: 14 }}>
            {kitItems.map(ki => {
              const byCat = teamTotals[ki.slot] || {};
              const cats = ['YM', 'WM', 'AM'].filter(cat => Object.keys(byCat[cat] || {}).length);
              if (!cats.length) return null;
              return (
                <div key={ki.slot} style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: '#0b1220', minWidth: 120 }}>
                    {ki.label}{ki.color ? ` (${ki.color})` : ''}
                  </span>
                  {cats.flatMap(cat => Object.entries(byCat[cat]).map(([sz, pqs]) => {
                    const need = pqs.reduce((s, pq) => s + pq.qty, 0);
                    const productId = cat === 'YM' ? (ki.product_youth_id || ki.product_id)
                      : cat === 'WM' ? (ki.product_womens_id || ki.product_id) : ki.product_id;
                    const stock = productId ? getStock(productId, sz) : null;
                    const label = ki.no_size ? 'Incl.' : sz;
                    return (
                      <span key={cat + sz} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f1f5f9', borderRadius: 999, padding: '4px 11px', fontSize: 12 }}>
                        {stock && <span style={{ width: 7, height: 7, borderRadius: '50%', background: _dotColor(stock.avail, stock.incoming) }} />}
                        <b>{label}</b> × {need}
                      </span>
                    );
                  }))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Totals / Buy-Sheet ────────────────────────────────────────────────────────
function RosterTotals({ session, teams, kitTemplate }) {
  const [allPlayers, setAllPlayers] = useState([]);
  const [allSizes, setAllSizes] = useState({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  const kitItems = kitTemplate?.items || [];
  const { inv, getStock } = useKitInventory(kitItems);

  // Build a teamId→name map
  const teamMap = useMemo(() => {
    const m = {};
    (teams || []).forEach(t => { m[t.id] = t.name; });
    return m;
  }, [teams]);

  useEffect(() => {
    if (!teams?.length) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const teamIds = teams.map(t => t.id);
      const { data: ps } = await supabase.from('roster_players').select('*').in('team_id', teamIds);
      const playerList = ps || [];
      if (!playerList.length) { if (!cancelled) { setAllPlayers([]); setLoading(false); } return; }
      const { data: sz } = await supabase.from('roster_player_sizes').select('*').in('player_id', playerList.map(p => p.id));
      if (cancelled) return;
      const smap = {};
      (sz || []).forEach(r => {
        if (!smap[r.player_id]) smap[r.player_id] = {};
        smap[r.player_id][r.kit_slot] = { size: r.size, qty: r.qty };
      });
      setAllPlayers(playerList);
      setAllSizes(smap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teams, session?.id]);

  // Aggregate: for each kit slot, split by size group (YM/WM/AM) then size —
  // the group is derived from the size string itself (Youth sizes are lexically
  // distinct from Adult/Women's) plus the player's category to break the rare
  // Adult-vs-Women's tie. Each bucket holds { player, qty } — qty is the
  // player's override if set, else the item's default qty — so "units needed"
  // and "players needing this" can both be read back out (units may exceed
  // player count when qty > 1).
  const totals = useMemo(() => {
    const result = {};
    kitItems.forEach(ki => {
      const byCat = {};
      const groups = linkedGroups(ki);
      allPlayers.forEach(p => {
        if (ki.gk_only && !p.is_gk) return;
        const cell = (allSizes[p.id] || {})[ki.slot];
        const sz = cell?.size;
        if (!sz || sz === '-') return;
        const cat = resolveSizeGroup(sz, p, groups);
        if (!byCat[cat]) byCat[cat] = {};
        if (!byCat[cat][sz]) byCat[cat][sz] = [];
        byCat[cat][sz].push({ player: p, qty: cell.qty ?? (ki.qty || 1) });
      });
      result[ki.slot] = byCat;
    });
    return result;
  }, [kitItems, allPlayers, allSizes]);

  // Units per item (sum of each player's qty — their override, or the item's
  // default) and the estimated order value from any per-item prices set in the
  // catalog. Items with no price contribute 0.
  const unitsFor = (ki) => {
    const byCat = totals[ki.slot] || {};
    return ['YM', 'WM', 'AM'].reduce((sum, cat) =>
      sum + Object.values(byCat[cat] || {}).reduce((a, pqs) => a + pqs.reduce((s, pq) => s + pq.qty, 0), 0), 0);
  };
  const orderValue = useMemo(() => kitItems.reduce((sum, ki) => sum + unitsFor(ki) * (Number(ki.price) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kitItems, totals]);

  const exportCSV = () => {
    const rows = [['Item', 'Color', 'Category', 'Size', 'Players', 'Units', 'Unit $', 'Line $', 'Player names', 'Available', 'Incoming', 'ETA']];
    kitItems.forEach(ki => {
      const byCat = totals[ki.slot] || {};
      const price = Number(ki.price) || 0;
      ['YM', 'WM', 'AM'].forEach(cat => {
        const bySz = byCat[cat] || {};
        const productId = cat === 'YM' ? (ki.product_youth_id || ki.product_id) :
                          cat === 'WM' ? (ki.product_womens_id || ki.product_id) : ki.product_id;
        const sizeKeys = [...SZ_STANDARD, ...SZ_SOCKS].filter(s => bySz[s]);
        sizeKeys.forEach(sz => {
          const pqs = bySz[sz] || [];
          if (!pqs.length) return;
          const need = pqs.reduce((s, pq) => s + pq.qty, 0);
          const stock = productId ? getStock(productId, sz) : { avail: 0, incoming: 0, eta: null };
          const playerStr = pqs.map(({ player: p }) => `${p.jersey_number ? '#' + p.jersey_number + ' ' : ''}${p.first_name || ''} ${p.last_name || ''}`.trim()).join('; ');
          const sizeLabel = ki.no_size ? 'Included' : sz;
          rows.push([ki.label, ki.color || '', cat, sizeLabel, pqs.length, need, price ? price.toFixed(2) : '', price ? (need * price).toFixed(2) : '', playerStr, stock.avail, stock.incoming, stock.eta || '']);
        });
      });
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `${session?.name || 'roster'}-totals.csv`;
    a.click();
  };

  // Clean printable buy-sheet — what the warehouse pulls from. Same data as the
  // on-screen tables, stripped to Item → Size / Need / Players / On hand.
  const printBuySheet = () => {
    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const CAT_LABELS = { YM: 'Youth', WM: "Women's", AM: 'Adult' };
    let sections = '';
    kitItems.forEach(ki => {
      const byCat = totals[ki.slot] || {};
      const activeCats = ['YM', 'WM', 'AM'].filter(cat => Object.keys(byCat[cat] || {}).length);
      if (!activeCats.length) return;
      let rows = '', itemUnits = 0;
      activeCats.forEach(cat => {
        const bySz = byCat[cat] || {};
        const productId = cat === 'YM' ? (ki.product_youth_id || ki.product_id) :
                          cat === 'WM' ? (ki.product_womens_id || ki.product_id) : ki.product_id;
        const sku = productId === ki.product_youth_id ? ki.sku_youth : productId === ki.product_womens_id ? ki.sku_womens : ki.sku;
        [...SZ_STANDARD, ...SZ_SOCKS].filter(s => bySz[s]).forEach(sz => {
          const pqs = bySz[sz] || [];
          const need = pqs.reduce((s, pq) => s + pq.qty, 0);
          itemUnits += need;
          const stock = productId ? getStock(productId, sz) : null;
          const playerStr = pqs.map(({ player: p, qty }) =>
            `${p.jersey_number ? '#' + p.jersey_number + ' ' : ''}${[p.first_name, p.last_name].filter(Boolean).join(' ')}${qty > 1 ? ` (×${qty})` : ''}`.trim()).join(', ');
          rows += `<tr>
            <td>${escH(activeCats.length > 1 ? CAT_LABELS[cat] + ' ' : '')}${escH(ki.no_size ? 'Included' : sz)}</td>
            <td class="num">${need}</td>
            <td class="players">${escH(playerStr)}</td>
            <td class="num">${stock ? stock.avail : '—'}${stock && stock.incoming ? ` <span class="inc">(+${stock.incoming}${stock.eta ? ' ' + escH(stock.eta) : ''})</span>` : ''}</td>
            <td class="chk"></td>
          </tr>`;
        });
      });
      sections += `
        <div class="item">
          <div class="item-head">
            <span class="item-name">${escH(ki.label)}${ki.color ? ` — ${escH(ki.color)}` : ''}</span>
            ${sku ? `<span class="sku">${escH(sku)}</span>` : ''}
            <span class="units">${itemUnits} units</span>
          </div>
          <table>
            <thead><tr><th>Size</th><th class="num">Need</th><th>Players</th><th class="num">On hand</th><th class="chk">Pulled</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escH(session?.name || 'Roster')} — Buy-Sheet</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;margin:28px;font-size:12px}
        h1{font-size:18px;margin:0}
        .meta{color:#555;font-size:11px;margin:4px 0 20px}
        .item{margin-bottom:18px;break-inside:avoid}
        .item-head{display:flex;align-items:baseline;gap:10px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}
        .item-name{font-weight:800;font-size:13.5px}
        .sku{font-family:monospace;color:#555}
        .units{margin-left:auto;font-weight:700}
        table{width:100%;border-collapse:collapse}
        th{font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#555;text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid #ccc}
        td{padding:5px 8px 5px 0;border-bottom:1px solid #eee;vertical-align:top}
        .num{text-align:right;white-space:nowrap;font-weight:700}
        th.num{font-weight:700}
        .players{color:#444;font-size:11px}
        .inc{color:#888;font-weight:400;font-size:10px}
        .chk{width:44px}
        td.chk::after{content:'';display:inline-block;width:14px;height:14px;border:1.5px solid #999;border-radius:3px}
        @media print{body{margin:10mm}}
      </style></head><body>
      <h1>Buy-Sheet — ${escH(session?.name || '')}</h1>
      <div class="meta">${session?.season ? escH(session.season) + ' · ' : ''}${(teams || []).length} team${(teams || []).length !== 1 ? 's' : ''} · ${totalPlayers} players · ${lockedTeams} of ${(teams || []).length} locked · Printed ${new Date().toLocaleDateString()}</div>
      ${sections || '<p>No sizes entered yet.</p>'}
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
  };

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Building totals…</div>;

  const totalPlayers = allPlayers.length;
  const lockedTeams = (teams || []).filter(t => t.locked).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 17, color: '#0b1220' }}>Totals — {session?.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {(teams || []).length} team{(teams || []).length !== 1 ? 's' : ''} · {totalPlayers} players
            · {lockedTeams} of {(teams || []).length} locked
            {orderValue > 0 && <span> · <strong style={{ color: '#0b1220' }}>Est. value ${orderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>}
          </div>
        </div>
        <button onClick={printBuySheet}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#0b1220' }}>
          🖨️ Print buy-sheet
        </button>
        <button onClick={exportCSV}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#0b1220' }}>
          ↓ Download CSV
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, fontSize: 11, flexWrap: 'wrap' }}>
        {[['#15803d','Can fill'],['#b45309','Short now / incoming'],['#dc2626','Short — must reorder']].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#64748b' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>

      {/* Per-item sections */}
      {kitItems.map(ki => {
        const byCat = totals[ki.slot] || {};
        const CAT_LABELS = { YM: 'Youth (YM)', WM: "Women's (WM)", AM: 'Adult (AM)' };
        const getProductId = (cat) =>
          cat === 'YM' ? (ki.product_youth_id || ki.product_id) :
          cat === 'WM' ? (ki.product_womens_id || ki.product_id) :
          ki.product_id;
        const activeCats = ['YM', 'WM', 'AM'].filter(cat => Object.keys(byCat[cat] || {}).length > 0);
        if (!activeCats.length) return null;
        const totalUnits = activeCats.reduce((sum, cat) => {
          const bySz = byCat[cat] || {};
          return sum + Object.values(bySz).reduce((a, pqs) => a + pqs.reduce((s, pq) => s + pq.qty, 0), 0);
        }, 0);

        return (
          <div key={ki.slot} style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {/* Item header */}
            <div style={{ background: '#0b1220', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{ki.label}</div>
              {ki.color && <span style={{ fontSize: 10, opacity: 0.75, background: 'rgba(255,255,255,.12)', borderRadius: 4, padding: '2px 7px' }}>{ki.color}</span>}
              {ki.takes_number && <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>w/ number</span>}
              {ki.qty > 1 && <span style={{ fontSize: 10, opacity: 0.7 }}>×{ki.qty} per player</span>}
              {Number(ki.price) > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>${Number(ki.price).toFixed(2)} ea</span>}
              <div style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13 }}>
                {totalUnits} units{Number(ki.price) > 0 ? ` · $${(totalUnits * Number(ki.price)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ' total'}
              </div>
            </div>

            {activeCats.map(cat => {
              const bySz = byCat[cat] || {};
              const productId = getProductId(cat);
              const sizeKeys = [...SZ_STANDARD, ...SZ_SOCKS].filter(s => bySz[s]);
              return (
                <React.Fragment key={cat}>
                  {activeCats.length > 1 && (
                    <div style={{ background: '#f1f5f9', padding: '5px 14px', fontSize: 11, fontWeight: 700, color: '#374151', borderTop: '1px solid #e2e8f0' }}>
                      {CAT_LABELS[cat]}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '6px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Size</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Need</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Players</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 100 }}>Available</th>
                        <th style={{ padding: '6px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 120 }}>Incoming</th>
                        <th style={{ padding: '6px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sizeKeys.map((sz, szIdx) => {
                        const pqs = bySz[sz] || [];
                        const need = pqs.reduce((s, pq) => s + pq.qty, 0);
                        const sizeLabel = ki.no_size ? 'Included' : sz;
                        const stock = productId ? getStock(productId, sz) : { avail: 0, incoming: 0, eta: null };
                        const { avail, incoming, eta } = stock;
                        const statusColor = !productId ? '#94a3b8' :
                          avail >= need ? '#15803d' :
                          (avail + incoming) >= need ? '#b45309' : '#dc2626';
                        const statusLabel = !productId ? '—' :
                          avail >= need ? '✅ Can fill' :
                          (avail + incoming) >= need ? `🟡 Short ${need - avail} now` :
                          `🔴 Short ${need - avail - incoming}`;
                        const expandKey = ki.slot + '|' + cat + '|' + sz;
                        const isExpanded = expanded[expandKey];

                        return (
                          <React.Fragment key={sz}>
                            <tr style={{ borderTop: szIdx > 0 ? '1px solid #f1f5f9' : 'none', background: szIdx % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ padding: '7px 14px', fontWeight: 800, fontSize: 13, color: '#0b1220' }}>{sizeLabel}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{need}</td>
                              <td style={{ padding: '7px 10px' }}>
                                <button onClick={() => setExpanded(e => ({ ...e, [expandKey]: !isExpanded }))}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11.5, color: '#3b82f6', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s', fontSize: 9 }}>▶</span>
                                  {pqs.slice(0, 3).map(({ player: p, qty }) => {
                                    const num = p.jersey_number ? `#${p.jersey_number} ` : '';
                                    const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
                                    return num + name + (qty > 1 ? ` (×${qty})` : '');
                                  }).join(', ')}{pqs.length > 3 ? ` + ${pqs.length - 3} more` : ''}
                                </button>
                              </td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: avail >= need ? '#15803d' : avail > 0 ? '#b45309' : '#94a3b8', fontSize: 13 }}>
                                {productId ? avail.toLocaleString() : '—'}
                              </td>
                              <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12, color: incoming > 0 ? '#1e40af' : '#94a3b8' }}>
                                {productId ? (incoming > 0 ? `${incoming.toLocaleString()}${eta ? ` · ${eta}` : ''}` : '—') : '—'}
                              </td>
                              <td style={{ padding: '7px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>
                                {statusLabel}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr style={{ background: '#f0f9ff', borderTop: '1px solid #e0f2fe' }}>
                                <td colSpan={6} style={{ padding: '8px 20px 10px' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    {pqs.length} player{pqs.length !== 1 ? 's' : ''} needing {sizeLabel} {ki.label} ({need} unit{need !== 1 ? 's' : ''})
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                                    {pqs.map(({ player: p, qty }) => (
                                      <span key={p.id} style={{ fontSize: 12, color: '#0b1220' }}>
                                        {p.jersey_number ? <b>#{p.jersey_number}</b> : null}
                                        {p.jersey_number ? ' ' : ''}{[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                                        {qty > 1 && <b style={{ color: '#b45309' }}> ×{qty}</b>}
                                        <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>({teamMap[p.team_id] || 'Unknown team'})</span>
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </React.Fragment>
              );
            })}
            <div style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc', padding: '6px 14px', textAlign: 'right', fontWeight: 800, fontSize: 12, color: '#64748b' }}>
              Total: {totalUnits} units
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Staff: Session Detail ────────────────────────────────────────────────────
function SessionDetail({ session, customer, onBack, onNewEst }) {
  const [sess, setSess] = useState(session); // local copy so kit_items edits re-render
  const [teams, setTeams] = useState([]);
  const [kitTemplate, setKitTemplate] = useState(null); // the customer's item catalog
  const [loading, setLoading] = useState(true);
  const [buildingEst, setBuildingEst] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [view, setView] = useState('teams'); // teams | totals
  const [openTeam, setOpenTeam] = useState(null);
  const [inviteForm, setInviteForm] = useState({}); // { teamId: {email, name, sending} }
  const [coachAccounts, setCoachAccounts] = useState({});
  const kit = useMemo(() => ({ items: effectiveKit(sess, kitTemplate) }), [sess, kitTemplate]);

  useEffect(() => {
    if (!session?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: ts }, cat] = await Promise.all([
        supabase.from('roster_teams').select('*').eq('session_id', session.id).order('sort_order').order('created_at'),
        fetchCatalog(customer.id),
      ]);
      if (cancelled) return;
      const teamList = ts || [];
      setTeams(teamList);
      setKitTemplate(cat);
      // Load coach assignments
      if (teamList.length) {
        const { data: tc } = await supabase.from('roster_team_coaches')
          .select('team_id, coach_id, role, coach_accounts(email, name)')
          .in('team_id', teamList.map(t => t.id));
        if (!cancelled) {
          const cmap = {};
          (tc || []).forEach(r => {
            if (!cmap[r.team_id]) cmap[r.team_id] = [];
            cmap[r.team_id].push({ ...r.coach_accounts, role: r.role, id: r.coach_id });
          });
          setCoachAccounts(cmap);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.id]);

  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    setAddingTeam(true);
    const { data, error } = await supabase.from('roster_teams').insert({
      session_id: session.id, name: newTeamName.trim(), sort_order: teams.length,
    }).select().single();
    setAddingTeam(false);
    if (!error && data) { setTeams(prev => [...prev, data]); setNewTeamName(''); }
  };

  const deleteTeam = async (id) => {
    if (!window.confirm('Delete this team and all its roster data?')) return;
    await supabase.from('roster_teams').delete().eq('id', id);
    setTeams(prev => prev.filter(t => t.id !== id));
    if (openTeam?.id === id) setOpenTeam(null);
  };

  const changeStatus = async (status) => {
    // Reopening a submitted order means the coach has work to do — collect an
    // optional note and let the reopen function email the session's coaches.
    const wasSubmitted = ['submitted', 'processing'].includes(sess.status);
    let note = null;
    if (status === 'open' && wasSubmitted) {
      note = window.prompt('Send the coaches a note about what needs fixing (optional):', '');
      if (note === null) return; // cancelled — leave status alone
    }
    setSess(s => ({ ...s, status }));
    await supabase.from('roster_order_sessions').update({ status }).eq('id', session.id);
    if (status === 'open' && wasSubmitted) {
      fetch('/.netlify/functions/roster-order-reopen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, customer_id: customer.id, note: (note || '').trim() }),
      }).catch(e => console.error('[changeStatus] reopen notify:', e));
    }
  };

  // Build a draft estimate from this session's rosters. Each kit item becomes one
  // line per category-resolved product (Youth/Women's/Adult SKU), with sizes{}
  // aggregated from the players and — for numbered items — Names + Numbers
  // decorations pre-filled per size. Hands the seeded items to the app's newE()
  // which opens the estimate editor; the rep reviews/prices from there.
  const buildEstimate = async () => {
    if (!onNewEst) return;
    setBuildingEst(true);
    try {
      const kitItems = kit.items || [];
      const teamIds = teams.map(t => t.id);
      if (!teamIds.length) { window.alert('Add a team with players first.'); setBuildingEst(false); return; }
      const { data: players } = await supabase.from('roster_players').select('*').in('team_id', teamIds);
      const playerList = players || [];
      const { data: sizeRows } = playerList.length
        ? await supabase.from('roster_player_sizes').select('*').in('player_id', playerList.map(p => p.id))
        : { data: [] };
      const sizeMap = {};
      (sizeRows || []).forEach(r => { (sizeMap[r.player_id] = sizeMap[r.player_id] || {})[r.kit_slot] = { size: r.size, qty: r.qty }; });

      // Fetch the real product records for every linked SKU (pricing/sizes).
      const pidSet = new Set();
      kitItems.forEach(ki => [ki.product_id, ki.product_youth_id, ki.product_womens_id].forEach(id => { if (id) pidSet.add(id); }));
      let prodById = {};
      if (pidSet.size) {
        const { data: prods } = await supabase.from('products').select('*').in('id', [...pidSet]);
        (prods || []).forEach(p => { prodById[p.id] = p; });
      }

      const seedItems = [];
      kitItems.forEach(ki => {
        const groups = linkedGroups(ki);
        const resolvePid = (cat) => cat === 'YM' ? (ki.product_youth_id || ki.product_id)
          : cat === 'WM' ? (ki.product_womens_id || ki.product_id) : ki.product_id;
        const skuFor = (pid) => pid === ki.product_youth_id ? ki.sku_youth
          : pid === ki.product_womens_id ? ki.sku_womens : ki.sku;
        const byProduct = {}; // pid|slot -> { pid, sizes, names, numbers }
        playerList.forEach(p => {
          if (ki.gk_only && !p.is_gk) return;
          const cell = (sizeMap[p.id] || {})[ki.slot];
          const sz = cell?.size;
          if (!sz || sz === '-') return;
          const cat = resolveSizeGroup(sz, p, groups);
          const pid = resolvePid(cat) || '';
          const key = pid || ('__' + ki.slot);
          const bp = byProduct[key] || (byProduct[key] = { pid, sizes: {}, names: {}, numbers: {} });
          bp.sizes[sz] = (bp.sizes[sz] || 0) + (cell.qty ?? (ki.qty || 1));
          if (ki.takes_number) {
            const nm = `${p.first_name || ''} ${p.last_name || ''}`.trim();
            (bp.names[sz] = bp.names[sz] || []).push(nm);
            (bp.numbers[sz] = bp.numbers[sz] || []).push(p.jersey_number != null ? String(p.jersey_number) : '');
          }
        });
        Object.values(byProduct).forEach(bp => {
          if (!Object.keys(bp.sizes).length) return;
          const prod = bp.pid ? prodById[bp.pid] : null;
          const unitSell = Number(ki.price) || Number(prod?.retail_price) || 0;
          const decorations = [];
          if (ki.takes_number) {
            decorations.push({ kind: 'names', position: 'Back Center', name_method: 'heat_press', sell_override: null, sell_each: 6, cost_each: 3, names: bp.names });
            decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '6"', two_color: false, sell_override: null, custom_font_art_id: null, roster: bp.numbers });
          }
          seedItems.push({
            product_id: bp.pid || '',
            sku: prod?.sku || skuFor(bp.pid) || '',
            name: ki.label + (ki.color ? ` (${ki.color})` : ''),
            brand: prod?.brand || null,
            vendor_id: prod?.vendor_id || null,
            pricing_group: prod?.pricing_group || null,
            color: ki.color || prod?.color || '',
            nsa_cost: prod?.nsa_cost ?? null,
            retail_price: prod?.retail_price ?? null,
            unit_sell: unitSell,
            available_sizes: Array.isArray(prod?.available_sizes) ? [...prod.available_sizes] : Object.keys(bp.sizes),
            _colors: null,
            sizes: bp.sizes,
            decorations,
            _is_clearance: prod?.is_clearance || false,
          });
        });
      });

      if (!seedItems.length) { window.alert('No player sizes entered yet — nothing to put on an estimate.'); setBuildingEst(false); return; }
      // newE returns the freshly-created draft estimate (and navigates to the
      // estimate editor, unmounting this view) — stamp its id on the session
      // for traceability before we're gone. No local state updates after this.
      const est = onNewEst(customer, null, seedItems);
      if (est?.id) {
        await supabase.from('roster_order_sessions').update({ estimate_id: est.id }).eq('id', session.id);
      }
      return;
    } catch (e) {
      console.error('[buildEstimate]', e);
      window.alert('Could not build the estimate — ' + (e.message || 'unknown error'));
    }
    setBuildingEst(false);
  };

  const inviteCoach = async (teamId) => {
    const f = inviteForm[teamId] || {};
    const email = (f.email || '').trim();
    const name = (f.name || '').trim();
    if (!email) return;
    setInviteForm(prev => ({ ...prev, [teamId]: { ...prev[teamId], sending: true } }));
    try {
      const team = teams.find(t => t.id === teamId);
      const { coach_id } = await inviteRosterCoach({
        email, name, teamId, customerId: customer.id,
        teamLabel: `${team?.name || ''} — ${session.name}`,
      });
      setCoachAccounts(prev => ({
        ...prev, [teamId]: [...(prev[teamId] || []).filter(c => c.email !== email), { email, name, role: 'editor', id: coach_id }],
      }));
      setInviteForm(prev => ({ ...prev, [teamId]: { email: '', name: '', sending: false } }));
    } catch (e) {
      console.error(e);
      setInviteForm(prev => ({ ...prev, [teamId]: { ...prev[teamId], sending: false } }));
    }
  };

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Loading session…</div>;

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontWeight: 700, fontSize: 13, padding: 0 }}>← Back</button>
        <div>
          <div style={{ fontWeight: 900, fontSize: 17, color: '#0b1220' }}>{session.name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {session.season && <span>{session.season} · </span>}
            {teams.length} team{teams.length !== 1 ? 's' : ''}
            {session.deadline && <span> · Deadline: {session.deadline}</span>}
            {sess.estimate_id && (
              <span style={{ marginLeft: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 999, padding: '1px 9px', fontSize: 11, fontWeight: 700 }}
                title="Draft estimate built from this roster">→ {sess.estimate_id}</span>
            )}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={sess.status || 'open'} onChange={e => changeStatus(e.target.value)}
            title="Order status"
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: STATUS_COLORS[sess.status] || '#374151', background: '#fff' }}>
            {['open', 'submitted', 'processing', 'fulfilled'].map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
          <button onClick={() => setView('teams')}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              background: view === 'teams' ? '#0b1220' : '#fff', color: view === 'teams' ? '#fff' : '#374151' }}>
            Teams
          </button>
          <button onClick={() => setView('totals')}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              background: view === 'totals' ? '#0b1220' : '#fff', color: view === 'totals' ? '#fff' : '#374151' }}>
            Totals / Buy-Sheet
          </button>
          {onNewEst && (
            <button onClick={buildEstimate} disabled={buildingEst} title="Build a draft estimate from these rosters"
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: '#2563eb', color: '#fff' }}>
              {buildingEst ? 'Building…' : '📄 Create estimate'}
            </button>
          )}
        </div>
      </div>

      {view === 'totals' && (
        <RosterTotals session={sess} teams={teams} kitTemplate={kit} />
      )}

      {view === 'teams' && (
        <>
          {/* Kit items for this session (add/remove from the customer catalog) */}
          <KitItemsBar session={sess} catalog={kitTemplate} onChange={setSess} />
          {/* Teams list */}
          {teams.map(team => (
            <div key={team.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => setOpenTeam(openTeam?.id === team.id ? null : team)}>
                <span style={{ transform: openTeam?.id === team.id ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s', fontSize: 10, color: '#64748b' }}>▶</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{team.name}</span>
                {team.locked && <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>LOCKED</span>}
                {(coachAccounts[team.id] || []).length > 0 && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {(coachAccounts[team.id] || []).map(c => c.name || c.email).join(', ')}
                  </span>
                )}
                <button onClick={e => { e.stopPropagation(); deleteTeam(team.id); }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 15, padding: '0 4px' }}>×</button>
              </div>
              {openTeam?.id === team.id && (
                <div style={{ padding: 16, borderTop: '1px solid #f1f5f9' }}>
                  <TeamRosterEditor team={team} kitTemplate={kit} readOnly={false} />
                  {/* Invite coach */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Invite coach to this team</div>
                    {(coachAccounts[team.id] || []).map(c => (
                      <div key={c.id || c.email} style={{ fontSize: 12, color: '#0b1220', marginBottom: 4 }}>
                        👤 {c.name || c.email} <span style={{ color: '#94a3b8' }}>({c.email})</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <input placeholder="Coach email" value={(inviteForm[team.id] || {}).email || ''}
                        onChange={e => setInviteForm(prev => ({ ...prev, [team.id]: { ...(prev[team.id] || {}), email: e.target.value } }))}
                        style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 200 }} />
                      <input placeholder="Coach name" value={(inviteForm[team.id] || {}).name || ''}
                        onChange={e => setInviteForm(prev => ({ ...prev, [team.id]: { ...(prev[team.id] || {}), name: e.target.value } }))}
                        style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 160 }} />
                      <button onClick={() => inviteCoach(team.id)} disabled={(inviteForm[team.id] || {}).sending || !(inviteForm[team.id] || {}).email}
                        style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        {(inviteForm[team.id] || {}).sending ? 'Sending…' : 'Invite & email'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add team */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={newTeamName} placeholder="Add team name (e.g. GU9 Premier Schiefer R)"
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTeam()}
              style={{ flex: 1, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
            <button onClick={addTeam} disabled={addingTeam || !newTeamName.trim()}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {addingTeam ? '…' : '+ Team'}
            </button>
          </div>
          {!kitTemplate && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12.5, color: '#92400e' }}>
              ⚠️ No kit template configured for this session — coaches can add players but size columns won't appear until a kit template is assigned.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Staff: create session form ───────────────────────────────────────────────
function CreateSessionModal({ customer, onCreated, onClose }) {
  const [form, setForm] = useState({ name: '', season: new Date().getFullYear().toString(), deadline: '', notes: '' });
  const [kitItems, setKitItems] = useState([]);
  const [catalogId, setCatalogId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Seed the new session's kit from the customer's item catalog (or the default
  // kit if none exists yet), so it inherits the product/inventory links.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cat = await fetchCatalog(customer.id);
      if (cancelled) return;
      setCatalogId(cat?.id || null);
      setKitItems((cat?.items?.length ? cat.items : DEFAULT_KIT).map(i => ({ ...i })));
    })();
    return () => { cancelled = true; };
  }, [customer.id]);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data: sess, error: se } = await supabase.from('roster_order_sessions').insert({
        customer_id: customer.id, kit_template_id: catalogId, kit_items: kitItems,
        name: form.name.trim(), season: form.season, deadline: form.deadline || null,
        notes: form.notes, status: 'open',
      }).select().single();
      if (se) throw se;
      onCreated(sess);
    } catch (e) { console.error(e); setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 1040, margin: '0 16px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0b1220' }}>New Roster Order Session</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {[['name', 'Session name', 'e.g. Younger Girls 2026', '1 / -1'],
            ['season', 'Season', 'e.g. 2026', undefined],
            ['deadline', 'Deadline (coaches lock by)', undefined, undefined, 'date'],
            ['notes', 'Notes', undefined, undefined]].map(([field, label, placeholder, gridCol, type]) => (
            <div key={field} style={{ gridColumn: gridCol }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>{label}</label>
              <input type={type || 'text'} value={form[field]} placeholder={placeholder}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Kit items <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>— add rows and attach a SKU so coaches see live availability</span>
        </div>
        <KitItemsTableEditor items={kitItems} setItems={setKitItems} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            style={{ padding: '8px 24px', border: 'none', borderRadius: 8, background: '#0b1220', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Staff: exported component (embeds in CustDetail roster tab) ──────────────
export function RosterOrdersStaff({ customer, nf, onNewEst }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [leadInvite, setLeadInvite] = useState({ open: false, email: '', name: '', sending: false, done: '' });
  const [openSession, setOpenSession] = useState(null);
  const [coaches, setCoaches] = useState([]); // account-level coach access list
  const [catalog, setCatalog] = useState(null); // the customer's item catalog (for the on-page summary)
  const [cloningId, setCloningId] = useState(null); // session being cloned for a new season

  const loadCatalog = useCallback(async () => {
    if (!customer?.id) return;
    setCatalog(await fetchCatalog(customer.id));
  }, [customer?.id]);

  const loadCoaches = useCallback(async () => {
    if (!customer?.id) return;
    const { data } = await supabase.from('coach_customer_access')
      .select('coach_id, role, created_at, coach_accounts(email, name, status)')
      .eq('customer_id', customer.id);
    setCoaches((data || [])
      .map(r => ({ id: r.coach_id, role: r.role, created_at: r.created_at, ...(r.coach_accounts || {}) }))
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')));
  }, [customer?.id]);

  const sendLeadInvite = async () => {
    const email = (leadInvite.email || '').trim();
    if (!email) return;
    setLeadInvite(p => ({ ...p, sending: true, done: '' }));
    const { ok } = await inviteRosterCoach({ email, name: (leadInvite.name || '').trim(), customerId: customer.id, teamLabel: customer.name });
    setLeadInvite({ open: true, email: '', name: '', sending: false, done: ok ? `Invited ${email} ✓` : 'Could not invite — check email service config.' });
    if (ok) loadCoaches();
  };

  const removeCoach = async (coachId) => {
    if (!window.confirm('Remove this coach’s access to this account? Their team roster assignments stay intact.')) return;
    setCoaches(prev => prev.filter(c => c.id !== coachId));
    await supabase.from('coach_customer_access').delete().eq('coach_id', coachId).eq('customer_id', customer.id);
  };

  useEffect(() => {
    if (!customer?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('roster_order_sessions').select('*')
        .eq('customer_id', customer.id).order('created_at', { ascending: false });
      if (!cancelled) { setSessions(data || []); setLoading(false); }
      loadCoaches();
      loadCatalog();
    })();
    return () => { cancelled = true; };
  }, [customer?.id, loadCoaches, loadCatalog]);

  const onCreated = (sess) => {
    setSessions(prev => [sess, ...prev]);
    setShowCreate(false);
    setOpenSession(sess);
  };

  // Clone a session into a new season: same kit, same teams + players (names,
  // numbers, GK, category carried over), sizes intentionally blank so coaches
  // re-enter this season's sizes. Coach team assignments carry over too.
  const cloneSession = async (src) => {
    const suggested = (src.season && /\d{4}/.test(src.name))
      ? src.name.replace(/\d{4}/, y => String(Number(y) + 1))
      : src.name + ' (copy)';
    const name = window.prompt('New season/order name:', suggested);
    if (!name || !name.trim()) return;
    const nextSeason = src.season && /^\d{4}$/.test(String(src.season)) ? String(Number(src.season) + 1) : src.season;
    setCloningId(src.id);
    try {
      const { data: newSess, error: se } = await supabase.from('roster_order_sessions').insert({
        customer_id: customer.id, name: name.trim(), season: nextSeason || null,
        kit_template_id: src.kit_template_id || null, kit_items: src.kit_items || null,
        status: 'open', notes: src.notes || null,
      }).select().single();
      if (se) throw se;

      const { data: srcTeams } = await supabase.from('roster_teams').select('*').eq('session_id', src.id).order('sort_order');
      for (const t of (srcTeams || [])) {
        const { data: newTeam } = await supabase.from('roster_teams')
          .insert({ session_id: newSess.id, name: t.name, sort_order: t.sort_order }).select().single();
        if (!newTeam) continue;
        const { data: srcPlayers } = await supabase.from('roster_players').select('*').eq('team_id', t.id);
        if (srcPlayers && srcPlayers.length) {
          await supabase.from('roster_players').insert(srcPlayers.map(p => ({
            team_id: newTeam.id, first_name: p.first_name, last_name: p.last_name,
            jersey_number: p.jersey_number, is_gk: p.is_gk, is_loaner: p.is_loaner,
            category: p.category, sort_order: p.sort_order,
          })));
        }
        const { data: srcCoaches } = await supabase.from('roster_team_coaches').select('coach_id, role').eq('team_id', t.id);
        if (srcCoaches && srcCoaches.length) {
          await supabase.from('roster_team_coaches').insert(srcCoaches.map(c => ({ team_id: newTeam.id, coach_id: c.coach_id, role: c.role })));
        }
      }
      setSessions(prev => [newSess, ...prev]);
      setOpenSession(newSess);
    } catch (e) {
      console.error('[cloneSession]', e);
      window.alert('Could not clone the session — ' + (e.message || 'unknown error'));
    }
    setCloningId(null);
  };

  if (openSession) {
    return (
      <div style={{ padding: 20 }}>
        <SessionDetail session={openSession} customer={customer} onBack={() => setOpenSession(null)} onNewEst={onNewEst} />
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#0b1220' }}>Roster Orders</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Season-by-season kit ordering for {customer.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setLeadInvite(p => ({ ...p, open: !p.open }))}
            style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#0b1220', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            👤 Add coach
          </button>
          <button onClick={() => setShowCatalog(true)}
            style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#0b1220', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            🧩 Manage items
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            + New session
          </button>
        </div>
      </div>

      {!customer.coach_roster && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>👁️</span>
          <div style={{ flex: 1, fontSize: 12.5, color: '#92400e' }}>
            <strong>Coaches can't see this yet.</strong> You can build rosters here, but the section stays hidden in their portal until you turn on <strong>📋 Roster orders</strong> under the <strong>Catalog</strong> tab.
          </div>
        </div>
      )}

      {catalog && Array.isArray(catalog.items) && catalog.items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: '11px 14px', marginBottom: 16, background: '#fff' }}>
          <div style={{ fontSize: 18 }}>🧩</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0b1220' }}>
              Item catalog · {catalog.items.length} item{catalog.items.length === 1 ? '' : 's'}
              <span style={{ fontWeight: 600, color: '#64748b' }}>
                {' · '}{catalog.items.filter(it => it.product_id || it.product_youth_id || it.product_womens_id).length} linked to live inventory
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {catalog.items.slice(0, 10).map((it, i) => {
                const linked = !!(it.product_id || it.product_youth_id || it.product_womens_id);
                return (
                  <span key={i} title={linked ? 'SKU linked — live availability shows' : 'No SKU yet — link one in Manage items'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 999, padding: '1px 8px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: linked ? '#16a34a' : '#cbd5e1' }} />
                    {it.label || 'Untitled'}
                  </span>
                );
              })}
              {catalog.items.length > 10 && <span style={{ alignSelf: 'center' }}>+{catalog.items.length - 10} more</span>}
            </div>
          </div>
          <button onClick={() => setShowCatalog(true)}
            style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', color: '#0b1220', whiteSpace: 'nowrap' }}>
            Edit catalog
          </button>
        </div>
      )}

      {leadInvite.open && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0b1220', marginBottom: 8 }}>
            Give a coach self-serve access — they can create teams, build rosters &amp; invite others.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Coach email" value={leadInvite.email}
              onChange={e => setLeadInvite(p => ({ ...p, email: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: 220 }} />
            <input placeholder="Name (optional)" value={leadInvite.name}
              onChange={e => setLeadInvite(p => ({ ...p, name: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: 160 }} />
            <button onClick={sendLeadInvite} disabled={leadInvite.sending || !leadInvite.email.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {leadInvite.sending ? 'Sending…' : 'Invite & email'}
            </button>
            {leadInvite.done && <span style={{ fontSize: 12, color: leadInvite.done.includes('✓') ? '#15803d' : '#dc2626' }}>{leadInvite.done}</span>}
          </div>
        </div>
      )}

      {coaches.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Coaches with access ({coaches.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {coaches.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, padding: '5px 6px 5px 12px', fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color: '#0b1220' }}>{c.name || c.email}</span>
                {c.name && <span style={{ color: '#94a3b8' }}>{c.email}</span>}
                {c.status && c.status !== 'active' && <span style={{ fontSize: 10, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 7px', fontWeight: 700 }}>{c.status}</span>}
                <button onClick={() => removeCoach(c.id)} title="Remove access"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div style={{ fontWeight: 700, color: '#374151', marginBottom: 6 }}>No roster order sessions yet</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Create a session to replace the Google Sheet workflow — coaches fill in player sizes, you see live totals vs. inventory.</div>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Create first session
          </button>
        </div>
      ) : (
        <div>
          {sessions.map(sess => (
            <div key={sess.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 10, cursor: 'pointer' }}
              onClick={() => setOpenSession(sess)}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0b1220' }}>{sess.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {sess.season && `${sess.season} · `}
                    Created {new Date(sess.created_at).toLocaleDateString()}
                    {sess.deadline && ` · Deadline: ${sess.deadline}`}
                    {sess.estimate_id && (
                      <span style={{ marginLeft: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}
                        title="Draft estimate built from this roster">→ {sess.estimate_id}</span>
                    )}
                  </div>
                </div>
                <span style={{ background: '#f1f5f9', color: STATUS_COLORS[sess.status] || '#64748b', borderRadius: 999, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>
                  {STATUS_LABELS[sess.status] || sess.status}
                </span>
                <button onClick={e => { e.stopPropagation(); cloneSession(sess); }} disabled={cloningId === sess.id}
                  title="Clone for a new season (carries teams & players, blanks sizes)"
                  style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {cloningId === sess.id ? '…' : '⧉ New season'}
                </button>
                <span style={{ color: '#94a3b8', fontSize: 16 }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateSessionModal customer={customer} onCreated={onCreated} onClose={() => setShowCreate(false)} />}
      {showCatalog && <ItemCatalogManager customer={customer} onClose={() => { setShowCatalog(false); loadCatalog(); }} />}
    </div>
  );
}

// ─── Coach: exported component (embeds in CoachPortal) ───────────────────────
// Self-serve: a coach who belongs to this customer can create sessions + teams,
// build the kit from NSA's item catalog, fill rosters, and invite other coaches.
export function RosterOrdersCoach({ customer }) {
  const [coach, setCoach] = useState(null);        // { id, email, name }
  const [sessions, setSessions] = useState([]);    // this customer's non-draft sessions
  const [teams, setTeams] = useState([]);          // all teams across those sessions
  const [coachesByTeam, setCoachesByTeam] = useState({});
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openTeam, setOpenTeam] = useState(null);
  const [viewTotals, setViewTotals] = useState(null);
  // create / invite UI state
  const [newSession, setNewSession] = useState({ name: '', season: new Date().getFullYear().toString(), open: false, saving: false });
  const [newTeam, setNewTeam] = useState({}); // { sessionId: {name, saving} }
  const [invite, setInvite] = useState({});   // { teamId: {email, name, sending} }
  const [submittingId, setSubmittingId] = useState(null); // session id currently submitting

  const reload = useCallback(async () => {
    if (!customer?.coach_roster) { setLoading(false); return; } // roster module off for this account
    // No sign-in required — the portal link (?portal=<tag>) is the gate, same as
    // the rest of the coach portal. We still best-effort resolve the signed-in
    // coach (if any) purely to stamp created_by / show their name; a visitor with
    // the link can view and fill the roster anonymously.
    let c = null;
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: acc } = await supabase.from('coach_accounts').select('id,email,name,customer_id')
        .ilike('email', user.email).maybeSingle();
      c = acc || null;
    }
    setCoach(c);
    const [{ data: ss }, cat] = await Promise.all([
      supabase.from('roster_order_sessions').select('*')
        .eq('customer_id', customer.id).neq('status', 'draft').order('created_at', { ascending: false }),
      fetchCatalog(customer.id),
    ]);
    setCatalog(cat);
    const sessList = ss || [];
    setSessions(sessList);
    if (sessList.length) {
      const { data: ts } = await supabase.from('roster_teams').select('*')
        .in('session_id', sessList.map(s => s.id)).order('sort_order').order('created_at');
      const teamList = ts || [];
      setTeams(teamList);
      if (teamList.length) {
        const { data: tc } = await supabase.from('roster_team_coaches')
          .select('team_id, coach_id, role, coach_accounts(email, name)').in('team_id', teamList.map(t => t.id));
        const cmap = {};
        (tc || []).forEach(r => { (cmap[r.team_id] = cmap[r.team_id] || []).push({ ...r.coach_accounts, role: r.role, id: r.coach_id }); });
        setCoachesByTeam(cmap);
      } else setCoachesByTeam({});
    } else { setTeams([]); setCoachesByTeam({}); }
    setLoading(false);
  }, [customer.id, customer.coach_roster]);

  useEffect(() => { let c = false; (async () => { await reload(); })(); return () => { c = true; }; }, [reload]);

  const patchSession = (next) => setSessions(prev => prev.map(s => s.id === next.id ? next : s));

  // Submit a finished session to the rep: flip status → submitted and fire the
  // notification email (server-side). Optimistic; the function is the source of
  // truth for the email but the status also persists here.
  const submitSession = async (session) => {
    const sessTeams = teams.filter(t => t.session_id === session.id);
    const locked = sessTeams.filter(t => t.locked).length;
    const total = sessTeams.length;
    // Check for players still missing required sizes before submitting — the
    // rep builds the order from this data, so surface holes now, not in the
    // buy-sheet later.
    let missingCount = 0;
    try {
      const kitItems = effectiveKit(session, catalog);
      const { data: ps } = await supabase.from('roster_players').select('*').in('team_id', sessTeams.map(t => t.id));
      const playerList = ps || [];
      if (playerList.length) {
        const { data: sz } = await supabase.from('roster_player_sizes').select('player_id,kit_slot,size').in('player_id', playerList.map(p => p.id));
        const smap = {};
        (sz || []).forEach(r => { (smap[r.player_id] = smap[r.player_id] || {})[r.kit_slot] = { size: r.size }; });
        missingCount = playerList.filter(p => missingSizesFor(p, kitItems, smap[p.id]).length).length;
      }
    } catch (e) { console.error('[submitSession] completeness check:', e); }
    const warnings = [];
    if (total && locked < total) warnings.push(`${locked} of ${total} team rosters are locked — unlocked teams may still change.`);
    if (missingCount) warnings.push(`${missingCount} player${missingCount === 1 ? ' is' : 's are'} missing sizes on required items.`);
    const msg = warnings.length
      ? `Submit "${session.name}" to your rep?\n\n⚠ ${warnings.join('\n⚠ ')}\n\nSubmit anyway?`
      : `Submit "${session.name}" to your rep? They'll be emailed to build the order.`;
    if (!window.confirm(msg)) return;
    setSubmittingId(session.id);
    patchSession({ ...session, status: 'submitted' });
    try {
      await supabase.from('roster_order_sessions').update({ status: 'submitted' }).eq('id', session.id);
      await fetch('/.netlify/functions/roster-order-submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, customer_id: customer.id, coach_email: coach?.email || '' }),
      });
    } catch (e) { console.error('[submitSession]', e); }
    setSubmittingId(null);
  };

  const createSession = async () => {
    if (!newSession.name.trim()) return;
    setNewSession(n => ({ ...n, saving: true }));
    const cat = catalog || await fetchCatalog(customer.id);
    const { data, error } = await supabase.from('roster_order_sessions').insert({
      customer_id: customer.id, kit_template_id: cat?.id || null,
      kit_items: (cat?.items?.length ? cat.items : DEFAULT_KIT),
      name: newSession.name.trim(), season: newSession.season || null,
      status: 'open', created_by: coach?.email || null,
    }).select().single();
    if (!error && data) {
      setSessions(prev => [data, ...prev]);
      setNewSession({ name: '', season: new Date().getFullYear().toString(), open: false, saving: false });
    } else { setNewSession(n => ({ ...n, saving: false })); }
  };

  const createTeam = async (sessionId) => {
    const f = newTeam[sessionId] || {};
    if (!(f.name || '').trim()) return;
    setNewTeam(prev => ({ ...prev, [sessionId]: { ...f, saving: true } }));
    const count = teams.filter(t => t.session_id === sessionId).length;
    const { data, error } = await supabase.from('roster_teams').insert({
      session_id: sessionId, name: f.name.trim(), sort_order: count,
    }).select().single();
    if (!error && data) {
      setTeams(prev => [...prev, data]);
      setNewTeam(prev => ({ ...prev, [sessionId]: { name: '', saving: false } }));
    } else setNewTeam(prev => ({ ...prev, [sessionId]: { ...f, saving: false } }));
  };

  const inviteCoach = async (team, session) => {
    const f = invite[team.id] || {};
    const email = (f.email || '').trim();
    if (!email) return;
    setInvite(prev => ({ ...prev, [team.id]: { ...f, sending: true } }));
    const { coach_id } = await inviteRosterCoach({
      email, name: (f.name || '').trim(), teamId: team.id, customerId: customer.id,
      teamLabel: `${team.name} — ${session.name}`,
    });
    setCoachesByTeam(prev => ({
      ...prev, [team.id]: [...(prev[team.id] || []).filter(c => c.email !== email), { email, name: f.name, role: 'editor', id: coach_id }],
    }));
    setInvite(prev => ({ ...prev, [team.id]: { email: '', name: '', sending: false } }));
  };

  if (!customer?.coach_roster) return null; // gated per-customer on the Catalog tab
  if (loading) return null;

  const kitFor = (session) => ({ items: effectiveKit(session, catalog) });

  // ── Drill-in: a single team's roster editor ──
  if (openTeam) {
    const session = sessions.find(s => s.id === openTeam.session_id);
    return (
      <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800 }}>📋 {session?.name}</span>
          <span style={{ opacity: 0.7, fontSize: 13 }}>· {openTeam.name}</span>
          <button onClick={() => { setOpenTeam(null); }} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>← All teams</button>
        </div>
        <div style={{ padding: 16 }}>
          <InstructionsCard storageKey="nsa_roster_tip_grid_v2" title="Filling out your roster"
            steps={[
              'Add each player at the bottom of the table — name, number, and category (Youth/Women’s/Adult).',
              'Type a size into each item box and press Tab — suggestions pop up as you type, and Tab jumps to the next box. Any size for that item works, not just your player’s category — e.g. type an Adult size even if they’re Youth.',
              'A small number box appears next to items that come with more than one per player (like shorts) — change it if a specific player needs more or fewer.',
              'Lock the roster once it’s ready — locked rosters can’t be edited until unlocked.',
            ]} />
          <TeamRosterEditor team={openTeam} kitTemplate={kitFor(session)} readOnly={false} />
          {/* Invite another coach to this team */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Coaches on this team</div>
            {(coachesByTeam[openTeam.id] || []).map(c => (
              <div key={c.id || c.email} style={{ fontSize: 12, color: '#0b1220', marginBottom: 4 }}>👤 {c.name || c.email} <span style={{ color: '#94a3b8' }}>({c.email})</span></div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <input placeholder="Coach email" value={(invite[openTeam.id] || {}).email || ''}
                onChange={e => setInvite(prev => ({ ...prev, [openTeam.id]: { ...(prev[openTeam.id] || {}), email: e.target.value } }))}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 190 }} />
              <input placeholder="Name (optional)" value={(invite[openTeam.id] || {}).name || ''}
                onChange={e => setInvite(prev => ({ ...prev, [openTeam.id]: { ...(prev[openTeam.id] || {}), name: e.target.value } }))}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 150 }} />
              <button onClick={() => inviteCoach(openTeam, session)} disabled={(invite[openTeam.id] || {}).sending || !(invite[openTeam.id] || {}).email}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {(invite[openTeam.id] || {}).sending ? 'Sending…' : 'Invite & email'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Drill-in: a session's totals ──
  if (viewTotals) {
    const sessTeams = teams.filter(t => t.session_id === viewTotals.id);
    return (
      <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800 }}>📋 {viewTotals.name}</span>
          <button onClick={() => setViewTotals(null)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>← Back to teams</button>
        </div>
        <div style={{ padding: 16 }}>
          <RosterTotals session={viewTotals} teams={sessTeams} kitTemplate={kitFor(viewTotals)} />
        </div>
      </div>
    );
  }

  // ── Main: sessions + teams ──
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1e3a5f' }}>📋 Team Roster Orders</div>
        <button onClick={() => setNewSession(n => ({ ...n, open: !n.open }))}
          style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#0b1220' }}>
          + New order
        </button>
      </div>

      <InstructionsCard storageKey="nsa_roster_tip_sessions" title="How this works"
        steps={[
          'Create a season order (e.g. "Younger Girls 2026") — or open one that already exists below.',
          'Add each of your teams to that order.',
          'Click a team to add its players and pick sizes for each item.',
          'Once every team is filled in, submit the order to your rep from inside it.',
        ]} />

      {newSession.open && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Order name</div>
              <input autoFocus value={newSession.name} placeholder="e.g. Younger Girls 2026" onChange={e => setNewSession(n => ({ ...n, name: e.target.value }))}
                style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: 220 }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Season</div>
              <input value={newSession.season} placeholder="2026" onChange={e => setNewSession(n => ({ ...n, season: e.target.value }))}
                style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: 90 }} /></div>
            <button onClick={createSession} disabled={newSession.saving || !newSession.name.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {newSession.saving ? 'Creating…' : 'Create'}
            </button>
          </div>
          {!catalog && <div style={{ marginTop: 10, fontSize: 11.5, color: '#92400e' }}>Heads up: National Sports Apparel hasn't loaded your item list yet — you can still build rosters, and we'll attach products so availability shows.</div>}
        </div>
      )}

      {sessions.length === 0 && !newSession.open && (
        <div style={{ padding: '22px 16px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12, color: '#64748b', fontSize: 13 }}>
          No roster orders yet. Tap <b>+ New order</b> to start your teams &amp; sizes.
        </div>
      )}

      {sessions.map(session => {
        const sessTeams = teams.filter(t => t.session_id === session.id);
        return (
          <div key={session.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800 }}>📋 {session.name}</span>
                {session.status && session.status !== 'open' && (
                  <span style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 999, padding: '1px 9px', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>
                    {STATUS_LABELS[session.status] || session.status}
                  </span>
                )}
                {session.deadline && <span style={{ fontSize: 11, opacity: 0.7 }}>Deadline: {session.deadline}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => setViewTotals(session)}
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  View totals
                </button>
                {['open', 'draft'].includes(session.status) ? (
                  <button onClick={() => submitSession(session)} disabled={submittingId === session.id}
                    style={{ background: '#22c55e', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 14px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                    {submittingId === session.id ? 'Submitting…' : '✓ Submit to rep'}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#86efac' }}>✓ Submitted</span>
                )}
              </div>
            </div>
            <div style={{ padding: 12 }}>
              {/* Build the kit by adding items from the catalog */}
              <KitItemsBar session={session} catalog={catalog} onChange={patchSession} />

              {sessTeams.map(team => (
                <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                  background: '#f8fafc', border: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onClick={() => setOpenTeam(team)}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#0b1220', flex: 1 }}>{team.name}</span>
                  {(coachesByTeam[team.id] || []).length > 0 && <span style={{ fontSize: 10, color: '#94a3b8' }}>{(coachesByTeam[team.id] || []).length} coach{(coachesByTeam[team.id] || []).length !== 1 ? 'es' : ''}</span>}
                  {team.locked
                    ? <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>LOCKED ✓</span>
                    : <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>In progress</span>}
                  <span style={{ color: '#94a3b8', fontSize: 14 }}>›</span>
                </div>
              ))}

              {/* Add team */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={(newTeam[session.id] || {}).name || ''} placeholder="+ Add a team (e.g. GU9 Premier)"
                  onChange={e => setNewTeam(prev => ({ ...prev, [session.id]: { ...(prev[session.id] || {}), name: e.target.value } }))}
                  onKeyDown={e => e.key === 'Enter' && createTeam(session.id)}
                  style={{ flex: 1, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
                <button onClick={() => createTeam(session.id)} disabled={(newTeam[session.id] || {}).saving || !((newTeam[session.id] || {}).name || '').trim()}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {(newTeam[session.id] || {}).saving ? '…' : '+ Team'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
