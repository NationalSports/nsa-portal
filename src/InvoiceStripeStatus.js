import React from 'react';
import { authFetch } from './utils';

export default function InvoiceStripeStatus({ invoiceId, onChange }) {
  const [state, setState] = React.useState({ loading: true, payments: [], error: '' });
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setState({ loading: true, payments: [], error: '' });
    if (onChange) onChange({ invoiceId, processing: false });
    (async () => {
      try {
        const response = await authFetch('/.netlify/functions/stripe-payment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'invoice_status', invoice_id: invoiceId }),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error('Online payment status could not be verified. Check Stripe before requesting another payment.');
        if (!active) return;
        const payments = result.payments || [];
        setState({ loading: false, payments, error: '' });
        if (onChange) onChange({ invoiceId, processing: payments.some(p => p.status === 'processing') });
      } catch (e) {
        if (active) setState({ loading: false, payments: [], error: e.message });
      }
    })();
    return () => { active = false; };
  }, [invoiceId, refresh, onChange]);
  const relevant = state.payments.filter(p => p.status === 'processing' || p.review_reason || (p.status === 'succeeded' && !p.applied_at) || ['requires_payment_method', 'canceled'].includes(p.status));
  return <div style={{ padding: '10px 24px', background: relevant.length ? '#fffbeb' : '#f8fafc', fontSize: 13 }}>
    {state.loading ? 'Checking online payment status…' : state.error || (!relevant.length ? 'No pending online payment found.' : null)}
    {relevant.map(p => <div key={p.id} style={{ marginBottom: 4 }}>
      <strong>{p.status === 'processing' ? (p.method === 'ach' ? 'Bank payment processing' : 'Payment processing') : p.status === 'succeeded' ? 'Captured payment needs reconciliation' : 'Payment attempt not completed'}</strong>
      {' — '}{(p.amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
      {' submitted '}{new Date(p.submitted_at).toLocaleDateString()}.
      {p.status === 'processing' && ' Please do not request another payment while this clears. The balance remains open until settlement.'}
      {p.review_reason && ' Accounting review required: ' + p.review_reason + '.'}
    </div>)}
    {!state.loading && <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={() => setRefresh(n => n + 1)}>Refresh payment status</button>}
  </div>;
}
