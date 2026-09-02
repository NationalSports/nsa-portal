import { calcPaidQualifyingSpend } from '../pricing';

const money = value => Math.round((Number(value) || 0) * 100) / 100;

const historyKey = invoice => {
  if (!invoice) return '';
  if (invoice.netsuite_internal_id) return `ns:${invoice.netsuite_internal_id}`;
  if (invoice.document_number || invoice.id) {
    return `doc:${invoice.invoice_type || invoice.type || 'invoice'}:${invoice.document_number || invoice.id}`;
  }
  return '';
};

// NetSuite's line-history import is refreshed independently from the smaller
// customer_invoices header table. Build the header shape promo earning needs so
// a paid invoice does not disappear merely because that second import lagged.
export const summarizePaidPromoHistoryLines = (lines, customers) => {
  const customerByNsid = new Map((customers || [])
    .filter(customer => customer?.netsuite_internal_id)
    .map(customer => [String(customer.netsuite_internal_id), customer.id]));
  const byTransaction = new Map();

  (lines || []).forEach(line => {
    const type = line?.transaction_type;
    const paid = String(line?.status || '').trim().toLowerCase().startsWith('paid');
    if (!paid || !['invoice', 'credit_memo'].includes(type) || !line?.netsuite_internal_id) return;
    const customerId = line.customer_id
      || customerByNsid.get(String(line.raw_customer_nsid || ''));
    if (!customerId) return;
    const key = String(line.netsuite_internal_id);
    if (!byTransaction.has(key)) {
      byTransaction.set(key, {
        id: line.document_number || `NS-${key}`,
        netsuite_internal_id: key,
        document_number: line.document_number || null,
        customer_id: customerId,
        date: line.transaction_date,
        status: 'paid',
        type: 'invoice',
        invoice_type: type,
        subtotal: 0,
        total: 0,
        _hist: true,
        _promo_line_history: true,
      });
    }
    const invoice = byTransaction.get(key);
    invoice.subtotal += Number(line.amount) || 0;
    invoice.total += Number(line.amount) || 0;
  });

  return [...byTransaction.values()].map(invoice => ({
    ...invoice,
    subtotal: money(invoice.subtotal),
    total: money(invoice.total),
  }));
};

// Prefer the authoritative header when one exists, but fill its customer link
// from line history when the header import left the row orphaned. Transactions
// found only in line history are appended once, never double-counted.
export const mergePromoHistoryInvoices = (headers, lineInvoices) => {
  const merged = new Map();
  (lineInvoices || []).forEach(invoice => {
    const key = historyKey(invoice);
    if (key) merged.set(key, invoice);
  });
  (headers || []).forEach(header => {
    const key = historyKey(header);
    if (!key) return;
    const fallback = merged.get(key);
    merged.set(key, fallback
      ? { ...fallback, ...header, customer_id: header.customer_id || fallback.customer_id }
      : header);
  });
  return [...merged.values()];
};

// Fetch only the two half-years that can affect the customer screen: the
// current earning period and the immediately-prior period that funds it.
export const fetchPaidPromoHistoryInvoices = async ({ supabase, customers, start, end }) => {
  if (!supabase || !(customers || []).length) return [];
  const nsids = [...new Set((customers || [])
    .map(customer => customer?.netsuite_internal_id)
    .filter(Boolean)
    .map(String))];
  if (!nsids.length) return [];

  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('customer_invoice_lines')
      .select('id,netsuite_internal_id,document_number,transaction_type,transaction_date,status,raw_customer_nsid,customer_id,line_seq,amount')
      .in('raw_customer_nsid', nsids)
      .in('transaction_type', ['invoice', 'credit_memo'])
      .ilike('status', 'paid%')
      .gte('transaction_date', start)
      .lte('transaction_date', end)
      .order('transaction_date', { ascending: true })
      .order('netsuite_internal_id', { ascending: true })
      .order('line_seq', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return summarizePaidPromoHistoryLines(rows, customers);
};

export const promoHalfWindows = (now = new Date()) => {
  const year = now.getFullYear();
  const firstHalf = now.getMonth() < 6;
  return firstHalf
    ? {
      previous: { start: `${year - 1}-07-01`, end: `${year - 1}-12-31` },
      current: { start: `${year}-01-01`, end: `${year}-06-30` },
    }
    : {
      previous: { start: `${year}-01-01`, end: `${year}-06-30` },
      current: { start: `${year}-07-01`, end: `${year}-12-31` },
    };
};

// Produce an in-memory ledger with the current half's allocation raised to the
// amount earned in the prior half. The order editor uses this for its balance
// preview and persists it only as part of the user's explicit Save/reconcile.
export const withEarnedPromoAllocation = ({ customer, allCustomers, sos, invs, histInvs, now = new Date() }) => {
  if (!customer) return customer;
  const program = (customer.promo_programs || []).find(p => p?.is_active !== false
    && p.type === 'percent_of_spend' && Number(p.spend_percentage) > 0);
  if (!program) return customer;
  const ownerId = customer.id;
  const familyIds = [ownerId, ...(allCustomers || []).filter(c => c?.parent_id === ownerId).map(c => c.id)];
  const windows = promoHalfWindows(now);
  const spend = calcPaidQualifyingSpend({
    sos: sos || [], invs: invs || [], histInvs: histInvs || [], famIds: familyIds,
    start: windows.previous.start, end: windows.previous.end,
  }).total;
  const earned = money(spend * Number(program.spend_percentage));
  if (earned <= 0) return customer;
  const existing = (customer.promo_periods || []).find(p => p.period_start === windows.current.start);
  if (existing && Number(existing.allocated) >= earned - 0.005) return customer;
  const period = existing
    ? { ...existing, allocated: earned, program_id: existing.program_id || program.id || null }
    : {
      id: `pp_${ownerId}_${windows.current.start}`,
      customer_id: ownerId,
      program_id: program.id || null,
      period_start: windows.current.start,
      period_end: windows.current.end,
      allocated: earned,
      used: 0,
      notes: 'Auto co-op allocation from paid spend',
      created_at: now.toISOString(),
    };
  return {
    ...customer,
    promo_periods: existing
      ? (customer.promo_periods || []).map(p => p.id === existing.id ? period : p)
      : [...(customer.promo_periods || []), period],
  };
};
