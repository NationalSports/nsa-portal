import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import './CardFeedPanel.css';

const currentMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
const accountLabel = account => `${account.AcctNum || 'No account number'} · ${account.Name}`;
const statusLabel = { new: 'Needs category', ready: 'Ready', submitted: 'Awaiting QBO', posted: 'Posted', ignored: 'Ignored', removed: 'Removed' };
const OAUTH_STATE_KEY = 'nsa-plaid-link-state';

export async function cardFeedRequest(body) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sign in with your staff account to manage card transactions.');
  const response = await fetch('/.netlify/functions/financial-card-feed', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || 'Card-feed request failed.');
  return result;
}

function loadPlaid() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('plaid-link-script');
    if (existing) { existing.addEventListener('load', () => resolve(window.Plaid), { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
    const script = document.createElement('script');
    script.id = 'plaid-link-script'; script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; script.async = true;
    script.onload = () => resolve(window.Plaid); script.onerror = () => reject(new Error('Secure card connection could not be loaded.'));
    document.head.appendChild(script);
  });
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function downloadReport(month, transactions) {
  const rows = [['Date', 'Card', 'Merchant', 'Description', 'Amount', 'Status', 'QBO expense account', 'Receipt']];
  for (const row of transactions) rows.push([row.transaction_date, `${row.account?.name || ''} ${row.account?.mask ? `••${row.account.mask}` : ''}`.trim(),
    row.merchant_name || '', row.description, (row.amount_cents / 100).toFixed(2), statusLabel[row.status] || row.status,
    [row.expense_account_number, row.expense_account_name].filter(Boolean).join(' · '), row.expense?.receipt_name ? 'Attached' : row.receipt_required ? 'Missing' : 'Not required']);
  const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `card-expenses-${month}.csv`; link.click(); URL.revokeObjectURL(url);
}

export default function CardFeedPanel({ company, options, onPrepare, refreshKey = 0 }) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const expenseAccounts = useMemo(() => (options?.accounts || []).filter(account => ['Expense', 'Other Expense', 'Cost of Goods Sold'].includes(account.AccountType)), [options]);
  const paymentAccounts = useMemo(() => (options?.accounts || []).filter(account => ['Credit Card', 'Bank'].includes(account.AccountType)), [options]);

  const load = async (nextMonth = month) => {
    setBusy('load'); setError('');
    try { const result = await cardFeedRequest({ action: 'list', company, month: nextMonth }); setData(result); setDrafts({}); }
    catch (failure) { setError(failure.message); setData(null); }
    finally { setBusy(''); }
  };
  useEffect(() => { load(month); }, [company, month, refreshKey]);

  const run = async (key, action, success) => {
    if (busy) return;
    setBusy(key); setError(''); setNote('');
    try { const result = await action(); if (result) { setData(result); setDrafts({}); if (success) setNote(success); } }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };
  const launchLink = async linkToken => {
    const Plaid = await loadPlaid();
    return new Promise((resolve, reject) => {
      let completed = false;
      const handler = Plaid.create({ token: linkToken,
        receivedRedirectUri: new URL(window.location.href).searchParams.has('oauth_state_id') ? window.location.href : undefined,
        onSuccess: async (publicToken, metadata) => { completed = true; sessionStorage.removeItem(OAUTH_STATE_KEY); try {
          const result = await cardFeedRequest({ action: 'exchange', company, month, public_token: publicToken, institution: metadata.institution });
          const clean = new URL(window.location.href); clean.searchParams.delete('oauth_state_id'); window.history.replaceState({}, '', clean.toString()); resolve(result);
        } catch (failure) { reject(failure); } finally { handler.destroy(); } },
        onExit: failure => { handler.destroy(); if (!completed) {
          sessionStorage.removeItem(OAUTH_STATE_KEY);
          const clean = new URL(window.location.href); clean.searchParams.delete('oauth_state_id'); window.history.replaceState({}, '', clean.toString());
          if (failure) reject(new Error(failure.display_message || failure.error_message || 'Card connection was not completed.')); else resolve(null);
        } },
      });
      handler.open();
    });
  };
  const connect = () => run('connect', async () => {
    const { link_token } = await cardFeedRequest({ action: 'link_token', company });
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ company, link_token }));
    return launchLink(link_token);
  }, 'Card connected. Cleared transactions will appear as the provider makes them available.');
  useEffect(() => {
    if (!new URL(window.location.href).searchParams.has('oauth_state_id') || busy) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) || 'null');
      if (saved?.company === company && saved?.link_token) run('connect', () => launchLink(saved.link_token), 'Card connected. Cleared transactions will appear as the provider makes them available.');
    } catch (_) { sessionStorage.removeItem(OAUTH_STATE_KEY); }
    // Resume only on the OAuth return navigation.
  }, [company]);
  const draft = transaction => drafts[transaction.id] || { expense_account_id: transaction.expense_account_id || '', purpose: transaction.purpose || '',
    receipt_required: transaction.receipt_required !== false, remember: false };
  const setDraft = (id, patch) => setDrafts(previous => ({ ...previous, [id]: { ...draft((data?.transactions || []).find(row => row.id === id)), ...patch } }));
  const report = data?.report;
  const connections = data?.connections || [];
  const accounts = data?.accounts || [];
  const transactions = data?.transactions || [];
  const rules = data?.rules || [];

  return <div className="expense-panel card-feed-panel">
    <div className="expense-heading"><div><div className="expense-eyebrow">DIRECT CARD FEED</div><h3>Card transactions</h3><p>Import cleared charges, categorize them, attach receipts, and review each QuickBooks posting.</p></div>
      <div className="expense-inline"><label>Report month<input aria-label="Card report month" type="month" value={month} max={currentMonth()} onChange={event => setMonth(event.target.value)} /></label>
        <button type="button" disabled={!!busy || !data?.configured} onClick={() => run('sync', () => cardFeedRequest({ action: 'sync', company, month }), 'Card transactions refreshed.')}>{busy === 'sync' ? 'Syncing…' : 'Refresh cards'}</button>
        <button type="button" className="expense-primary" disabled={!!busy || !data?.configured} onClick={connect}>{busy === 'connect' ? 'Connecting…' : 'Connect card'}</button></div></div>
    {error && <div className="expense-message expense-error" role="alert">{error}</div>}
    {note && <div className="expense-message" role="status">{note}</div>}
    {data && !data.configured && <div className="card-feed-setup"><strong>Card feed is ready for provider credentials.</strong><p>Configure the server-only Plaid client ID, secret, environment, and a 32-byte token-encryption key. Card login happens in Plaid Link; the portal never receives the password.</p></div>}
    {report && <>
      <div className="card-report-tiles"><div><span>Monthly spend</span><strong>{money(report.total_cents)}</strong><small>{report.count} imported charges</small></div>
        <div><span>Needs review</span><strong>{report.needs_review}</strong><small>{report.ready} ready · {report.submitted} awaiting QBO</small></div>
        <div><span>Posted</span><strong>{report.posted}</strong><small>{report.missing_receipts} missing receipts</small></div></div>
      <div className="card-report"><div className="expense-heading"><h4>Monthly account report</h4><button type="button" disabled={!transactions.length} onClick={() => downloadReport(month, transactions)}>Download CSV</button></div>
        {!report.by_account.length ? <p className="expense-muted">No imported card spending for this month.</p> : report.by_account.map(row => <div className="card-report-row" key={row.expense_account_id || 'uncategorized'}><span>{row.expense_account_number ? `${row.expense_account_number} · ` : ''}{row.expense_account_name}</span><span>{row.count} charges</span><strong>{money(row.amount_cents)}</strong></div>)}</div>
    </>}
    {!!connections.length && <div className="card-connections"><h4>Connected accounts</h4>
      <div className="card-connection-summary">{connections.map(connection => <div key={connection.id}><strong>{connection.institution_name}</strong><span className={`expense-status ${connection.status}`}>{connection.status}</span><small>{connection.last_synced_at ? `Last refreshed ${new Date(connection.last_synced_at).toLocaleString()}` : 'Waiting for first refresh'}{connection.last_error ? ` · ${connection.last_error}` : ''}</small></div>)}</div>
      {accounts.map(account => <div className="card-account" key={account.id}>
      <div><strong>{account.name}{account.mask && ` ••${account.mask}`}</strong><small>{account.account_subtype || account.account_type}</small></div>
      <label>QuickBooks card account<select aria-label={`QuickBooks account for ${account.name}`} value={account.qbo_payment_account_id || ''} disabled={!!busy || !options} onChange={event => run(`map-${account.id}`, () => cardFeedRequest({ action: 'map_account', company, month, account_id: account.id, qbo_payment_account_id: event.target.value }), 'QuickBooks card mapping saved.')}>
        <option value="">Choose account number</option>{paymentAccounts.map(option => <option key={option.Id} value={option.Id}>{accountLabel(option)} · {option.AccountType}</option>)}</select></label>
    </div>)}</div>}
    {data && <div className="card-inbox"><div className="expense-heading"><h4>Transaction inbox</h4><span className="expense-muted">{rules.length} merchant rules</span></div>
      {!transactions.length && <div className="expense-empty"><h4>No transactions in this month</h4><p>Connect or refresh a card, or choose a different report month.</p></div>}
      {transactions.map(transaction => {
        const values = draft(transaction); const refund = transaction.amount_cents < 0; const unavailable = transaction.pending || transaction.provider_removed || refund || ['submitted', 'posted', 'ignored', 'removed'].includes(transaction.status);
        return <article className="card-transaction" key={transaction.id}>
          <div className="card-transaction-main"><div><strong>{transaction.merchant_name || transaction.description}</strong><div className="expense-muted">{transaction.transaction_date} · {transaction.account?.name}{transaction.account?.mask && ` ••${transaction.account.mask}`} · {transaction.category_primary || 'Uncategorized'}</div></div>
            <div className="card-transaction-amount"><strong>{money(transaction.amount_cents)}</strong><span className={`expense-status ${transaction.status}`}>{transaction.pending ? 'Pending' : refund ? 'Refund' : statusLabel[transaction.status]}</span></div></div>
          {!unavailable && <div className="card-category-grid"><label>QBO expense account<select aria-label={`Expense account for ${transaction.merchant_name || transaction.description}`} value={values.expense_account_id} onChange={event => setDraft(transaction.id, { expense_account_id: event.target.value })}><option value="">Choose account number</option>{expenseAccounts.map(account => <option key={account.Id} value={account.Id}>{accountLabel(account)}</option>)}</select></label>
            <label>Business purpose<input aria-label={`Purpose for ${transaction.merchant_name || transaction.description}`} maxLength={1000} value={values.purpose} onChange={event => setDraft(transaction.id, { purpose: event.target.value })} /></label>
            <div className="card-checks"><label><input type="checkbox" checked={values.receipt_required} onChange={event => setDraft(transaction.id, { receipt_required: event.target.checked })} /> Receipt required</label><label><input type="checkbox" checked={values.remember} onChange={event => setDraft(transaction.id, { remember: event.target.checked })} /> Remember merchant rule</label></div>
            <div className="expense-inline"><button type="button" disabled={!!busy} onClick={() => run(`ignore-${transaction.id}`, () => cardFeedRequest({ action: 'ignore', company, month, transaction_id: transaction.id }), 'Transaction ignored.')}>Ignore</button>
              <button type="button" disabled={!!busy || !values.expense_account_id || !values.purpose.trim()} onClick={() => run(`category-${transaction.id}`, () => cardFeedRequest({ action: 'categorize', company, month, transaction_id: transaction.id, ...values }), 'Category saved.')}>Save category</button>
              {transaction.status === 'ready' && <button type="button" className="expense-primary" disabled={!!busy || !transaction.account?.qbo_payment_account_id} onClick={() => onPrepare(transaction)}>Prepare expense</button>}</div></div>}
          {transaction.pending && <p className="expense-muted">This charge can be categorized after it clears and its final amount is available.</p>}
          {transaction.status === 'ready' && !transaction.account?.qbo_payment_account_id && <p className="expense-error-text">Map the connected card to its QuickBooks account before preparing this expense.</p>}
          {transaction.expense && <p className="expense-muted">Portal expense: {transaction.expense.status}{transaction.expense.qb_entity_id ? ` · QuickBooks #${transaction.expense.qb_entity_id}` : ''}{transaction.expense.receipt_name ? ' · Receipt attached' : transaction.receipt_required ? ' · Receipt missing' : ''}</p>}
        </article>;
      })}</div>}
  </div>;
}
