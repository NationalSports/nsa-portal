import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { methodicAccountingApi } from './methodicApi';
import { METHODIC_COLORS, METHODIC_STATUS, billingBalanceCents, statusTone } from './methodicWorkflow';

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (value, days) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const financeRole = (user) => ['admin', 'super_admin', 'accounting'].includes(user?.role);

function BillingBadge({ status }) {
  const tone = METHODIC_COLORS[statusTone('billing', status)];
  return <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 900 }}>{METHODIC_STATUS.billing[status] || status || 'Not ready'}</span>;
}

export default function MethodicAccountingPanel({ request, currentUser, notify, onUpdated }) {
  const canManage = financeRole(currentUser);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const invoiceDate = request.billing_invoice_date || today();
  const [billing, setBilling] = useState({
    amount: request.billing_amount_cents != null
      ? (Number(request.billing_amount_cents) / 100).toFixed(2)
      : request.quoted_unit_cost_cents != null
        ? ((Number(request.quoted_unit_cost_cents) * Number(request.quantity || 0) + Number(request.quoted_setup_cost_cents || 0)) / 100).toFixed(2)
        : '',
    invoiceDate,
    dueDate: request.billing_due_date || plusDays(invoiceDate, 30),
    invoiceNumber: request.methodic_invoice_number || request.request_number || '',
  });
  const balance = billingBalanceCents(request);
  const [payment, setPayment] = useState({
    amount: balance ? (balance / 100).toFixed(2) : '', paymentDate: today(), reference: '', memo: '',
  });
  useEffect(() => {
    const nextInvoiceDate = request.billing_invoice_date || today();
    setBilling({
      amount: request.billing_amount_cents != null
        ? (Number(request.billing_amount_cents) / 100).toFixed(2)
        : request.quoted_unit_cost_cents != null
          ? ((Number(request.quoted_unit_cost_cents) * Number(request.quantity || 0) + Number(request.quoted_setup_cost_cents || 0)) / 100).toFixed(2)
          : '',
      invoiceDate: nextInvoiceDate,
      dueDate: request.billing_due_date || plusDays(nextInvoiceDate, 30),
      invoiceNumber: request.methodic_invoice_number || request.request_number || '',
    });
    const nextBalance = billingBalanceCents(request);
    setPayment((current) => ({ ...current, amount: nextBalance ? (nextBalance / 100).toFixed(2) : '' }));
  }, [request.billing_amount_cents, request.amount_paid_cents, request.billing_invoice_date, request.billing_due_date, request.methodic_invoice_number, request.quoted_unit_cost_cents, request.quoted_setup_cost_cents, request.quantity, request.request_number]);

  const load = useCallback(async () => {
    if (!request?.id) return;
    setLoading(true); setError('');
    try { setStatus(await methodicAccountingApi('status', { id: request.id })); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [request?.id]);
  useEffect(() => { load(); }, [load]);

  const connectionsReady = !!status?.connections?.national?.connected && !!status?.connections?.methodic?.connected;
  const invoiceEnabled = !!status?.config?.invoice_sync_enabled;
  const paymentEnabled = !!status?.config?.payment_sync_enabled;
  const posted = !!request.methodic_qb_transaction_id && !!request.national_qb_transaction_id;
  const canEditBilling = canManage && !request.methodic_qb_transaction_id && !request.national_qb_transaction_id;
  const payments = status?.payments || [];
  const syncHint = useMemo(() => {
    if (!canManage) return 'Accounting or an admin posts and pays intercompany transactions.';
    if (!connectionsReady) return 'Connect both National and Methodic QuickBooks companies from Methodic Operations.';
    if (!invoiceEnabled) return 'Complete and enable the intercompany mappings in Methodic Operations.';
    return '';
  }, [canManage, connectionsReady, invoiceEnabled]);

  const run = async (action, payload, success) => {
    setBusy(action); setError('');
    try {
      const data = await methodicAccountingApi(action, { id: request.id, ...payload });
      notify?.(success);
      onUpdated?.(data.request);
      await load();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusy(''); }
  };

  const prepare = () => run('prepare', {
    billing_amount_cents: Math.round(Number(billing.amount || 0) * 100),
    billing_invoice_date: billing.invoiceDate,
    billing_due_date: billing.dueDate,
    methodic_invoice_number: billing.invoiceNumber,
  }, 'Methodic billing details prepared');

  const recordPayment = () => {
    const amountCents = Math.round(Number(payment.amount || 0) * 100);
    if (!amountCents) return setError('Enter the payment amount.');
    if (!window.confirm(`Record ${money(amountCents)} as paid in National and Methodic QuickBooks? This records the ledger payment; it does not move money.`)) return;
    run('record_payment', {
      amount_cents: amountCents,
      payment_date: payment.paymentDate,
      reference_number: payment.reference,
      memo: payment.memo,
    }, 'Payment recorded in both QuickBooks companies');
  };

  return <div style={{ marginTop: 12, border: '1px solid #c7d2fe', borderRadius: 10, overflow: 'hidden' }}>
    <div style={{ padding: '9px 12px', background: '#eef2ff', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      <strong style={{ color: '#312e81' }}>Intercompany accounting</strong>
      <BillingBadge status={request.billing_status} />
      {request.billing_amount_cents != null && <span style={{ fontSize: 11, color: '#475569' }}>Invoice {money(request.billing_amount_cents)} · balance <strong>{money(balance)}</strong></span>}
      {loading && <span style={{ fontSize: 10, color: '#64748b' }}>Loading connections…</span>}
    </div>
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 10 }}>
        <span style={{ padding: '3px 7px', borderRadius: 999, background: status?.connections?.methodic?.connected ? '#dcfce7' : '#fee2e2', color: status?.connections?.methodic?.connected ? '#166534' : '#b91c1c', fontWeight: 800 }}>Methodic QB {status?.connections?.methodic?.connected ? 'connected' : 'not connected'}</span>
        <span style={{ padding: '3px 7px', borderRadius: 999, background: status?.connections?.national?.connected ? '#dcfce7' : '#fee2e2', color: status?.connections?.national?.connected ? '#166534' : '#b91c1c', fontWeight: 800 }}>National QB {status?.connections?.national?.connected ? 'connected' : 'not connected'}</span>
        {request.methodic_qb_transaction_id && <span>Methodic invoice QB #{request.methodic_qb_transaction_id}</span>}
        {request.national_qb_transaction_id && <span>National bill QB #{request.national_qb_transaction_id}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
        <label><span className="oe-label">Methodic invoice #</span><input className="form-input" value={billing.invoiceNumber} disabled={!canEditBilling} onChange={(event) => setBilling((value) => ({ ...value, invoiceNumber: event.target.value }))} /></label>
        <label><span className="oe-label">Amount Methodic bills National</span><input className="form-input" type="number" min="0" step="0.01" value={billing.amount} disabled={!canEditBilling} onChange={(event) => setBilling((value) => ({ ...value, amount: event.target.value }))} /></label>
        <label><span className="oe-label">Invoice date</span><input className="form-input" type="date" value={billing.invoiceDate} disabled={!canEditBilling} onChange={(event) => setBilling((value) => ({ ...value, invoiceDate: event.target.value }))} /></label>
        <label><span className="oe-label">Due date</span><input className="form-input" type="date" value={billing.dueDate} disabled={!canEditBilling} onChange={(event) => setBilling((value) => ({ ...value, dueDate: event.target.value }))} /></label>
      </div>
      {canManage && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        {!posted && <button className="btn btn-sm btn-secondary" disabled={!canEditBilling || !!busy} onClick={prepare}>{busy === 'prepare' ? 'Saving…' : 'Prepare billing'}</button>}
        {!posted && <button className="btn btn-sm btn-primary" disabled={!connectionsReady || !invoiceEnabled || request.billing_status !== 'ready' || !!busy} onClick={() => run('sync', {}, 'Methodic invoice and National bill synced')}>{busy === 'sync' ? 'Syncing both companies…' : 'Sync invoice + National bill'}</button>}
        {syncHint && <span style={{ fontSize: 10, color: '#b45309' }}>{syncHint}</span>}
      </div>}

      {posted && balance > 0 && canManage && <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 7 }}>Record bill payment and Methodic receipt</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 8 }}>
          <label><span className="oe-label">Amount</span><input className="form-input" type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayment((value) => ({ ...value, amount: event.target.value }))} /></label>
          <label><span className="oe-label">Payment date</span><input className="form-input" type="date" value={payment.paymentDate} onChange={(event) => setPayment((value) => ({ ...value, paymentDate: event.target.value }))} /></label>
          <label><span className="oe-label">Bank/check reference</span><input className="form-input" value={payment.reference} onChange={(event) => setPayment((value) => ({ ...value, reference: event.target.value }))} /></label>
          <label><span className="oe-label">Memo</span><input className="form-input" value={payment.memo} onChange={(event) => setPayment((value) => ({ ...value, memo: event.target.value }))} /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" disabled={!connectionsReady || !paymentEnabled || !!busy} onClick={recordPayment}>{busy === 'record_payment' ? 'Posting both payments…' : 'Record paid in both QuickBooks'}</button>
          <span style={{ fontSize: 10, color: '#64748b' }}>Records QBO ledger entries only; it does not initiate ACH or move funds.</span>
        </div>
      </div>}

      {!!payments.length && <div style={{ marginTop: 10, fontSize: 10, color: '#475569' }}><strong>Payments:</strong> <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>{payments.map((row) => <span key={row.id}>{row.payment_number} {money(row.amount_cents)} · {row.status} {canManage && ['partial', 'error'].includes(row.status) && <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => run('record_payment', { payment_id: row.id }, `${row.payment_number} resumed in both QuickBooks companies`)}>Retry</button>}</span>)}</span></div>}
      {request.billing_error && <div style={{ marginTop: 9, color: '#b91c1c', fontSize: 11, fontWeight: 700 }}>Last sync: {request.billing_error}</div>}
      {error && <div style={{ marginTop: 9, color: '#b91c1c', background: '#fef2f2', padding: 8, borderRadius: 6, fontSize: 11 }}>{error}</div>}
    </div>
  </div>;
}
