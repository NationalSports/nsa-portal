const EXPENSE_TYPES = ['Expense', 'Other Expense', 'Cost of Goods Sold'];
const OWNERS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function check(condition, message) {
  if (!condition) { const error = new Error(message); error.status = 400; throw error; }
}
function textField(value, label, max) {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function validateInput(input) {
  check(input && UUID.test(input.id), 'A valid submission ID is required.');
  check(['national', 'methodic'].includes(input.company), 'Choose a business.');
  check(['business', 'personal'].includes(input.payment_kind), 'Choose who paid.');
  const amount = String(input.amount || '');
  check(/^\d{1,7}(\.\d{1,2})?$/.test(amount), 'Enter a positive USD amount with at most two decimal places.');
  const cents = Math.round(Number(amount) * 100);
  check(cents > 0 && cents <= 999999999, 'Amount is outside the supported range.');
  check(/^\d{4}-\d{2}-\d{2}$/.test(input.expense_date || '') && Number.isFinite(Date.parse(input.expense_date)) &&
    new Date(input.expense_date).toISOString().slice(0, 10) === input.expense_date &&
    input.expense_date <= new Date().toISOString().slice(0, 10), 'Enter a valid expense date that is not in the future.');
  check(input.currency === 'USD', 'Only USD expenses are supported.');
  return { id: input.id, company_key: input.company, merchant: textField(input.merchant, 'Merchant', 200),
    purpose: textField(input.purpose, 'Business purpose', 1000), expense_date: input.expense_date,
    amount_cents: cents, currency: 'USD', payment_kind: input.payment_kind,
    expense_account_id: textField(input.expense_account_id, 'Expense account', 30),
    payment_account_id: textField(input.payment_account_id, 'Payment or payable account', 30),
    vendor_id: input.payment_kind === 'personal' ? textField(input.vendor_id, 'Reimbursement payee', 30) : null };
}
function validateMappings(row, accounts, vendors) {
  const activeUSD = (a) => a && a.Active !== false && (!a.CurrencyRef?.value || a.CurrencyRef.value === 'USD');
  const expense = accounts.find(a => a.Id === row.expense_account_id);
  const payment = accounts.find(a => a.Id === row.payment_account_id);
  check(activeUSD(expense) && EXPENSE_TYPES.includes(expense.AccountType), 'Select an active USD expense or cost-of-goods account in this business.');
  check(activeUSD(payment) && (row.payment_kind === 'personal' ? payment.AccountType === 'Accounts Payable' : ['Bank', 'Credit Card'].includes(payment.AccountType)),
    'Select an active USD account of the correct payment type in this business.');
  const vendor = vendors.find(v => v.Id === row.vendor_id);
  if (row.payment_kind === 'personal') check(activeUSD(vendor), 'Select an active USD reimbursement payee in this business.');
  return { expense, payment, vendor };
}
function buildPayload(row, mapping) {
  const payload = {
    // 21 characters, within QBO's document-number limit; full identity is in memo/requestid.
    DocNumber: 'EXP-' + row.id.replace(/-/g, '').slice(0, 17),
    TxnDate: row.expense_date, CurrencyRef: { value: 'USD' },
    PrivateNote: `Portal expense ${row.id}; submitted by ${row.submitted_by}; ${row.merchant}: ${row.purpose}`,
    Line: [{ Amount: row.amount_cents / 100, Description: `${row.merchant}: ${row.purpose}`,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: { AccountRef: { value: mapping.expense.Id }, BillableStatus: 'NotBillable' } }],
  };
  if (row.payment_kind === 'personal') {
    payload.VendorRef = { value: mapping.vendor.Id };
    payload.APAccountRef = { value: mapping.payment.Id };
  } else {
    payload.PaymentType = mapping.payment.AccountType === 'Credit Card' ? 'CreditCard' : 'Cash';
    payload.AccountRef = { value: mapping.payment.Id };
  }
  return payload;
}
function matchesPosting(entity, payload) {
  const lines = (entity.Line || []).filter(l => l.DetailType === 'AccountBasedExpenseLineDetail');
  return entity.DocNumber === payload.DocNumber && entity.PrivateNote === payload.PrivateNote &&
    entity.TxnDate === payload.TxnDate && entity.CurrencyRef?.value === 'USD' &&
    Math.round(Number(entity.TotalAmt) * 100) === Math.round(payload.Line[0].Amount * 100) &&
    lines.length === 1 && Math.round(Number(lines[0].Amount) * 100) === Math.round(payload.Line[0].Amount * 100) &&
    lines[0].AccountBasedExpenseLineDetail.AccountRef?.value === payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value &&
    (payload.VendorRef ? entity.VendorRef?.value === payload.VendorRef.value && entity.APAccountRef?.value === payload.APAccountRef.value :
      entity.AccountRef?.value === payload.AccountRef.value && entity.PaymentType === payload.PaymentType);
}
function receiptBuffer(receipt) {
  if (!receipt) return null;
  check(['application/pdf', 'image/jpeg', 'image/png'].includes(receipt.type), 'Receipt must be a PDF, JPEG, or PNG.');
  check(typeof receipt.base64 === 'string' && receipt.base64.length <= 4194304 && /^[A-Za-z0-9+/]*={0,2}$/.test(receipt.base64), 'Invalid receipt data (maximum 3 MB).');
  const buffer = Buffer.from(receipt.base64, 'base64');
  check(buffer.length > 0 && buffer.length <= 3145728, 'Receipt must be between 1 byte and 3 MB.');
  const valid = receipt.type === 'application/pdf' ? buffer.subarray(0, 5).toString() === '%PDF-' :
    receipt.type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  check(valid, 'Receipt contents do not match the file type.');
  return { buffer, name: textField(receipt.name, 'Receipt name', 200), type: receipt.type };
}
module.exports = { EXPENSE_TYPES, OWNERS, UUID, check, validateInput, validateMappings, buildPayload, matchesPosting, receiptBuffer };
