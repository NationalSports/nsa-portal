import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import { orderProgress, sortLinesForBag, lineOnOrder, lineSatisfied, shortSummary, playerHeader, batchItemTotals } from './bagLogic';
import { buildBagLabelHtml } from './bagLabel';

// Bagging Station — one-order-at-a-time webstore bagging on a tablet
// (BAGGING_STATION_PLAN.md). Routed at /bagging-station by src/index.js, same
// wiring as /floor-station, and the same two auth modes:
//   * staff mode — signed-in staff (useStaffSession), Bearer JWT;
//   * station mode — unattended tablet opened with ?token=<PROD_SCAN_TOKEN>,
//     forwarded as x-machine-token (validated server-side per call).
// ALL data flows through netlify/functions/bagging-api.js (service role); the
// race-sensitive writes are DB RPCs. Progress refreshes by polling — the
// station-token mode has no Supabase session for realtime, and a 15s poll is
// plenty for a bagging floor.
//
// Flow: pick a batch (native deliver-to-club / OMG deliver-to-school /
// backorders) → Next order claims + shows it → tap each line into the bag
// ("Can't find it" shorts a line) → last tap completes: the 4×6 bag label
// prints automatically and the next order loads. A ?scan=WO-<order id> deep
// link (the label QR) reopens that order for re-checks or found shorts.

const stationTokenFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('token') || null; }
  catch { return null; }
};
const scanFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('scan') || null; }
  catch { return null; }
};

async function callBagApi(body, stationToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (stationToken) {
    headers['x-machine-token'] = stationToken;
  } else {
    const { data } = await supabase.auth.getSession();
    const jwt = data && data.session && data.session.access_token;
    headers.Authorization = `Bearer ${jwt || ''}`;
  }
  const res = await fetch('/.netlify/functions/bagging-api', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

// Human wording for the RPC guard codes (server raises NSA_BAG_*).
const friendlyErr = (msg) => {
  const s = String(msg || '');
  if (s.includes('NSA_BAG_CLAIMED')) return 'Another packer has this order open.';
  if (s.includes('NSA_BAG_NOT_CLAIMED')) return 'This order isn’t claimed by this station anymore — reopen it.';
  if (s.includes('NSA_BAG_INCOMPLETE')) return 'Some items aren’t bagged or shorted yet.';
  if (s.includes('NSA_BAG_NO_OPEN_SHORT')) return 'That line has no open short.';
  return s || 'Something went wrong';
};

// Print an HTML document (same window.open flow as Webstores' printHtml, local
// on purpose — that helper is file-private in the 13k-line Webstores.js).
function printHtml(html) {
  const w = window.open('', '_blank', 'width=460,height=680');
  if (!w) return false;
  w.document.write(html + '<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>');
  w.document.close();
  return true;
}

// ── Kiosk skin — same Connect navy family as Floor Station ──
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const S = {
  page: { fontFamily: FONT, background: '#0f172a', color: '#f1f5f9', minHeight: '100vh', padding: 16 },
  cap: { color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '18px 20px', cursor: 'pointer', textAlign: 'left', width: '100%', color: '#f1f5f9' },
  bigBtn: (bg, disabled) => ({
    width: '100%', minHeight: 84, padding: '18px 16px', fontSize: 26, fontWeight: 800,
    background: disabled ? '#334155' : bg, color: '#fff', border: 'none', borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer', textTransform: 'uppercase', letterSpacing: 1,
  }),
  backBtn: { background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
};

const BS_CSS = `
.bs-row { transition: background 0.1s; }
.bs-row:active { background: #24324a; }
`;

function ProgressBar({ bagged, total }) {
  const pct = total ? Math.round((bagged / total) * 100) : 0;
  return (
    <div style={{ margin: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
        <span>{bagged} of {total} bagged</span><span>{pct}%</span>
      </div>
      <div style={{ height: 10, background: '#1e293b', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: '#22c55e' }} />
      </div>
    </div>
  );
}

const KIND_BADGE = {
  so: { text: 'CLUB BATCH', bg: '#1e3a5f', color: '#60a5fa' },
  store: { text: 'OMG SCHOOL', bg: '#3b2f14', color: '#fbbf24' },
  backorders: { text: 'BACKORDERS', bg: '#3f1d2e', color: '#f472b6' },
};

function GroupPicker({ groups, onPick, onRefresh, busy }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={S.cap}>Ready to bag</span>
        <button type="button" style={S.backBtn} onClick={onRefresh} disabled={busy}>Refresh</button>
      </div>
      {groups.length === 0 && (
        <div style={{ marginTop: 40, textAlign: 'center', color: '#334155', fontSize: 22, fontWeight: 700 }}>
          Nothing waiting to be bagged
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map((g) => {
          const badge = KIND_BADGE[g.kind] || KIND_BADGE.so;
          return (
            <button key={g.kind + ':' + g.group_id} type="button" style={S.card} onClick={() => onPick(g)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{g.store_name}</span>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, padding: '3px 8px', borderRadius: 4, background: badge.bg, color: badge.color }}>{badge.text}</span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: 15, fontWeight: 700, marginTop: 6 }}>
                {g.kind === 'so' ? g.group_id + ' · ' : ''}{g.bagged} / {g.total} bagged
                {g.open_shorts > 0 ? ' · ' + g.open_shorts + ' short' : ''}
                {g.earliest_eta ? ' · ETA ' + g.earliest_eta : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One tappable line row on the order screen.
function LineRow({ item, onTap, onShort }) {
  const qty = Number(item.qty) || 0;
  const bagged = Number(item.bagged_qty) || 0;
  const onOrder = lineOnOrder(item);
  const done = lineSatisfied(item) && !onOrder;
  const shorted = (Number(item.short_qty) || 0) > 0 && ['open', 'backordered', 'refunded'].includes(item.short_status || '');
  const border = shorted ? '#d97706' : done ? '#166534' : '#334155';
  const child = item.bundle_ref && !item.is_bundle_parent;
  return (
    <div className="bs-row" style={{
      display: 'flex', alignItems: 'center', gap: 14, background: onOrder ? '#131c2e' : '#1e293b',
      border: '1px solid ' + border, borderLeft: '6px solid ' + border, borderRadius: 8,
      padding: '14px 16px', marginTop: 8, marginLeft: child ? 26 : 0,
      opacity: onOrder ? 0.55 : 1, cursor: onOrder ? 'default' : 'pointer', userSelect: 'none',
    }}
      onClick={() => { if (!onOrder) onTap(item); }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 800, border: '2px solid ' + border,
        background: done ? 'rgba(34,197,94,0.15)' : 'transparent', color: done ? '#22c55e' : '#475569',
      }}>
        {done ? '✓' : shorted ? '!' : ''}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 700, textDecoration: done && !shorted ? 'line-through' : 'none', color: done && !shorted ? '#64748b' : '#f1f5f9' }}>
          {item.name || item.sku}
        </div>
        <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>
          {item.color ? item.color + ' · ' : ''}{item.variant_label ? item.variant_label + ' · ' : ''}
          {onOrder ? 'ON ORDER — not arrived' : shorted ? `SHORT ${item.short_qty}` + (item.short_status !== 'open' ? ' (' + item.short_status + ')' : '') : ''}
        </div>
      </div>
      {item.size && (
        <span style={{ fontSize: 20, fontWeight: 800, border: '2px solid #475569', borderRadius: 6, padding: '4px 10px', flexShrink: 0 }}>{item.size}</span>
      )}
      <span style={{ fontSize: 20, fontWeight: 800, color: qty > 1 ? '#f1f5f9' : '#64748b', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
        {qty > 1 ? `${Math.min(bagged, qty)}/${qty}` : '×1'}
      </span>
      {!onOrder && !done && (
        <button type="button" style={{ ...S.backBtn, borderColor: '#7c2d12', color: '#fb923c', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onShort(item); }}>
          Can&apos;t find it
        </button>
      )}
    </div>
  );
}

// Staging table — the batch start page: exactly how many of each item × size
// should be on the table before bagging starts. Cells show REMAINING (the
// number the packer cares about mid-batch); completed cells collapse to a
// check. Live: every completed bag shrinks the counts.
function StagingTable({ orders }) {
  const { sizes, rows, totals } = batchItemTotals(orders);
  const th = { padding: '10px 12px', fontSize: 15, fontWeight: 800, color: '#94a3b8', textAlign: 'center', borderBottom: '2px solid #334155', whiteSpace: 'nowrap' };
  const td = { padding: '12px', textAlign: 'center', borderBottom: '1px solid #24324a' };
  if (!rows.length) return <div style={{ marginTop: 30, textAlign: 'center', color: '#334155', fontSize: 20, fontWeight: 700 }}>No items in this batch.</div>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '14px 0' }}>
        {[['On the table', totals.remaining, '#f1f5f9'], ['Bagged', totals.bagged, '#22c55e'], ['Short', totals.short, '#fbbf24'], ['Total', totals.total, '#94a3b8']].map(([label, n, color]) => (
          <div key={label} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '12px 22px', textAlign: 'center' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1 }}>{n}</div>
            <div style={{ ...S.cap, marginTop: 6 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 10, background: '#1e293b' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>Item</th>
            {sizes.map((sz) => <th key={sz} style={th}>{sz}</th>)}
            <th style={th}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              let rowTotal = 0; let rowLeft = 0;
              const cells = sizes.map((sz) => {
                const c = r.sizes.get(sz);
                if (!c) return <td key={sz} style={{ ...td, color: '#334155' }}>·</td>;
                const left = c.total - c.bagged - c.short;
                rowTotal += c.total; rowLeft += left;
                return (
                  <td key={sz} style={td}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: left > 0 ? '#f1f5f9' : '#22c55e' }}>
                      {left > 0 ? left : '✓'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}> /{c.total}</span>
                    {c.short > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24' }}>{c.short} short</div>}
                  </td>
                );
              });
              return (
                <tr key={r.sku + r.name + r.color}>
                  <td style={{ ...td, textAlign: 'left', minWidth: 200 }}>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{r.name}</div>
                    <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>{[r.sku, r.color].filter(Boolean).join(' · ')}</div>
                  </td>
                  {cells}
                  <td style={td}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: rowLeft > 0 ? '#f1f5f9' : '#22c55e' }}>{rowLeft > 0 ? rowLeft : '✓'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}> /{rowTotal}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Printable twin of the staging table (lay it on the physical table).
function stagingSheetHtml(storeName, orders) {
  const { sizes, rows, totals } = batchItemTotals(orders);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows.map((r) => {
    let rowTotal = 0;
    const cells = sizes.map((sz) => {
      const c = r.sizes.get(sz);
      if (!c) return '<td>·</td>';
      rowTotal += c.total;
      return `<td><b>${c.total}</b>${c.short ? `<div class="s">${c.short} short</div>` : ''}</td>`;
    }).join('');
    return `<tr><td class="l"><b>${esc(r.name)}</b><div class="m">${esc([r.sku, r.color].filter(Boolean).join(' · '))}</div></td>${cells}<td><b>${rowTotal}</b></td></tr>`;
  }).join('');
  return `<!doctype html><html><head><title>Staging — ${esc(storeName)}</title><style>
    body{font-family:Arial,sans-serif;margin:24px;color:#111}
    h1{font-size:20px;margin:0 0 2px} .sub{color:#555;font-size:13px;margin-bottom:14px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #bbb;padding:8px 10px;text-align:center;font-size:14px}
    td.l{text-align:left} .m{color:#666;font-size:11px} .s{color:#92400e;font-size:10px;font-weight:700}
    th{background:#f1f5f9}
  </style></head><body>
    <h1>Bagging staging sheet — ${esc(storeName)}</h1>
    <div class="sub">${totals.total} items across ${orders.length} orders. Lay out these stacks before starting.</div>
    <table><thead><tr><th class="l">Item</th>${sizes.map((sz) => `<th>${esc(sz)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${body}</tbody></table>
  </body></html>`;
}

// Resolve list — every open short in the group with the four outcomes:
// Found / Pulled (reopen the bag; packer still taps the item in), Backorder
// (splits onto the child backorder order), Refunded (record-only — the money
// moves through Webstores' existing refund modal first; station tokens are
// refused server-side).
function ResolvePanel({ orders, staffMode, onResolve, onBackorder }) {
  const rows = [];
  for (const o of orders) {
    const hdr = playerHeader(o, o.webstore_order_items || []);
    for (const i of (o.webstore_order_items || [])) {
      if ((Number(i.short_qty) || 0) > 0 && i.short_status === 'open') rows.push({ o, i, hdr });
    }
  }
  if (rows.length === 0) {
    return <div style={{ marginTop: 30, textAlign: 'center', color: '#22c55e', fontSize: 22, fontWeight: 800 }}>No open shorts ✓</div>;
  }
  const btn = (color) => ({ ...S.backBtn, borderColor: color, color, fontSize: 15, padding: '10px 14px' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
      {rows.map(({ o, i, hdr }) => (
        <div key={i.id} style={{ ...S.card, cursor: 'default' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            {i.short_qty}× {i.name || i.sku}{i.size ? ' · ' + i.size : ''}
            <span style={{ color: '#94a3b8', fontWeight: 700 }}> — {hdr.number ? '#' + hdr.number + ' ' : ''}{hdr.name}</span>
          </div>
          {i.short_note && <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>“{i.short_note}”</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" style={btn('#22c55e')} onClick={() => onResolve(i, 'found')}>Found it</button>
            <button type="button" style={btn('#60a5fa')} onClick={() => onResolve(i, 'pulled')}>Pulled from stock</button>
            <button type="button" style={btn('#f472b6')} onClick={() => onBackorder(i)}>Backorder → new order</button>
            {staffMode && (
              <button type="button" style={btn('#fbbf24')} onClick={() => onResolve(i, 'refunded')}>Refunded (record)</button>
            )}
          </div>
        </div>
      ))}
      {staffMode && (
        <div style={{ color: '#64748b', fontSize: 13, fontWeight: 700 }}>
          “Refunded (record)” only records the resolution — issue the actual refund from Webstores → Orders first
          (OMG orders: refund in OMG, then record here).
        </div>
      )}
    </div>
  );
}

function BaggingScreen({ stationToken, staffMode }) {
  const [view, setView] = useState('picker'); // picker | board | order | done
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(null); // picked group card
  const [progress, setProgress] = useState(null);
  const [orders, setOrders] = useState([]); // board list
  const [order, setOrder] = useState(null); // current OrderBag order (with items)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {kind:'err'|'info', text}
  const pollRef = useRef(null);

  const api = useCallback((body) => callBagApi(body, stationToken), [stationToken]);
  const oops = (r) => setMsg({ kind: 'err', text: friendlyErr(r.error) });

  const loadGroups = useCallback(async () => {
    setBusy(true);
    const r = await api({ action: 'list_groups' });
    setBusy(false);
    if (!r.ok) return oops(r);
    setGroups(r.groups || []);
    setMsg(null);
  }, [api]);

  const loadBoard = useCallback(async (g) => {
    setBusy(true);
    const r = await api({ action: 'group_detail', kind: g.kind, group_id: g.group_id });
    setBusy(false);
    if (!r.ok) return oops(r);
    setOrders(r.orders || []);
    setProgress(r.progress);
  }, [api]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Board poll — keeps two tablets' progress in sync without realtime.
  useEffect(() => {
    if ((view !== 'board' && view !== 'staging') || !group) return undefined;
    pollRef.current = setInterval(() => loadBoard(group), 15000);
    return () => clearInterval(pollRef.current);
  }, [view, group, loadBoard]);

  // ?scan=WO-… deep link (bag label QR): open that order directly.
  useEffect(() => {
    const code = scanFromUrl();
    if (!code) return;
    (async () => {
      const r = await api({ action: 'resolve_scan', code });
      if (!r.ok) { setMsg({ kind: 'err', text: friendlyErr(r.error) }); return; }
      const o = r.order;
      const act = o.bagged_at ? 'reopen_order' : 'claim_order';
      const r2 = await api({ action: act, order_id: o.id });
      if (!r2.ok) { setMsg({ kind: 'err', text: friendlyErr(r2.error) }); return; }
      setGroup(o.backorder_of
        ? { kind: 'backorders', group_id: o.store_id, store_name: (o.webstores && o.webstores.name) || '' }
        : o.so_id
          ? { kind: 'so', group_id: o.so_id, store_name: (o.webstores && o.webstores.name) || '' }
          : { kind: 'store', group_id: o.store_id, store_name: (o.webstores && o.webstores.name) || '' });
      setOrder(r2.order);
      setView('order');
    })();
  }, [api]); // runs once in practice: api only changes if the station token does

  // Picking a batch lands on the STAGING start page first: exactly how many of
  // each item × size belong on the table, before any bag is opened.
  const pickGroup = async (g) => { setGroup(g); setView('staging'); setOrder(null); await loadBoard(g); };

  const nextOrder = async () => {
    setBusy(true);
    const r = await api({ action: 'next_order', kind: group.kind, group_id: group.group_id });
    setBusy(false);
    if (!r.ok) return oops(r);
    if (!r.order) { await loadBoard(group); setView('done'); return; }
    setOrder(r.order); setView('order'); setMsg(null);
  };

  const openOrder = async (o) => {
    setBusy(true);
    const r = await api({ action: o.bagged_at ? 'reopen_order' : 'claim_order', order_id: o.id });
    setBusy(false);
    if (!r.ok) return oops(r);
    setOrder(r.order); setView('order'); setMsg(null);
  };

  const patchItem = (item) =>
    setOrder((cur) => cur && ({
      ...cur,
      webstore_order_items: cur.webstore_order_items.map((i) => (i.id === item.id ? { ...i, ...item } : i)),
    }));

  // The tap: optimistic +1 (cycling back to 0 from full), server confirms.
  const tapItem = async (item) => {
    const qty = Number(item.qty) || 0;
    const cur = Number(item.bagged_qty) || 0;
    const next = cur >= qty ? 0 : Math.min(qty, cur + 1);
    patchItem({ ...item, bagged_qty: next });
    const r = await api({ action: 'check_item', item_id: item.id, qty: next });
    if (!r.ok) { patchItem(item); return oops(r); }
    patchItem(r.item);
  };

  const shortItem = async (item) => {
    const remaining = (Number(item.qty) || 0) - (Number(item.bagged_qty) || 0);
    const qtyStr = remaining > 1
      ? window.prompt(`How many are missing? (1–${remaining})`, String(remaining)) : String(remaining);
    if (qtyStr == null) return;
    const shortQty = Math.max(1, Math.min(remaining, Number(qtyStr) || remaining));
    const note = window.prompt('Note (optional — where did you look?)', '') || null;
    const r = await api({ action: 'short_item', item_id: item.id, short_qty: shortQty, note });
    if (!r.ok) return oops(r);
    patchItem(r.item);
  };

  const resolveShort = async (item, resolution) => {
    if (resolution === 'refunded') {
      const note = window.prompt('Refund reference / note (required — refund must already be issued):', '');
      if (!note) return;
      const r = await api({ action: 'resolve_short', item_id: item.id, resolution, note });
      if (!r.ok) return oops(r);
    } else {
      const r = await api({ action: 'resolve_short', item_id: item.id, resolution });
      if (!r.ok) return oops(r);
      setMsg({ kind: 'info', text: 'Short resolved — the order is back in the queue to bag the item.' });
    }
    await loadBoard(group);
  };

  const backorderShort = async (item) => {
    const eta = window.prompt('Expected arrival date (YYYY-MM-DD, optional):', '') || null;
    const note = window.prompt('Note (optional):', '') || null;
    const r = await api({ action: 'backorder_short', item_id: item.id, eta, note });
    if (!r.ok) return oops(r);
    setMsg({ kind: 'info', text: 'Backorder order created — it will appear in the Backorders queue.' });
    await loadBoard(group);
  };

  const completeOrder = async (o) => {
    setBusy(true);
    const r = await api({ action: 'complete_order', order_id: o.id });
    setBusy(false);
    if (!r.ok) return oops(r);
    const completed = { ...o, ...r.order };
    // Bag label prints automatically on completion ("full auto").
    const total = (progress && progress.total) || null;
    const html = buildBagLabelHtml({
      order: completed, items: o.webstore_order_items,
      store: { name: (o.webstores && o.webstores.name) || (group && group.store_name) || '' },
      seqTotal: total, origin: window.location.origin,
    });
    if (printHtml(html)) api({ action: 'log_label_print', order_id: o.id });
    else setMsg({ kind: 'err', text: 'Pop-up blocked — allow pop-ups to print bag labels.' });
    const hdr = playerHeader(completed, o.webstore_order_items);
    setMsg({ kind: 'info', text: `Bag ${completed.bag_seq || ''}${total ? ' of ' + total : ''} ✓ — ${hdr.name}${hdr.number ? ' #' + hdr.number : ''}` });
    await nextOrder();
  };

  // ── Render ──
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: '#64748b', margin: 0, textTransform: 'uppercase', letterSpacing: 2 }}>
        Bagging Station{stationToken ? ' · station mode' : ''}
      </h1>
      <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>NSA Connect · Floor</span>
    </div>
  );

  const msgBox = msg && (
    <div style={{
      margin: '12px 0', padding: '14px 18px', borderRadius: 6, fontSize: 18, fontWeight: 700,
      background: msg.kind === 'err' ? 'rgba(220,38,38,0.12)' : 'rgba(34,197,94,0.12)',
      border: '1px solid ' + (msg.kind === 'err' ? '#dc2626' : '#166534'),
      borderLeft: '6px solid ' + (msg.kind === 'err' ? '#dc2626' : '#22c55e'),
      color: msg.kind === 'err' ? '#fecaca' : '#a7f3d0',
    }}>{msg.text}</div>
  );

  if (view === 'picker') {
    return (
      <div style={S.page}><style>{BS_CSS}</style><div style={{ maxWidth: 860, margin: '0 auto' }}>
        {header}{msgBox}
        <GroupPicker groups={groups} onPick={pickGroup} onRefresh={loadGroups} busy={busy} />
      </div></div>
    );
  }

  if (view === 'staging') {
    const bagged = (progress && progress.bagged) || 0;
    const total = (progress && progress.total) || 0;
    return (
      <div style={S.page}><style>{BS_CSS}</style><div style={{ maxWidth: 980, margin: '0 auto' }}>
        {header}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={S.cap}>{(KIND_BADGE[group.kind] || {}).text} · Stage the table</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{group.store_name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={S.backBtn} onClick={() => printHtml(stagingSheetHtml(group.store_name, orders))}>Print sheet</button>
            <button type="button" style={S.backBtn} onClick={() => { setView('picker'); loadGroups(); }}>← All batches</button>
          </div>
        </div>
        {msgBox}
        <StagingTable orders={orders} />
        <div style={{ marginTop: 16 }}>
          <button type="button" style={S.bigBtn('#2563eb', busy)} disabled={busy}
            onClick={() => { setView('board'); }}>
            {bagged > 0 ? `Continue bagging (${bagged} of ${total} done) →` : 'Start bagging →'}
          </button>
        </div>
      </div></div>
    );
  }

  if (view === 'board' || view === 'done') {
    const bagged = (progress && progress.bagged) || 0;
    const total = (progress && progress.total) || 0;
    const shorts = (progress && progress.open_shorts) || 0;
    const allDone = view === 'done' || (total > 0 && bagged >= total);
    return (
      <div style={S.page}><style>{BS_CSS}</style><div style={{ maxWidth: 860, margin: '0 auto' }}>
        {header}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={S.cap}>{(KIND_BADGE[group.kind] || {}).text}</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{group.store_name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={S.backBtn} onClick={() => setView('staging')}>Item counts</button>
            <button type="button" style={S.backBtn} onClick={() => { setView('picker'); loadGroups(); }}>← All batches</button>
          </div>
        </div>
        <ProgressBar bagged={bagged} total={total} />
        {shorts > 0 && (
          <button type="button" onClick={() => setView('resolve')} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', margin: '10px 0', padding: '12px 16px', borderRadius: 6, background: 'rgba(217,119,6,0.12)', border: '1px solid #d97706', color: '#fbbf24', fontSize: 16, fontWeight: 700 }}>
            {shorts} open short{shorts === 1 ? '' : 's'} — tap to resolve (found / pulled / backorder / refund). This store can’t ship until they’re cleared.
          </button>
        )}
        {msgBox}
        {allDone ? (
          <div style={{ marginTop: 30, textAlign: 'center' }}>
            <div style={{ fontSize: 44, fontWeight: 800, color: '#22c55e' }}>All {total} bags done ✓</div>
            <div style={{ color: '#94a3b8', fontSize: 18, fontWeight: 700, marginTop: 10 }}>
              {shorts > 0
                ? `${shorts} short${shorts === 1 ? '' : 's'} on the resolve list — the club shipment waits on those.`
                : 'Create the club shipment from Webstores → this store → Batches.'}
            </div>
          </div>
        ) : (
          <button type="button" style={S.bigBtn('#2563eb', busy)} disabled={busy} onClick={nextOrder}>
            {busy ? 'Working…' : 'Next order →'}
          </button>
        )}
        <div style={{ marginTop: 18 }}>
          <div style={S.cap}>Orders</div>
          {orders.map((o) => {
            const hdr = playerHeader(o, o.webstore_order_items || []);
            const p = orderProgress(o.webstore_order_items || []);
            const claimedElsewhere = o.bagging_claimed_by && !o.bagged_at;
            return (
              <button key={o.id} type="button" style={{ ...S.card, marginTop: 8, opacity: o.bagged_at ? 0.5 : 1 }} onClick={() => openOrder(o)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>
                    {hdr.number ? '#' + hdr.number + ' ' : ''}{hdr.name}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: o.bagged_at ? '#22c55e' : claimedElsewhere ? '#fbbf24' : '#94a3b8' }}>
                    {o.bagged_at ? `Bagged · Bag ${o.bag_seq || ''}` : claimedElsewhere ? 'In progress' : `${p.checked}/${p.total} items`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div></div>
    );
  }

  if (view === 'resolve') {
    return (
      <div style={S.page}><style>{BS_CSS}</style><div style={{ maxWidth: 860, margin: '0 auto' }}>
        {header}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={S.cap}>Resolve shorts</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{group.store_name}</div>
          </div>
          <button type="button" style={S.backBtn} onClick={() => { setView('board'); loadBoard(group); }}>← Back to batch</button>
        </div>
        {msgBox}
        <ResolvePanel orders={orders} staffMode={!stationToken} onResolve={resolveShort} onBackorder={backorderShort} />
      </div></div>
    );
  }

  // view === 'order'
  const items = order ? (order.webstore_order_items || []) : [];
  const p = orderProgress(items);
  const hdr = playerHeader(order, items);
  const shorts = shortSummary(items);
  return (
    <div style={S.page}><style>{BS_CSS}</style><div style={{ maxWidth: 860, margin: '0 auto' }}>
      {header}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={S.cap}>{group ? group.store_name : ''}{order && order.backorder_of ? ' · BACKORDER' : ''}</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05 }}>
            {hdr.number ? <span style={{ color: '#60a5fa' }}>#{hdr.number} </span> : null}{hdr.name}
          </div>
          {order && order.buyer_name && order.buyer_name !== hdr.name && (
            <div style={{ color: '#94a3b8', fontSize: 15, fontWeight: 700, marginTop: 4 }}>Buyer: {order.buyer_name}</div>
          )}
        </div>
        <button type="button" style={S.backBtn}
          onClick={async () => { await api({ action: 'release_order', order_id: order.id }); setView('board'); loadBoard(group); }}>
          ← Set aside
        </button>
      </div>
      <div style={{ margin: '10px 0 2px', color: '#94a3b8', fontSize: 15, fontWeight: 700 }}>
        {p.checked} of {p.total} items in the bag{p.short > 0 ? ` · ${p.short} short` : ''}{p.waiting > 0 ? ` · ${p.waiting} on order` : ''}
      </div>
      {msgBox}
      {sortLinesForBag(items).filter((i) => (i.line_status || '') !== 'cancelled').map((i) => (
        <LineRow key={i.id} item={i} onTap={tapItem} onShort={shortItem} />
      ))}
      {shorts.length > 0 && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.12)', border: '1px solid #d97706', color: '#fbbf24', fontSize: 14, fontWeight: 700 }}>
          Short: {shorts.map((s) => s.text).join(' · ')} — label will flag it; resolve at the desk.
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <button type="button" style={S.bigBtn('#16a34a', busy || !p.complete)} disabled={busy || !p.complete}
          onClick={() => completeOrder(order)}>
          {busy ? 'Working…' : p.complete ? 'Bag done — print label' : 'Tap every item in'}
        </button>
      </div>
    </div></div>
  );
}

export default function BaggingStation() {
  const [stationToken] = useState(stationTokenFromUrl);
  const { loading, signedIn } = useStaffSession();

  if (stationToken) return <BaggingScreen stationToken={stationToken} />;
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>
        Loading…
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#334155', fontSize: 15, marginBottom: 12 }}>Sign in to Connect first.</p>
          <a href="/" style={{ color: '#1d4ed8', fontWeight: 700 }}>Go to sign in</a>
        </div>
      </div>
    );
  }
  return <BaggingScreen stationToken={null} staffMode />;
}
