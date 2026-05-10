import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './lib/supabase';

// Sales History: read-only rep-facing search across imported NetSuite
// transaction lines (customer_invoice_lines). Queries Supabase directly
// rather than loading the whole table into React state — there can be
// hundreds of thousands of rows.

const PAGE_SIZE = 200;

export default function SalesHistory() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [customers, setCustomers] = useState([]);
  const [customerInput, setCustomerInput] = useState('');

  // Load customers once for the picker. Includes netsuite_internal_id so we
  // can filter lines by the indexed raw_customer_nsid for fast, exact match.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, netsuite_internal_id')
        .order('name', { ascending: true });
      if (!cancelled && !error) setCustomers(data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  // When the input matches a known customer name, treat it as a hard filter;
  // otherwise leave the customer filter unset and let the search field do
  // fuzzy matching.
  const selectedCustomer = useMemo(() => {
    const v = customerInput.trim().toLowerCase();
    if (!v) return null;
    return customers.find((c) => (c.name || '').toLowerCase() === v) || null;
  }, [customerInput, customers]);

  const runSearch = useCallback(async () => {
    if (!supabase) { setErr('No DB connection'); return; }
    setLoading(true);
    setErr(null);
    try {
      let q = supabase.from('customer_invoice_lines').select(
        'id, netsuite_internal_id, line_seq, transaction_type, document_number, ' +
        'transaction_date, status, raw_customer_name, customer_id, item, ' +
        'description, quantity, rate, amount, header_memo, line_memo'
      ).order('transaction_date', { ascending: false })
       .order('netsuite_internal_id', { ascending: false })
       .order('line_seq', { ascending: true })
       .limit(PAGE_SIZE * 50);
      if (type !== 'all') q = q.eq('transaction_type', type);
      if (status !== 'all') q = q.ilike('status', status);
      if (from) q = q.gte('transaction_date', from);
      if (to) q = q.lte('transaction_date', to);
      if (selectedCustomer) {
        // Prefer the indexed netsuite id; fall back to name for customers
        // we haven't matched yet via netsuite_internal_id.
        if (selectedCustomer.netsuite_internal_id) {
          q = q.eq('raw_customer_nsid', selectedCustomer.netsuite_internal_id);
        } else {
          q = q.ilike('raw_customer_name', selectedCustomer.name);
        }
      }
      const s = search.trim();
      if (s) {
        // Match across customer name, document number, or item SKU. Trigram
        // GIN indexes on lower(raw_customer_name) and lower(item) make ILIKE
        // fast even at 200k+ rows.
        q = q.or(
          `raw_customer_name.ilike.%${s}%,document_number.ilike.%${s}%,item.ilike.%${s}%,header_memo.ilike.%${s}%`
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, type, status, from, to, selectedCustomer]);

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
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px', minWidth: 200, position: 'relative' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Customer</label>
            <input
              className="form-input"
              list="sales-history-customers"
              placeholder={`Pick from ${customers.length} customers…`}
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              autoFocus
            />
            <datalist id="sales-history-customers">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            {customerInput && !selectedCustomer && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                Type to filter — pick a name from the list to lock the filter.
              </div>
            )}
            {selectedCustomer && (
              <div style={{ fontSize: 10, color: '#166534', marginTop: 2 }}>
                Filtering by <strong>{selectedCustomer.name}</strong>
                {' '}<button type="button" onClick={() => setCustomerInput('')}
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
              <option value="paid">Paid</option>
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
