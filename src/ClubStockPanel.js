/* eslint-disable */
// src/ClubStockPanel.js
// ─────────────────────────────────────────────────────────
// "Your stock at NSA" — the inventory a club owns, sitting in our warehouse.
//
// Deliberately shows ONLY the club's own stock. The kit grid elsewhere in the
// roster flow reports `mine + vendor` as one availability number, which answers
// "can we get it?"; this panel answers the different question "what have we
// already bought?". Mixing vendor supply back in here would undo that split.
//
// Scope: products.customer_id attributes a stock pool to a club. That column is
// attribution, not an RLS boundary (products/product_inventory are anon-readable
// account-wide), so this decides what a club is *shown*, not what it could reach.
// ─────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { columnsFor, scaleOfSizes, SZ_ABBREV, ONE_SIZE } from './lib/sizeScales';

const INK = '#0b1220';
const MUTED = '#64748b';
const FAINT = '#cbd5e1';
const LINE = '#e2e8f0';
const OUT_BG = '#fef2f2';
const OUT_FG = '#dc2626';

const up = (s) => String(s == null ? '' : s).trim().toUpperCase();

// "Encinitas Express — Adult Jersey" reads as just "Adult Jersey" on the club's
// own panel; repeated down 33 rows the prefix is pure noise.
//
// The account name and the product naming routinely disagree on trailing words —
// the customer record is "Encinitas Express Soccer" while the products say
// "Encinitas Express" — so an exact match strips nothing. Compare on whole words
// and accept either being the longer of the two. Anything that isn't the club's
// own name is left completely alone.
export const stripClubPrefix = (name, clubName) => {
  const n = String(name || '').trim();
  const c = String(clubName || '').trim().toLowerCase();
  if (!c) return n;
  const m = n.match(/^(.+?)\s+[—–]\s+(.+)$/) || n.match(/^(.+?)\s+-\s+(.+)$/);
  if (!m) return n;
  const head = m[1].trim().toLowerCase();
  const rest = m[2].trim();
  if (!rest || head.length < 3) return n;
  const overlaps = head === c || c.startsWith(head + ' ') || head.startsWith(c + ' ');
  return overlaps ? rest : n;
};

/**
 * Bucket products into the three grids and work out each grid's columns.
 * Exported for tests — the layout is the part most likely to drift silently.
 */
export const buildStockSections = (products, invByProduct, clubName) => {
  const rows = (products || []).map((p) => {
    const inv = invByProduct[p.id] || {};
    const declared = Array.isArray(p.available_sizes) ? p.available_sizes : [];
    const sizes = declared.length ? declared : Object.keys(inv);
    return {
      id: p.id,
      sku: p.sku || '',
      name: stripClubPrefix(p.name, clubName),
      color: p.color || '',
      category: p.category || 'Other',
      sizes,
      inv,
      total: Object.values(inv).reduce((s, q) => s + (q || 0), 0),
      scale: scaleOfSizes(sizes),
    };
  });

  const bucket = (scale) => {
    const list = rows.filter((r) => r.scale === scale);
    if (!list.length) return null;
    list.sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.color.localeCompare(b.color));
    const used = [...new Set(list.flatMap((r) => r.sizes))];
    return { rows: list, cols: scale === 'one' ? [] : columnsFor(scale, used) };
  };

  return [
    { key: 'adult', title: "Adult & Women's", ...(bucket('adult') || {}) },
    { key: 'youth', title: 'Youth', ...(bucket('youth') || {}) },
    { key: 'one', title: 'One Size', ...(bucket('one') || {}) },
  ].filter((s) => s.rows && s.rows.length);
};

const Tile = ({ label, value, accent }) => (
  <div style={{ background: '#f8fafc', borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '8px 14px', minWidth: 104 }}>
    <div style={{ fontSize: 19, fontWeight: 800, color: accent, lineHeight: 1.15 }}>{value}</div>
    <div style={{ fontSize: 9.5, fontWeight: 700, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
  </div>
);

function StockTable({ section }) {
  const { rows, cols, key } = section;
  const th = {
    padding: '8px 6px', fontSize: 10.5, fontWeight: 800, color: MUTED,
    textAlign: 'center', whiteSpace: 'nowrap', letterSpacing: 0.3,
  };
  let lastCat = null;

  return (
    <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${LINE}` }}>
              <th style={{ ...th, textAlign: 'left', padding: '8px 14px', minWidth: 170, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 2 }}>Item</th>
              <th style={{ ...th, textAlign: 'left', minWidth: 86 }}>Colour</th>
              {cols.map((sz) => <th key={sz} style={th} title={sz}>{SZ_ABBREV[sz] || sz}</th>)}
              <th style={{ ...th, borderLeft: `2px solid ${LINE}`, minWidth: 54 }}>
                {key === 'one' ? 'On hand' : 'Total'}
              </th>
              {/* With no size columns the one-size grid would stretch its few
                  columns across the full width; a trailing spacer keeps them
                  left-aligned with the grids above. */}
              {key === 'one' && <th style={{ ...th, width: '100%' }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const newCat = r.category !== lastCat;
              lastCat = r.category;
              const bg = ri % 2 ? '#fafbfc' : '#fff';
              return (
                <React.Fragment key={r.id}>
                  {newCat && (
                    <tr>
                      <td colSpan={cols.length + 3 + (key === 'one' ? 1 : 0)} style={{ background: '#eef2f7', padding: '5px 14px', fontSize: 10, fontWeight: 800, color: INK, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {r.category}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderTop: `1px solid #f1f5f9`, background: bg }}>
                    <td style={{ padding: '7px 14px', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: bg, zIndex: 1 }} title={r.sku}>
                      <span style={{ fontWeight: 700, color: INK }}>{r.name}</span>
                      <span style={{ color: FAINT, fontSize: 10.5, marginLeft: 7 }}>{r.sku}</span>
                    </td>
                    <td style={{ padding: '7px 6px', color: MUTED, fontSize: 11.5, whiteSpace: 'nowrap' }}>{r.color}</td>
                    {cols.map((sz) => {
                      const carried = r.sizes.some((s) => up(s) === up(sz));
                      if (!carried) return <td key={sz} style={{ padding: '5px 4px', textAlign: 'center', color: '#e8edf3' }}>–</td>;
                      const q = r.inv[sz] || 0;
                      return (
                        <td key={sz} style={{ padding: '5px 4px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', minWidth: 26, padding: '2px 6px', borderRadius: 6,
                            fontWeight: 800, fontSize: 12,
                            color: q === 0 ? OUT_FG : INK,
                            background: q === 0 ? OUT_BG : 'transparent',
                          }} title={q === 0 ? `${r.name} ${sz} — none on hand` : `${r.name} ${sz} — ${q} on hand`}>
                            {q}
                          </span>
                        </td>
                      );
                    })}
                    <td style={{ padding: '5px 10px', textAlign: 'center', fontWeight: 800, color: INK, borderLeft: `2px solid ${LINE}` }}>
                      {r.total.toLocaleString()}
                    </td>
                    {key === 'one' && <td />}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * @param customerId  customers.id — matched against products.customer_id
 * @param customerName used only to strip the club prefix off product names
 */
export default function ClubStockPanel({ customerId, customerName }) {
  const [state, setState] = useState({ loading: true, products: [], inv: {}, error: null });

  useEffect(() => {
    if (!customerId) { setState({ loading: false, products: [], inv: {}, error: null }); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: products, error } = await supabase
          .from('products')
          .select('id,sku,name,color,category,available_sizes')
          .eq('customer_id', customerId)
          .eq('is_archived', false);
        if (error) throw error;
        const ids = (products || []).map((p) => p.id);
        let invRows = [];
        if (ids.length) {
          const { data, error: e2 } = await supabase
            .from('product_inventory').select('product_id,size,quantity').in('product_id', ids);
          if (e2) throw e2;
          invRows = data || [];
        }
        if (cancelled) return;
        const inv = {};
        invRows.forEach((r) => {
          if (!inv[r.product_id]) inv[r.product_id] = {};
          inv[r.product_id][r.size] = (inv[r.product_id][r.size] || 0) + (r.quantity || 0);
        });
        setState({ loading: false, products: products || [], inv, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, products: [], inv: {}, error: err.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

  const sections = useMemo(
    () => buildStockSections(state.products, state.inv, customerName),
    [state.products, state.inv, customerName]);

  const { units, items, outCount } = useMemo(() => {
    let units = 0, outCount = 0;
    const all = sections.flatMap((s) => s.rows);
    all.forEach((r) => {
      units += r.total;
      r.sizes.forEach((sz) => { if (!(r.inv[sz] > 0)) outCount += 1; });
    });
    return { units, items: all.length, outCount };
  }, [sections]);

  if (state.loading) {
    return (
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 16px', marginTop: 14, color: MUTED, fontSize: 12.5 }}>
        Loading your stock…
      </div>
    );
  }
  if (state.error) {
    return (
      <div style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 14, padding: '14px 16px', marginTop: 14, color: '#b91c1c', fontSize: 12.5 }}>
        Couldn’t load your stock: {state.error}
      </div>
    );
  }
  if (!sections.length) {
    return (
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 16px', marginTop: 14, color: MUTED, fontSize: 12.5 }}>
        <b style={{ color: INK }}>No stock on record yet.</b> Once we’re holding inventory for you,
        it shows up here size by size.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,.05)' }}>
      <div style={{ background: INK, color: '#fff', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 12.5 }}>📦 Your stock at NSA</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.7, fontWeight: 600 }}>
          held for you in our warehouse — not vendor availability
        </span>
      </div>

      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <Tile label="Units on hand" value={units.toLocaleString()} accent={INK} />
          <Tile label="Items" value={items} accent="#2563eb" />
          <Tile label={outCount === 1 ? 'Size out' : 'Sizes out'} value={outCount} accent={outCount ? OUT_FG : '#15803d'} />
        </div>

        {sections.map((s) => (
          <div key={s.key} style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 11.5, color: INK, letterSpacing: 0.3 }}>
              {s.title}
              <span style={{ fontWeight: 600, color: MUTED, marginLeft: 8 }}>
                {s.rows.length} item{s.rows.length === 1 ? '' : 's'} ·{' '}
                {s.rows.reduce((t, r) => t + r.total, 0).toLocaleString()} units
              </span>
            </div>
            <StockTable section={s} />
          </div>
        ))}

        <div style={{ marginTop: 14, fontSize: 10.5, color: MUTED, lineHeight: 1.6 }}>
          A dash means the size isn’t carried in that item; a red <b style={{ color: OUT_FG }}>0</b> means
          it’s carried but you’re out. Youth sizes are listed on their own grid.
        </div>
      </div>
    </div>
  );
}
