import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import './CardFeedPanel.css';

const currentMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const money = (cents, currency = 'USD') => {
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : null;
  return code ? new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format((cents || 0) / 100)
    : `${((cents || 0) / 100).toFixed(2)} ${currency || 'Unknown currency'}`;
};
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
    script.onload = () => resolve(window.Plaid); script.onerror = () => { script.remove(); reject(new Error('Secure card connection could not be loaded.')); };
    document.head.appendChild(script);
  });
}

function csvCell(value, sanitizeText = true) {
  const text = String(value ?? '');
  // Spreadsheet applications may evaluate formula-looking CSV cells even when quoted.
  const safe = sanitizeText && /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function reportCsv(transactions) {
  const rows = [['Date', 'Card', 'Merchant', 'Description', 'Amount', 'Currency', 'Status', 'Pending', 'Provider removed', 'QBO expense account', 'Receipt']];
  for (const row of transactions) rows.push([row.transaction_date, `${row.account?.name || ''} ${row.account?.mask ? `••${row.account.mask}` : ''}`.trim(),
    row.merchant_name || '', row.description, (row.amount_cents / 100).toFixed(2), row.currency || 'UNKNOWN',
    row.pending ? 'Pending' : row.provider_removed ? 'Removed' : statusLabel[row.status] || row.status, row.pending ? 'Yes' : 'No', row.provider_removed ? 'Yes' : 'No',
    [row.expense_account_number, row.expense_account_name].filter(Boolean).join(' · '), row.expense?.receipt_name ? 'Attached' : row.receipt_required ? 'Missing' : 'Not required']);
  return rows.map(row => row.map((value, index) => csvCell(value, index !== 4)).join(',')).join('\n');
}
function downloadReport(month, transactions) {
  const blob = new Blob([reportCsv(transactions)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `card-expenses-${month}.csv`; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function CardFeedPanel({ company, options, onPrepare, onCompanyChange, disablePrepare = false, refreshKey = 0 }) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const viewVersion = useRef(0);
  const requestSerial = useRef(0);
  const actionBusy = useRef(null);
  const oauthResume = useRef('');
  const linkHandler = useRef(null);
  const usdAccounts = useMemo(() => (options?.accounts || []).filter(account => !account.CurrencyRef?.value || account.CurrencyRef.value === 'USD'), [options]);
  const realmAccounts = usdAccounts;
  const expenseAccounts = useMemo(() => realmAccounts.filter(account => ['Expense', 'Other Expense', 'Cost of Goods Sold'].includes(account.AccountType)), [realmAccounts]);
  const paymentAccounts = useMemo(() => realmAccounts.filter(account => ['Credit Card', 'Bank'].includes(account.AccountType)), [realmAccounts]);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = async (nextMonth = month, version = viewVersion.current, request = requestSerial.current) => {
    if (!actionBusy.current) setBusy('load');
    setError('');
    try {
      const result = await cardFeedRequest({ action: 'list', company, month: nextMonth });
      if (version !== viewVersion.current || request !== requestSerial.current) return;
      setData(result); setDrafts({});
    } catch (failure) {
      if (version !== viewVersion.current || request !== requestSerial.current) return;
      setError(failure.message); setData(null);
    } finally {
      if (version === viewVersion.current && request === requestSerial.current && !actionBusy.current) setBusy('');
    }
  };
  useEffect(() => {
    const version = ++viewVersion.current;
    const request = ++requestSerial.current;
    actionBusy.current = null;
    setData(null); setDrafts({}); setBusy(''); setError(''); setNote('');
    setStatusFilter('all');
    load(month, version, request);
    return () => { viewVersion.current += 1; requestSerial.current += 1; actionBusy.current = null; };
  }, [company, month, refreshKey]);
  useEffect(() => () => { linkHandler.current?.destroy(); }, []);

  const run = async (key, action, success, allowDuringLoad = false) => {
    if (actionBusy.current || (!allowDuringLoad && busy === 'load')) return;
    const version = viewVersion.current;
    const request = ++requestSerial.current;
    const token = {};
    actionBusy.current = token;
    setBusy(key); setError(''); setNote('');
    try {
      const result = await action();
      if (version !== viewVersion.current || request !== requestSerial.current) return;
      if (result) {
        setData(result); setDrafts({});
        if (success) setNote(typeof success === 'function' ? success(result) : success);
      } else await load(month, version, request);
    } catch (failure) {
      if (version === viewVersion.current && request === requestSerial.current) setError(failure.message);
    } finally {
      if (actionBusy.current === token) {
        actionBusy.current = null;
        if (version === viewVersion.current && request === requestSerial.current) setBusy('');
      }
    }
  };
  const launchLink = async (linkToken, state = { company, month }) => {
    const Plaid = await loadPlaid();
    return new Promise((resolve, reject) => {
      let completed = false;
      const handler = Plaid.create({ token: linkToken,
        receivedRedirectUri: new URL(window.location.href).searchParams.has('oauth_state_id') ? window.location.href : undefined,
        onSuccess: async (publicToken, metadata) => { completed = true; try {
          const result = await cardFeedRequest({ action: 'exchange', company: state.company, month: state.month, public_token: publicToken, institution: metadata?.institution });
          sessionStorage.removeItem(OAUTH_STATE_KEY);
          const clean = new URL(window.location.href); clean.searchParams.delete('oauth_state_id'); window.history.replaceState({}, '', clean.toString()); resolve(result);
        } catch (failure) { reject(failure); } finally { handler.destroy(); } },
        onExit: failure => { handler.destroy(); if (!completed) {
          sessionStorage.removeItem(OAUTH_STATE_KEY);
          const clean = new URL(window.location.href); clean.searchParams.delete('oauth_state_id'); window.history.replaceState({}, '', clean.toString());
          if (failure) reject(new Error(failure.display_message || failure.error_message || 'Card connection was not completed.')); else resolve(null);
        } },
      });
      linkHandler.current = handler;
      handler.open();
    });
  };
  const connect = () => run('connect', async () => {
    const state = { company, month, created_at: Date.now() };
    const { link_token, expiration } = await cardFeedRequest({ action: 'link_token', company: state.company });
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ ...state, link_token, expiration }));
    return launchLink(link_token, state);
  }, 'Card connected. Cleared transactions will appear as the provider makes them available.');
  const refreshCards = () => run('sync', () => cardFeedRequest({ action: 'sync', company, month }), result => {
    const issues = (result.sync || []).filter(item => item.error || item.skipped);
    const suffix = (result.connections || []).length > 3 ? ' Refresh again to check the remaining connections.' : '';
    return (issues.length ? `Refresh finished; ${issues.length} connections failed or are already refreshing. Check connection status below.` : 'Card transactions refreshed.') + suffix;
  });
  useEffect(() => {
    if (!new URL(window.location.href).searchParams.has('oauth_state_id')) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) || 'null');
      if (!['national', 'methodic'].includes(saved?.company) || !/^\d{4}-\d{2}$/.test(saved?.month || '') || !saved?.link_token || (saved.expiration && Date.parse(saved.expiration) < Date.now())) {
        sessionStorage.removeItem(OAUTH_STATE_KEY); return;
      }
      if (saved.company !== company) { onCompanyChange?.(saved.company); return; }
      if (saved.month !== month) { setMonth(saved.month); return; }
      if (oauthResume.current === saved.link_token) return;
      oauthResume.current = saved.link_token;
      run('connect', () => launchLink(saved.link_token, saved), 'Card connected. Cleared transactions will appear as the provider makes them available.', true);
    } catch (_) { sessionStorage.removeItem(OAUTH_STATE_KEY); }
    // Resume only on the OAuth return navigation.
  }, [company, month, onCompanyChange]);
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
      <div className="expense-inline"><label>Report month<input aria-label="Card report month" type="month" value={month} disabled={!!busy} max={currentMonth()} onChange={event => setMonth(event.target.value)} /></label>
        <button type="button" disabled={!!busy || !data?.configured} onClick={refreshCards}>{busy === 'sync' ? 'Syncing…' : 'Refresh cards'}</button>
        <button type="button" className="expense-primary" disabled={!!busy || !data?.configured} onClick={connect}>{busy === 'connect' ? 'Connecting…' : 'Connect card'}</button></div></div>
    {error && <div className="expense-message expense-error" role="alert">{error}</div>}
    {note && <div className="expense-message" role="status">{note}</div>}
    {data && !data.configured && <div className="card-feed-setup"><strong>Card connections need setup.</strong><p>Your portal administrator must activate the card feed before you can connect an account. You’ll sign in securely through Plaid.</p></div>}
    {report && <>
      <div className="card-report-tiles"><div><span>Monthly gross spend</span><strong>{money(report.total_cents)}</strong><small>{report.count} cleared USD charges · excludes refunds</small></div>
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
    {data && <div className="card-inbox"><div className="expense-heading"><div><h4>Transaction inbox</h4><span className="expense-muted">{rules.length} merchant rules</span></div><label>Status<select aria-label="Card transaction status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="new">Needs category</option><option value="ready">Ready</option><option value="submitted">Awaiting QBO</option><option value="posted">Posted</option><option value="ignored">Ignored</option><option value="removed">Removed</option></select></label></div>
      {!transactions.length && <div className="expense-empty"><h4>No transactions in this month</h4><p>Connect or refresh a card, or choose a different report month.</p></div>}
      {!!transactions.length && !transactions.some(transaction => statusFilter === 'all' || transaction.status === statusFilter) && <div className="expense-empty"><p>No transactions match this status.</p></div>}
      {transactions.filter(transaction => statusFilter === 'all' || transaction.status === statusFilter).map(transaction => {
        const values = draft(transaction); const refund = transaction.amount_cents < 0; const foreignCurrency = transaction.currency !== 'USD';
        const unavailable = transaction.pending || transaction.provider_removed || foreignCurrency || refund || ['submitted', 'posted', 'ignored', 'removed'].includes(transaction.status);
        const hasUnsavedDraft = !!drafts[transaction.id];
        const cardRealmMatches = !!options?.realm_id && (
          transaction.account?.qbo_realm_id && String(transaction.account.qbo_realm_id) === String(options.realm_id)
          && transaction.expense_realm_id && String(transaction.expense_realm_id) === String(options.realm_id));
        return <article className="card-transaction" key={transaction.id}>
          <div className="card-transaction-main"><div><strong>{transaction.merchant_name || transaction.description}</strong><div className="expense-muted">{transaction.transaction_date} · {transaction.account?.name}{transaction.account?.mask && ` ••${transaction.account.mask}`} · {transaction.category_primary || 'Uncategorized'}</div></div>
            <div className="card-transaction-amount"><strong>{money(transaction.amount_cents, transaction.currency || 'UNKNOWN')}</strong><span className={`expense-status ${transaction.status}`}>{transaction.provider_removed ? 'Removed' : transaction.pending ? 'Pending' : refund ? 'Refund' : statusLabel[transaction.status]}</span></div></div>
          {!unavailable && <div className="card-category-grid"><label>QBO expense account<select aria-label={`Expense account for ${transaction.merchant_name || transaction.description}`} value={values.expense_account_id} onChange={event => setDraft(transaction.id, { expense_account_id: event.target.value })}><option value="">Choose account number</option>{expenseAccounts.map(account => <option key={account.Id} value={account.Id}>{accountLabel(account)}</option>)}</select></label>
            <label>Business purpose<input aria-label={`Purpose for ${transaction.merchant_name || transaction.description}`} maxLength={1000} value={values.purpose} onChange={event => setDraft(transaction.id, { purpose: event.target.value })} /></label>
            <div className="card-checks"><label><input type="checkbox" checked={values.receipt_required} onChange={event => setDraft(transaction.id, { receipt_required: event.target.checked })} /> Receipt required</label><label><input type="checkbox" checked={values.remember} onChange={event => setDraft(transaction.id, { remember: event.target.checked })} /> Remember merchant rule</label></div>
            <div className="expense-inline"><button type="button" disabled={!!busy} onClick={() => run(`ignore-${transaction.id}`, () => cardFeedRequest({ action: 'ignore', company, month, transaction_id: transaction.id }), 'Transaction ignored.')}>Ignore</button>
              <button type="button" disabled={!!busy || !values.expense_account_id || !values.purpose.trim()} onClick={() => run(`category-${transaction.id}`, () => cardFeedRequest({ action: 'categorize', company, month, transaction_id: transaction.id, ...values }), 'Category saved.')}>Save category</button>
              {transaction.status === 'ready' && <button type="button" className="expense-primary" disabled={!!busy || disablePrepare || hasUnsavedDraft || !transaction.account?.qbo_payment_account_id || !cardRealmMatches} onClick={() => onPrepare(transaction)}>Prepare expense</button>}</div></div>}
          {transaction.pending && <p className="expense-muted">This charge can be categorized after it clears and its final amount is available.</p>}
          {transaction.status === 'ignored' && !transaction.pending && !transaction.provider_removed && !foreignCurrency && !refund && <button type="button" disabled={!!busy} onClick={() => run(`restore-${transaction.id}`, () => cardFeedRequest({ action: 'restore', company, month, transaction_id: transaction.id }), 'Transaction returned to review.')}>Return to review</button>}
          {foreignCurrency && <p className="expense-error-text">This foreign-currency charge is unavailable for the USD expense workflow.</p>}
          {transaction.requires_reconciliation && <p className="expense-error-text"><strong>QuickBooks reconciliation required.</strong> The bank changed or removed this charge after submission. Review the saved expense and QuickBooks before making further changes.</p>}
          {transaction.status === 'ready' && !transaction.account?.qbo_payment_account_id && <p className="expense-error-text">Map the connected card to its QuickBooks account before preparing this expense.</p>}
          {transaction.status === 'ready' && transaction.account?.qbo_payment_account_id && !cardRealmMatches && <p className="expense-error-text">Verify this card and category against the current QuickBooks connection. Remap the card and save its category before preparing it.</p>}
          {transaction.expense && <p className="expense-muted">Portal expense: {transaction.expense.status}{transaction.expense.qb_entity_id ? ` · QuickBooks #${transaction.expense.qb_entity_id}` : ''}{transaction.expense.receipt_name ? ' · Receipt attached' : transaction.receipt_required ? ' · Receipt missing' : ''}</p>}
        </article>;
      })}</div>}
  </div>;
}
