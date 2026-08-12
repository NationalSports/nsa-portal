import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import { SearchSelect } from './components';

// Sales History: read-only rep-facing search across imported NetSuite
// transaction lines (customer_invoice_lines). Queries Supabase directly
// rather than loading the whole table into React state — there can be
// hundreds of thousands of rows.

const PAGE_SIZE = 1000;   // PostgREST's max-rows — a bigger .limit() is silently capped
const WAVE = 5;           // pages fetched concurrently
const MAX_LINES = 10000;  // safety cap for one search
const MAX_CUSTOMERS = 20000;
const LINE_COLS =
  'id, netsuite_internal_id, line_seq, transaction_type, document_number, ' +
  'transaction_date, status, raw_customer_name, customer_id, item, ' +
  'description, quantity, rate, amount, header_memo, line_memo';

// PostgREST caps every response at 1000 rows regardless of .limit(), so a single
// request silently truncates both the customer book (2.4k rows) and any busy
// customer's line history. Page with .range() until a short page comes back.
// buildQuery() must return a FRESH, fully-ordered query on every call — the
// slices only line up under a deterministic sort.
async function fetchAllPages(buildQuery, max) {
  const out = [];
  let start = 0;
  let done = false;
  // Page 0 on its own: most searches fit in one page, and firing a whole wave
  // for them would multiply the DB load of every keystroke.
  const first = await buildQuery().range(0, Math.min(PAGE_SIZE, max) - 1);
  if (first.error) throw first.error;
  out.push(...(first.data || []));
  if (out.length < PAGE_SIZE || out.length >= max) return { rows: out, truncated: out.length >= max };
  start = PAGE_SIZE;
  while (!done && start < max) {
    const starts = [];
    for (let k = 0; k < WAVE && start < max; k++, start += PAGE_SIZE) starts.push(start);
    const results = await Promise.all(
      starts.map((s) => buildQuery().range(s, Math.min(s + PAGE_SIZE, max) - 1))
    );
    for (const r of results) {
      if (r.error) throw r.error;
      const rows = r.data || [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) { done = true; break; }
    }
  }
  return { rows: out, truncated: !done };
}

// PostgREST's or=(…) list is comma/paren delimited, so those characters in a
// raw search term produce a parse error rather than a match.
const sanitize = (s) => s.replace(/[(),"]/g, ' ').replace(/\s+/g, ' ').trim();

export default function SalesHistory() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [includeSubs, setIncludeSubs] = useState(true);

  // Load customers once for the picker. netsuite_internal_id lets us filter
  // lines by the indexed raw_customer_nsid for a fast, exact match; alpha_tag /
  // search_tags / parent_id feed the picker's search.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const { rows: data } = await fetchAllPages(() => supabase
          .from('customers')
          .select('id, name, netsuite_internal_id, alpha_tag, search_tags, parent_id')
          .order('name', { ascending: true })
          .order('id', { ascending: true }), MAX_CUSTOMERS);
        if (!cancelled) setCustomers(data);
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customerId, customers]
  );

  // Sub-customers at any depth ("West Valley College" → …Baseball, …Swim, …).
  // Each is its own NetSuite entity, so a parent-only filter hides most of the
  // account's history.
  const descendants = useMemo(() => {
    if (!selectedCustomer) return [];
    const kids = new Map();
    for (const c of customers) {
      if (!c.parent_id) continue;
      if (!kids.has(c.parent_id)) kids.set(c.parent_id, []);
      kids.get(c.parent_id).push(c);
    }
    const out = [];
    const queue = [selectedCustomer.id];
    const seen = new Set(queue);
    while (queue.length) {
      for (const c of kids.get(queue.shift()) || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        queue.push(c.id);
      }
    }
    return out;
  }, [selectedCustomer, customers]);

  // Imported lines only carry a NetSuite id, so a portal-only customer (no
  // netsuite_internal_id) can only be matched on name.
  const customerFilter = useMemo(() => {
    if (!selectedCustomer) return null;
    const family = includeSubs ? [selectedCustomer, ...descendants] : [selectedCustomer];
    const nsids = family.map((c) => c.netsuite_internal_id).filter(Boolean);
    return nsids.length ? { nsids } : { name: selectedCustomer.name };
  }, [selectedCustomer, descendants, includeSubs]);

  // Searchable by name, alpha tag ("WVC"), bare initials, saved search tags, the
  // parent account's name/tag, or the NetSuite id — reps rarely type the full
  // legal name.
  const customerOptions = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    const opts = customers.map((c) => {
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      const initials = (c.name || '').replace(/[^a-zA-Z0-9 ]/g, ' ')
        .split(/\s+/).filter(Boolean).map((w) => w[0]).join('');
      return {
        value: c.id,
        label: c.alpha_tag ? `${c.name} (${c.alpha_tag})` : c.name,
        searchText: [c.alpha_tag, initials, ...(c.search_tags || []),
          parent?.name, parent?.alpha_tag, c.netsuite_internal_id].filter(Boolean).join(' '),
      };
    });
    return [{ value: '', label: `All customers (${customers.length})`, searchText: '' }, ...opts];
  }, [customers]);

  // A paged search spans several round-trips, so a slow earlier search can land
  // after a newer one — only the latest may write to state.
  const searchSeq = useRef(0);

  const runSearch = useCallback(async () => {
    if (!supabase) { setErr('No DB connection'); return; }
    const seq = ++searchSeq.current;
    setLoading(true);
    setErr(null);
    try {
      const buildQuery = () => {
        let q = supabase.from('customer_invoice_lines').select(LINE_COLS)
          .order('transaction_date', { ascending: false })
          .order('netsuite_internal_id', { ascending: false })
          .order('line_seq', { ascending: true })
          .order('id', { ascending: true });
        if (type !== 'all') q = q.eq('transaction_type', type);
        if (status !== 'all') q = q.ilike('status', status);
        if (from) q = q.gte('transaction_date', from);
        if (to) q = q.lte('transaction_date', to);
        if (customerFilter?.nsids) q = q.in('raw_customer_nsid', customerFilter.nsids);
        else if (customerFilter?.name) q = q.ilike('raw_customer_name', `%${customerFilter.name}%`);
        const s = sanitize(search);
        if (s) {
          // Match across customer name, document number, or item SKU. Trigram
          // GIN indexes on lower(raw_customer_name) and lower(item) make ILIKE
          // fast even at 200k+ rows.
          q = q.or(
            `raw_customer_name.ilike.%${s}%,document_number.ilike.%${s}%,item.ilike.%${s}%,header_memo.ilike.%${s}%`
          );
        }
        return q;
      };
      // The unfiltered view is a browse of recent activity — one page is plenty
      // and keeps the tab snappy. Once the rep has narrowed to something they
      // actually want complete, page through up to MAX_LINES.
      const filtered = !!(customerFilter || sanitize(search) || type !== 'all' || status !== 'all' || from || to);
      const { rows: data, truncated } = await fetchAllPages(buildQuery, filtered ? MAX_LINES : PAGE_SIZE);
      if (seq !== searchSeq.current) return;
      // At the cap the oldest transaction is usually cut mid-way through its
      // lines, which would show a wrong total — drop it rather than lie.
      let kept = data;
      if (truncated && data.length) {
        const lastTxn = data[data.length - 1].netsuite_internal_id;
        const trimmed = data.filter((r) => r.netsuite_internal_id !== lastTxn);
        if (trimmed.length) kept = trimmed;
      }
      setRows(kept);
      setCapped(truncated);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setErr(e.message || String(e));
      setRows([]);
      setCapped(false);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, [search, type, status, from, to, customerFilter]);

  // Initial load + re-run on filter changes (debounced for the text search).
  useEffect(() => {
    const t = setTimeout(runSearch, 250);
    return () => clearTimeout(t);
  }, [runSearch]);

  // Group line rows into transactions so the table reads as one row per
  // SO/invoice with expandable line items.
  const transactions = useMemo(() => {
    const byTxn = new Map();
    for (const r of rows) {
      const k = r.netsuite_internal_id;
      if (!byTxn.has(k)) {
        byTxn.set(k, {
          netsuite_internal_id: k,
          transaction_type: r.transaction_type,
          document_number: r.document_number,
          transaction_date: r.transaction_date,
          status: r.status,
          customer_name: r.raw_customer_name,
          customer_id: r.customer_id,
          header_memo: r.header_memo,
          lines: [],
          total: 0,
        });
      }
      const t = byTxn.get(k);
      t.lines.push(r);
      t.total += Number(r.amount) || 0;
    }
    return Array.from(byTxn.values()).sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) {
        return a.transaction_date < b.transaction_date ? 1 : -1;
      }
      return a.netsuite_internal_id < b.netsuite_internal_id ? 1 : -1;
    });
  }, [rows]);

  const toggle = (k) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const fmtMoney = (n) => (n == null ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  const typeLabel = (t) => ({ sales_order: 'SO', invoice: 'INV', credit_memo: 'CM' }[t] || t);
  const typeColor = (t) => ({ sales_order: '#1e40af', invoice: '#166534', credit_memo: '#b91c1c' }[t] || '#475569');

  return (
    <div>
      {/* .card clips with overflow:hidden, which cut the customer dropdown off at
          the card's bottom edge. Let it escape, and stack it over the cards below. */}
      <div className="card" style={{ marginBottom: 12, overflow: 'visible', position: 'relative', zIndex: 30 }}>
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px', minWidth: 220, position: 'relative' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Customer</label>
            <SearchSelect
              options={customerOptions}
              value={customerId}
              onChange={setCustomerId}
              placeholder="All customers"
              limit={100}
            />
            {selectedCustomer && (
              <div style={{ fontSize: 10, color: '#166534', marginTop: 4 }}>
                Filtering by <strong>{selectedCustomer.name}</strong>
                {descendants.length > 0 && (
                  <label style={{ marginLeft: 8, color: '#475569', cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeSubs} onChange={(e) => setIncludeSubs(e.target.checked)}
                      style={{ verticalAlign: 'middle', marginRight: 3 }} />
                    include {descendants.length} sub-customer{descendants.length === 1 ? '' : 's'}
                  </label>
                )}
                {' '}<button type="button" onClick={() => setCustomerId('')}
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 0, fontSize: 10 }}>clear</button>
              </div>
            )}
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 180 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Search</label>
            <input
              className="form-input"
              placeholder="Document #, SKU, or memo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Type</label>
            <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All</option>
              <option value="sales_order">Sales Orders</option>
              <option value="invoice">Invoices</option>
              <option value="credit_memo">Credit Memos</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="open">Open</option>
              {/* NetSuite stores this as "Paid In Full", so the filter needs
                  the wildcard the other exact-match statuses don't. */}
              <option value="paid%">Paid</option>
              <option value="closed">Closed</option>
              <option value="billed">Billed</option>
              <option value="pending%">Pending</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>From</label>
            <input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>To</label>
            <input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #dc2626' }}>
        <div className="card-body" style={{ color: '#991b1b', fontSize: 13 }}>Error: {err}</div>
      </div>}

      {capped && !loading && <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #d97706' }}>
        <div className="card-body" style={{ color: '#92400e', fontSize: 12 }}>
          Only the most recent lines are shown — older transactions are not listed. Pick a
          customer, or narrow the search or date range, to see the rest.
        </div>
      </div>}

      <div className="card">
        <div className="card-header">
          <h2>{loading ? 'Searching…' : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} (${rows.length} line${rows.length === 1 ? '' : 's'})`}</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: 28 }}></th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Date</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Doc #</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Customer</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Memo</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const open = expanded.has(t.netsuite_internal_id);
                return (
                  <React.Fragment key={t.netsuite_internal_id}>
                    <tr
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: open ? '#f8fafc' : undefined }}
                      onClick={() => toggle(t.netsuite_internal_id)}
                    >
                      <td style={{ padding: '8px 10px' }}>{open ? '▼' : '▶'}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'white', background: typeColor(t.transaction_type), padding: '2px 6px', borderRadius: 3 }}>
                          {typeLabel(t.transaction_type)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{t.document_number}</td>
                      <td style={{ padding: '8px 10px' }}>{t.customer_name}</td>
                      <td style={{ padding: '8px 10px', color: '#64748b' }}>{t.status}</td>
                      <td style={{ padding: '8px 10px', color: '#64748b', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.header_memo || ''}>{t.header_memo}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(t.total)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, background: '#fafbfc' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: '#64748b' }}>
                                <th style={{ padding: '6px 10px', textAlign: 'left', paddingLeft: 48 }}>Item</th>
                                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Description</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Qty</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Rate</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.lines.map((l) => (
                                <tr key={l.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '6px 10px', paddingLeft: 48, fontFamily: 'monospace' }}>{l.item}</td>
                                  <td style={{ padding: '6px 10px' }}>{l.line_memo || l.description}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{l.quantity}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtMoney(l.rate)}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!loading && transactions.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                    No transactions match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
