import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import './ExpensesWorkspace.css';

export async function expenseRequest(body) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sign in with your staff account to manage expenses.');
  const response = await fetch('/.netlify/functions/financial-expenses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Expense service did not respond. Refresh or retry the same submission.'); }
  if (!response.ok || result.error) { const failure = new Error(result.error || 'Expense request failed.'); failure.status = response.status; throw failure; }
  return result;
}
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const accountLabel = account => `${account.AcctNum || 'No account number'} · ${account.Name}`;
const savedAccountLabel = (number, name) => `${number || 'No account number'} · ${name}`;
const accountSort = (a, b) => {
  if (!!a.AcctNum !== !!b.AcctNum) return a.AcctNum ? -1 : 1;
  return String(a.AcctNum || '').localeCompare(String(b.AcctNum || ''), undefined, { numeric: true }) || a.Name.localeCompare(b.Name);
};
const freshForm = () => ({ merchant: '', expense_date: new Date().toLocaleDateString('en-CA'), amount: '', purpose: '',
  payment_kind: 'personal', expense_account_id: '', payment_account_id: '', vendor_id: '', recurring_template_id: '', recurring_month: '' });
const statusLabel = { submitted: 'Ready to post', posting: 'Posting…', posted: 'Posted to QuickBooks', error: 'Needs attention', cancelled: 'Cancelled' };
const readReceipt = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, type: file.type, base64: String(reader.result).split(',')[1] });
  reader.onerror = () => reject(new Error('Could not read receipt.'));
  reader.readAsDataURL(file);
});

export default function ExpensesWorkspace() {
  const [company, setCompany] = useState('national');
  const [rows, setRows] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(freshForm);
  const [receipt, setReceipt] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorNote, setVendorNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('all');
  const [review, setReview] = useState(null);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const pendingSubmission = useRef(null);
  const operationInProgress = useRef(false);
  const reviewPanel = useRef(null);
  const fileInput = useRef(null);
  const formPanel = useRef(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!review) return;
    const previous = document.activeElement;
    reviewPanel.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, [review]);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setOptions(null); setRows([]); setRecurring([]); setError(''); setNote('');
    setForm(freshForm()); setReceipt(null); setVendors([]); setVendorSearch(''); setVendorNote('');
    setReview(null); setReceiptUrl(null); setNextOffset(null); setFilter('all'); pendingSubmission.current = null;
    Promise.allSettled([
      expenseRequest({ action: 'list', company }),
      expenseRequest({ action: 'options', company }),
    ]).then(results => {
      if (generation.current !== version) return;
      const [list, opts] = results;
      if (list.status === 'fulfilled') { setRows(list.value.expenses); setRecurring(list.value.recurring || []); setNextOffset(list.value.nextOffset); }
      if (opts.status === 'fulfilled') setOptions(opts.value);
      setError(results.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' '));
      setLoading(false);
    });
    return () => { generation.current++; };
  }, [company]);

  const accounts = (options?.accounts || []).filter(a => !a.CurrencyRef?.value || a.CurrencyRef.value === 'USD');
  const expenseAccounts = accounts.filter(a => ['Expense', 'Other Expense', 'Cost of Goods Sold'].includes(a.AccountType)).sort(accountSort);
  const paymentAccounts = accounts.filter(a => form.payment_kind === 'personal' ? a.AccountType === 'Accounts Payable' : ['Bank', 'Credit Card'].includes(a.AccountType)).sort(accountSort);
  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const run = async (key, fn) => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    const version = generation.current;
    setBusy(key); setError(''); setNote(''); setReceiptUrl(null);
    try { await fn(version); } catch (e) { if (version === generation.current) setError(e.message); }
    finally { operationInProgress.current = false; if (version === generation.current) setBusy(''); }
  };
  const refresh = async () => {
    const result = await expenseRequest({ action: 'list', company });
    setRows(result.expenses); setRecurring(result.recurring || []); setNextOffset(result.nextOffset);
  };
  const clearForm = () => {
    setForm(freshForm()); setReceipt(null); setVendors([]); setVendorSearch(''); setVendorNote(''); pendingSubmission.current = null;
    if (fileInput.current) fileInput.current.value = '';
  };
  const chooseRecurring = item => {
    setForm({ ...freshForm(), merchant: item.merchant, amount: item.default_amount_cents == null ? '' : (item.default_amount_cents / 100).toFixed(2),
      purpose: item.purpose, payment_kind: item.payment_kind, recurring_template_id: item.id, recurring_month: item.month });
    setReceipt(null); setVendors([]); setVendorSearch(''); setVendorNote(''); pendingSubmission.current = null;
    if (fileInput.current) fileInput.current.value = '';
    requestAnimationFrame(() => { formPanel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); formPanel.current?.querySelector('select')?.focus(); });
  };
  const submit = event => {
    event.preventDefault();
    run('submit', async () => {
      if (!pendingSubmission.current) {
        const file = receipt ? await readReceipt(receipt) : null;
        pendingSubmission.current = { ...form, action: 'submit', id: crypto.randomUUID(), company, currency: 'USD', realm_id: options.realm_id, receipt: file };
      }
      let result;
      try { result = await expenseRequest(pendingSubmission.current); }
      catch (failure) { if (failure.status >= 400 && failure.status < 500) pendingSubmission.current = null; throw failure; }
      setRows(prev => [result.expense, ...prev.filter(r => r.id !== result.expense.id)]);
      if (result.expense.recurring_template_id) setRecurring(prev => prev.map(item => item.id === result.expense.recurring_template_id ? { ...item, current_expense: result.expense } : item));
      pendingSubmission.current = null;
      clearForm();
      setNote('Expense submitted. Review the account mapping below, then post it to QuickBooks.');
    });
  };
  const searchVendors = () => run('vendors', async () => {
    const result = await expenseRequest({ action: 'vendors', company, search: vendorSearch });
    setVendors(result.vendors); update('vendor_id', '');
    setVendorNote(result.vendors.length ? `${result.vendors.length} matching payees${result.vendors.length === 50 ? ' (first 50; narrow your search)' : ''}.` : 'No matching payee. Add the reimbursement recipient as a vendor in QuickBooks, then search again.');
  });
  const posted = rows.filter(r => r.status === 'posted');
  const pending = rows.filter(r => !['posted', 'cancelled'].includes(r.status));
  const shown = rows.filter(r => filter === 'all' || (filter === 'pending' ? !['posted', 'cancelled'].includes(r.status) : r.status === filter));
  const retrySubmission = !!pendingSubmission.current;
  const selectedRecurring = recurring.find(item => item.id === form.recurring_template_id);
  const monthLabel = recurring[0]?.month ? new Date(`${recurring[0].month}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'This month';

  return <section className="expenses-workspace" aria-label="Expenses">
    <div className="expense-heading">
      <div><div className="expense-eyebrow">BUSINESS SPENDING</div><h2>Expenses</h2><p>Submit a receipt, choose the account, and send the expense to your business.</p></div>
      <label>Business<select aria-label="Business" value={company} disabled={!!busy || retrySubmission} onChange={e => setCompany(e.target.value)}>
        <option value="national">National Sports Apparel</option><option value="methodic">Methodic</option>
      </select></label>
    </div>
    {error && <div className="expense-message expense-error" role="alert">{error}</div>}
    {note && <div className="expense-message" role="status">{note}</div>}
    {receiptUrl && <div className="expense-message"><a href={receiptUrl} target="_blank" rel="noopener noreferrer">Open private receipt</a> · Link expires in 60 seconds.</div>}
    <div className="expense-tiles">
      <div><span>Awaiting posting</span><strong>{money(pending.reduce((sum, r) => sum + r.amount_cents, 0))}</strong><small>{pending.length} expenses</small></div>
      <div><span>Posted to QuickBooks</span><strong>{money(posted.reduce((sum, r) => sum + r.amount_cents, 0))}</strong><small>{posted.length} expenses</small></div>
      <div><span>Personal submissions</span><strong>{money(rows.filter(r => r.payment_kind === 'personal' && r.status !== 'cancelled').reduce((sum, r) => sum + r.amount_cents, 0))}</strong><small>Payment status is managed in QuickBooks</small></div>
    </div>
    <p className="expense-muted">Totals cover {rows.length} loaded submissions{nextOffset !== null ? '; load more below to include older expenses' : ''}.</p>
    <div className="expense-panel expense-recurring-panel">
      <div className="expense-heading"><div><h3>Monthly expenses</h3><p>Each schedule appears once per month for review before anything is posted to QuickBooks.</p></div><span className="expense-month">{monthLabel}</span></div>
      {!loading && !recurring.length && <p className="expense-muted">No monthly expenses are scheduled for this business.</p>}
      <div className="expense-recurring-grid">{recurring.map(item => {
        const occurrence = item.current_expense;
        return <article key={item.id} className={`expense-recurring-card${item.requires_accounting_split ? ' split' : ''}`}>
          <div className="expense-recurring-top"><span className="expense-frequency">Every month</span><span className={`expense-status ${occurrence?.status || ''}`}>{occurrence ? statusLabel[occurrence.status] : item.requires_accounting_split ? 'Split required' : 'Due'}</span></div>
          <h4>{item.label}</h4><p className="expense-muted">{item.merchant}</p>
          <strong>{item.default_amount_cents == null ? 'Enter monthly bill' : money(item.default_amount_cents)}</strong>
          {item.requires_accounting_split ? <p className="expense-split-note">Allocate principal to the loan liability and interest to interest expense in QuickBooks before recording this payment.</p> :
            <p className="expense-muted">The bill amount can change each month. Enter the current statement total and choose the live QBO account numbers.</p>}
          {occurrence ? <button type="button" disabled={!!busy} onClick={() => setReview(occurrence)}>View {monthLabel} entry</button> : item.requires_accounting_split ?
            <button type="button" disabled title="Principal and interest amounts are required before this can be posted safely.">Record split in QuickBooks</button> :
            <button type="button" className="expense-primary" disabled={!!busy || !options} onClick={() => chooseRecurring(item)}>Record {monthLabel}</button>}
        </article>;
      })}</div>
    </div>
    <div className="expense-panel" ref={formPanel}>
      <h3>Submit an expense</h3>
      {selectedRecurring && <div className="expense-message"><b>Recording {selectedRecurring.label} for {monthLabel}.</b> Merchant, purpose, and payment type come from the schedule; you can choose the current QuickBooks account numbers.{selectedRecurring.default_amount_cents == null && ' Enter this month’s statement amount.'} <button type="button" disabled={!!busy || retrySubmission} onClick={clearForm}>Clear</button></div>}
      {loading ? <p role="status">Loading expenses and QuickBooks accounts…</p> : !options ? <p>Account choices are unavailable. Check the business connection in QuickBooks Sync, then reload this tab.</p> : <form onSubmit={submit}>
        <fieldset disabled={!!busy || retrySubmission}>
          <div className="expense-form-grid">
            <label>Merchant<input required readOnly={!!selectedRecurring} maxLength={200} value={form.merchant} onChange={e => update('merchant', e.target.value)} placeholder="Where did you spend?" /></label>
            <label>Expense date<input required type="date" max={new Date().toLocaleDateString('en-CA')} value={form.expense_date} onChange={e => update('expense_date', e.target.value)} /></label>
            <label>Amount (USD)<input required readOnly={selectedRecurring?.default_amount_cents != null} type="number" min="0.01" max="9999999.99" step="0.01" value={form.amount} onChange={e => update('amount', e.target.value)} placeholder="0.00" /></label>
            <label>Who paid?<select disabled={!!selectedRecurring} value={form.payment_kind} onChange={e => setForm(prev => ({ ...prev, payment_kind: e.target.value, payment_account_id: '', vendor_id: '' }))}>
              <option value="personal">I paid personally · reimburse me</option><option value="business">Business bank account or card</option>
            </select></label>
            <label>QuickBooks expense account<select required value={form.expense_account_id} onChange={e => update('expense_account_id', e.target.value)}>
              <option value="">Choose an account number</option>{expenseAccounts.map(a => <option key={a.Id} value={a.Id}>{accountLabel(a)} · {a.AccountType}</option>)}
            </select></label>
            <label>{form.payment_kind === 'personal' ? 'Accounts payable account' : 'Paid from account'}<select required value={form.payment_account_id} onChange={e => update('payment_account_id', e.target.value)}>
              <option value="">Choose an account number</option>{paymentAccounts.map(a => <option key={a.Id} value={a.Id}>{accountLabel(a)} · {a.AccountType}</option>)}
            </select></label>
          </div>
          <p className="expense-account-help">Account numbers come directly from this business’s QuickBooks chart. Choose a different account here before submitting. If you renumber an account in QuickBooks, refresh this tab to bring in the change.</p>
          {form.payment_kind === 'personal' && <div className="expense-payee">
            <label>Find your reimbursement payee in QuickBooks<div className="expense-inline"><input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} placeholder="Your name or reimbursement vendor" /><button type="button" disabled={vendorSearch.trim().length < 2} onClick={searchVendors}>Search</button></div></label>
            <label>Reimbursement payee<select required value={form.vendor_id} onChange={e => update('vendor_id', e.target.value)}><option value="">Choose who should be reimbursed</option>{vendors.map(v => <option key={v.Id} value={v.Id}>{v.DisplayName}</option>)}</select></label>
            {vendorNote && <p role="status" className="expense-muted">{vendorNote}</p>}
          </div>}
          <label>Business purpose<textarea required readOnly={!!selectedRecurring} maxLength={1000} rows={2} value={form.purpose} onChange={e => update('purpose', e.target.value)} placeholder="What was this expense for?" /></label>
          <label className="expense-upload">Receipt · PDF, JPG, or PNG up to 3 MB<input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => {
            const file = e.target.files?.[0];
            if (file && (file.size > 3145728 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) { setError('Choose a PDF, JPG, or PNG up to 3 MB.'); e.target.value = ''; setReceipt(null); return; }
            setReceipt(file || null); setError('');
          }} /><small>Receipts stay private in the portal. Receipt files are not copied to QuickBooks in this version.</small></label>
        </fieldset>
        <div className="expense-form-footer"><p>{form.payment_kind === 'personal' ? 'Posts as an unpaid QuickBooks bill to your reimbursement payee. Reimbursement is paid separately in QuickBooks.' : 'Posts as a QuickBooks expense against the selected bank or credit card account. Match the bank feed transaction to avoid booking it twice.'}</p>
          <button className="expense-primary" type="submit" disabled={!!busy}>{busy === 'submit' ? 'Submitting…' : retrySubmission ? 'Retry same submission' : 'Submit expense'}</button></div>
        {retrySubmission && <p className="expense-muted">This submission may have been saved. Retry the same details to recover its status before entering another expense.</p>}
      </form>}
    </div>
    <div className="expense-panel">
      <div className="expense-heading"><h3>Expense submissions</h3><div className="expense-inline"><select aria-label="Filter expenses" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All expenses</option><option value="pending">Awaiting posting</option><option value="posted">Posted</option><option value="error">Needs attention</option></select><button disabled={!!busy || loading} onClick={() => run('refresh', refresh)}>Refresh</button></div></div>
      {!loading && !shown.length && <div className="expense-empty"><h4>{rows.length ? 'No expenses match this filter' : 'Your next expense starts here'}</h4><p>Submit the merchant, amount, business purpose, and account mapping above.</p></div>}
      <div className="expense-list">{shown.map(row => <article key={row.id} className="expense-row">
        <div><strong>{row.merchant}</strong><div className="expense-muted">{row.expense_date} · {row.payment_kind === 'personal' ? 'Personal reimbursement' : 'Business paid'}{row.recurring_month && ' · Monthly schedule'}</div><p>{row.purpose}</p>
          <div className="expense-mapping">{savedAccountLabel(row.expense_account_number, row.expense_account_name)}<span> → </span>{savedAccountLabel(row.payment_account_number, row.payment_account_name)}{row.vendor_name && ` · Payee: ${row.vendor_name}`}</div>
          {row.last_error && <p className="expense-error-text">{row.last_error}</p>}
        </div>
        <div className="expense-row-actions"><strong>{money(row.amount_cents)}</strong><span className={`expense-status ${row.status}`}>{statusLabel[row.status]}</span>
          {row.qb_entity_id && <small>QuickBooks {row.qb_entity_type === 'Purchase' ? 'Expense' : 'Bill'} #{row.qb_entity_id}</small>}
          <div className="expense-inline">{row.receipt_name && <button disabled={!!busy} onClick={() => run('receipt', async () => {
            const result = await expenseRequest({ action: 'receipt', company, id: row.id }); setReceiptUrl(result.url);
          })}>Receipt</button>}
          {!['posted', 'cancelled'].includes(row.status) && <button disabled={!!busy} className="expense-primary" onClick={() => setReview(row)}>{row.status === 'submitted' ? 'Review & post' : 'Review & retry'}</button>}</div>
        </div>
      </article>)}</div>
      {nextOffset !== null && <button disabled={!!busy} onClick={() => run('more', async () => {
        const result = await expenseRequest({ action: 'list', company, offset: nextOffset });
        setRows(prev => [...prev, ...result.expenses.filter(r => !prev.some(p => p.id === r.id))]); setNextOffset(result.nextOffset);
      })}>Load older expenses</button>}
    </div>
    {review && <div ref={reviewPanel} className="expense-review" role="dialog" aria-modal="true" aria-labelledby="expense-review-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setReview(null); }
      if (event.key === 'Tab') {
        const buttons = [...reviewPanel.current.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="expense-panel"><h3 id="expense-review-title">{review.status === 'posted' ? 'QuickBooks expense details' : 'Post expense to QuickBooks'}</h3><p><b>{review.merchant} · {money(review.amount_cents)}</b></p>
        <dl><dt>Business</dt><dd>{company === 'national' ? 'National Sports Apparel' : 'Methodic'}</dd><dt>Date</dt><dd>{review.expense_date}</dd><dt>Expense account</dt><dd>{savedAccountLabel(review.expense_account_number, review.expense_account_name)}</dd><dt>{review.payment_kind === 'personal' ? 'Accounts payable' : 'Paid from'}</dt><dd>{savedAccountLabel(review.payment_account_number, review.payment_account_name)}</dd>{review.vendor_name && <><dt>Reimburse</dt><dd>{review.vendor_name}</dd></>}</dl>
        <p>{review.payment_kind === 'personal' ? 'Creates an unpaid bill. This records the expense and amount owed; it does not send a reimbursement.' : 'Creates an expense in this business’s books. Match any imported bank transaction to this expense.'}</p>
        <p className="expense-muted">{review.receipt_name ? 'Receipt is stored privately in the portal.' : 'No receipt attached.'}</p>
        {review.status === 'submitted' && <p className="expense-muted">Need to change these details? <button disabled={!!busy} onClick={() => run('cancel', async () => {
          const result = await expenseRequest({ action: 'cancel', company, id: review.id });
          setRows(prev => prev.map(r => r.id === result.expense.id ? result.expense : r)); setReview(null);
          if (result.expense.recurring_template_id) setRecurring(prev => prev.map(item => item.id === result.expense.recurring_template_id ? { ...item, current_expense: null } : item));
          setNote('Submission cancelled. Enter a new expense with the corrected details.');
        })}>Cancel submission</button></p>}
        {error && <p className="expense-error-text" role="alert">{error}</p>}
        <div className="expense-inline"><button disabled={!!busy} onClick={() => setReview(null)}>{review.status === 'posted' ? 'Close' : 'Cancel'}</button>{!['posted', 'cancelled'].includes(review.status) && <button className="expense-primary" disabled={!!busy} onClick={() => run('post', async () => {
          const result = await expenseRequest({ action: 'post', company, id: review.id });
          setRows(prev => prev.map(r => r.id === result.expense.id ? result.expense : r)); setReview(null);
          if (result.expense.recurring_template_id) setRecurring(prev => prev.map(item => item.id === result.expense.recurring_template_id ? { ...item, current_expense: result.expense } : item));
          setNote('Posted to QuickBooks. ' + (review.payment_kind === 'personal' ? 'The reimbursement bill is ready for payment there.' : 'The expense is recorded against the selected account.'));
        })}>{busy === 'post' ? 'Posting…' : 'Post to QuickBooks'}</button>}</div>
      </div>
    </div>}
  </section>;
}
