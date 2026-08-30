// Staff-only Methodic <-> National intercompany accounting.
//
// Methodic posts an A/R invoice in the Methodic QBO realm. National posts the
// matching A/P vendor bill in the National QBO realm. A payment records both a
// National BillPayment and a Methodic Payment; this does not initiate a bank
// transfer. Local IDs are saved after each external success so every action is
// resumable and idempotent across partial failures.
const { corsHeaders, verifyUser } = require('./_shared');
const { getStoredTokens, getValidAccessToken, qbRequest } = require('./_qb');

const FINANCE_ROLES = new Set(['admin', 'super_admin', 'accounting']);
const CONFIG_TEXT_FIELDS = [
  'national_vendor_qb_id', 'national_expense_account_qb_id', 'national_payment_account_qb_id',
  'methodic_customer_qb_id', 'methodic_income_item_qb_id', 'methodic_deposit_account_qb_id',
  'methodic_tax_code_qb_id',
];
const CONFIG_BOOL_FIELDS = [
  'national_sandbox', 'methodic_sandbox', 'invoice_sync_enabled', 'payment_sync_enabled',
];

const reply = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });
const cleanText = (value, max = 160) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
};
const cents = (value) => {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error('Invalid billing amount.');
  return amount;
};
const isoDate = (value, label) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} must be YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error(`${label} is invalid.`);
  }
  return raw;
};
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const qboEscape = (value) => String(value || '').replace(/'/g, "\\'");

function requireFinance(actor) {
  if (!FINANCE_ROLES.has(actor.role)) {
    const error = new Error('Accounting or admin role required.');
    error.status = 403;
    throw error;
  }
}

function quoteTotalCents(request) {
  if (request?.quoted_unit_cost_cents == null) return null;
  return cents(Number(request.quoted_unit_cost_cents) * Number(request.quantity || 0) + Number(request.quoted_setup_cost_cents || 0));
}

function buildMethodicInvoice(request, config) {
  const amount = cents(request.billing_amount_cents);
  if (!amount) throw new Error('Billing amount must be greater than zero.');
  return {
    CustomerRef: { value: config.methodic_customer_qb_id },
    TxnDate: request.billing_invoice_date,
    DueDate: request.billing_due_date,
    DocNumber: request.methodic_invoice_number,
    PrivateNote: `Methodic intercompany invoice for National ${request.sales_order_id} / ${request.request_number}`,
    Line: [{
      Amount: amount / 100,
      Description: `${request.title || 'Methodic goods'} · National ${request.sales_order_id}`,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: config.methodic_income_item_qb_id },
        Qty: 1,
        UnitPrice: amount / 100,
        TaxCodeRef: { value: config.methodic_tax_code_qb_id },
      },
    }],
  };
}

function buildNationalBill(request, config) {
  const amount = cents(request.billing_amount_cents);
  if (!amount) throw new Error('Billing amount must be greater than zero.');
  return {
    VendorRef: { value: config.national_vendor_qb_id },
    TxnDate: request.billing_invoice_date,
    DueDate: request.billing_due_date,
    DocNumber: request.methodic_invoice_number,
    PrivateNote: `Methodic intercompany bill for ${request.sales_order_id} / ${request.request_number}`,
    Line: [{
      Amount: amount / 100,
      Description: `${request.title || 'Methodic goods'} · ${request.sales_order_id}`,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: config.national_expense_account_qb_id },
      },
    }],
  };
}

function buildNationalBillPayment(request, payment, config) {
  const amount = cents(payment.amount_cents);
  return {
    VendorRef: { value: config.national_vendor_qb_id },
    TxnDate: payment.payment_date,
    DocNumber: payment.payment_number,
    TotalAmt: amount / 100,
    PayType: 'Check',
    CheckPayment: { BankAccountRef: { value: config.national_payment_account_qb_id } },
    PrivateNote: `Methodic payment ${payment.payment_number} · ${request.request_number}`,
    Line: [{ Amount: amount / 100, LinkedTxn: [{ TxnId: request.national_qb_transaction_id, TxnType: 'Bill' }] }],
  };
}

function buildMethodicPayment(request, payment, config) {
  const amount = cents(payment.amount_cents);
  return {
    CustomerRef: { value: config.methodic_customer_qb_id },
    TxnDate: payment.payment_date,
    PaymentRefNum: payment.payment_number,
    TotalAmt: amount / 100,
    DepositToAccountRef: { value: config.methodic_deposit_account_qb_id },
    PrivateNote: `National payment ${payment.payment_number} · ${request.request_number}`,
    Line: [{ Amount: amount / 100, LinkedTxn: [{ TxnId: request.methodic_qb_transaction_id, TxnType: 'Invoice' }] }],
  };
}

function qboFault(data) {
  return data?.Fault?.Error?.map((error) => error.Detail || error.Message).filter(Boolean).join('; ') || null;
}

async function companyClient(admin, company, sandbox) {
  const { access_token, realm_id } = await getValidAccessToken(admin, company);
  const basePath = `/v3/company/${realm_id}`;
  return {
    query: async (query) => {
      const result = await qbRequest('GET', `${basePath}/query?query=${encodeURIComponent(query)}`, access_token, null, sandbox);
      if (result.status < 200 || result.status >= 300 || qboFault(result.data)) throw new Error(`${company} QuickBooks query failed: ${qboFault(result.data) || result.status}`);
      return result.data?.QueryResponse || {};
    },
    create: async (entity, payload) => {
      const result = await qbRequest('POST', `${basePath}/${entity.toLowerCase()}`, access_token, payload, sandbox);
      if (result.status < 200 || result.status >= 300 || qboFault(result.data)) throw new Error(`${company} QuickBooks ${entity} failed: ${qboFault(result.data) || result.status}`);
      return result.data?.[entity];
    },
  };
}

async function findOne(client, entity, field, value) {
  const response = await client.query(`SELECT Id, ${field}, TotalAmt FROM ${entity} WHERE ${field} = '${qboEscape(value)}' MAXRESULTS 2`);
  const rows = response?.[entity] || [];
  if (rows.length > 1) throw new Error(`Multiple ${entity} records use ${field} ${value}; no transaction was sent.`);
  return rows[0] || null;
}

async function addEvent(admin, requestId, actorId, eventType, message, metadata = {}) {
  const { error } = await admin.from('methodic_request_events').insert({
    request_id: requestId, actor_id: actorId, event_type: eventType,
    message: cleanText(message, 1000), metadata,
  });
  if (error) console.error('[methodic-accounting] audit event:', error.message);
}

async function getConfig(admin) {
  const { data, error } = await admin.from('methodic_accounting_config').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;
  return data || { id: 'default' };
}

async function getRequest(admin, id) {
  const requestId = cleanText(id, 80);
  if (!requestId) throw new Error('Methodic request id is required.');
  const { data, error } = await admin.from('methodic_requests').select('*').eq('id', requestId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Methodic request not found.');
  return data;
}

async function connectionStatus(admin) {
  const [national, methodic] = await Promise.all([
    getStoredTokens(admin, 'national'), getStoredTokens(admin, 'methodic'),
  ]);
  return {
    national: { connected: !!national, realm_id: national?.realm_id || null },
    methodic: { connected: !!methodic, realm_id: methodic?.realm_id || null },
  };
}

async function status(admin, body) {
  const config = await getConfig(admin);
  let payments = [];
  if (body.id) {
    const result = await admin.from('methodic_payments').select('*').eq('request_id', cleanText(body.id, 80))
      .order('created_at', { ascending: false }).limit(100);
    if (result.error) throw result.error;
    payments = result.data || [];
  }
  return { config, connections: await connectionStatus(admin), payments };
}

async function saveConfig(admin, body, actor) {
  requireFinance(actor);
  const patch = { id: 'default', updated_by: actor.teamMemberId };
  CONFIG_TEXT_FIELDS.forEach((key) => { if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = cleanText(body[key], 120); });
  CONFIG_BOOL_FIELDS.forEach((key) => { if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key] === true; });
  if (patch.invoice_sync_enabled) {
    const merged = { ...await getConfig(admin), ...patch };
    const required = ['national_vendor_qb_id', 'national_expense_account_qb_id', 'methodic_customer_qb_id', 'methodic_income_item_qb_id', 'methodic_tax_code_qb_id'];
    if (required.some((key) => !merged[key])) throw new Error('Complete every invoice and bill mapping before enabling invoice sync.');
  }
  if (patch.payment_sync_enabled) {
    const merged = { ...await getConfig(admin), ...patch };
    if (!merged.invoice_sync_enabled || !merged.national_payment_account_qb_id || !merged.methodic_deposit_account_qb_id) {
      throw new Error('Enable invoice sync and complete both payment-account mappings first.');
    }
  }
  const { data, error } = await admin.from('methodic_accounting_config').upsert(patch, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function prepare(admin, body, actor) {
  requireFinance(actor);
  const request = await getRequest(admin, body.id);
  if (request.methodic_qb_transaction_id || request.national_qb_transaction_id) throw new Error('Posted accounting details cannot be changed. Resolve or void the linked QuickBooks transactions first.');
  const invoiceDate = isoDate(body.billing_invoice_date || today(), 'Invoice date');
  const dueDate = isoDate(body.billing_due_date || plusDays(invoiceDate, 30), 'Due date');
  if (dueDate < invoiceDate) throw new Error('Due date cannot be before the invoice date.');
  const amount = cents(body.billing_amount_cents == null ? quoteTotalCents(request) : body.billing_amount_cents);
  if (!amount) throw new Error('Billing amount must be greater than zero.');
  const invoiceNumber = cleanText(body.methodic_invoice_number || request.methodic_invoice_number || request.request_number, 120);
  const patch = {
    billing_amount_cents: amount,
    billing_invoice_date: invoiceDate,
    billing_due_date: dueDate,
    methodic_invoice_number: invoiceNumber,
    billing_status: 'ready',
    billing_error: null,
    updated_by: actor.teamMemberId,
  };
  const { data, error } = await admin.from('methodic_requests').update(patch).eq('id', request.id).select('*').single();
  if (error) throw error;
  await addEvent(admin, request.id, actor.teamMemberId, 'billing_prepared',
    `Prepared Methodic invoice ${invoiceNumber} for $${(amount / 100).toFixed(2)}.`, { amount_cents: amount, invoice_date: invoiceDate, due_date: dueDate });
  return data;
}

function requireInvoiceConfig(config) {
  if (!config.invoice_sync_enabled) throw new Error('Methodic invoice sync is not enabled.');
  const labels = {
    national_vendor_qb_id: 'National Methodic vendor',
    national_expense_account_qb_id: 'National Methodic expense account',
    methodic_customer_qb_id: 'Methodic National customer',
    methodic_income_item_qb_id: 'Methodic income item',
    methodic_tax_code_qb_id: 'Methodic tax code',
  };
  for (const [key, label] of Object.entries(labels)) if (!config[key]) throw new Error(`${label} mapping is required.`);
}

async function syncInvoiceAndBill(admin, body, actor) {
  requireFinance(actor);
  let request = await getRequest(admin, body.id);
  const config = await getConfig(admin);
  requireInvoiceConfig(config);
  if (!request.billing_amount_cents || !request.billing_invoice_date || !request.billing_due_date || !request.methodic_invoice_number) {
    throw new Error('Prepare billing details before syncing to QuickBooks.');
  }
  if (!['ordered', 'confirmed', 'in_production', 'quality_check', 'shipped', 'delivered'].includes(request.order_status)) {
    throw new Error('The Methodic order must be placed before intercompany billing is posted.');
  }
  await admin.from('methodic_requests').update({ billing_status: 'syncing', billing_error: null, billing_last_attempt_at: new Date().toISOString(), updated_by: actor.teamMemberId }).eq('id', request.id);
  try {
    const [methodicClient, nationalClient] = await Promise.all([
      companyClient(admin, 'methodic', config.methodic_sandbox),
      companyClient(admin, 'national', config.national_sandbox),
    ]);

    if (!request.methodic_qb_transaction_id) {
      let invoice = await findOne(methodicClient, 'Invoice', 'DocNumber', request.methodic_invoice_number);
      if (!invoice) invoice = await methodicClient.create('Invoice', buildMethodicInvoice(request, config));
      if (!invoice?.Id) throw new Error('Methodic QuickBooks did not return an invoice id.');
      const saved = await admin.from('methodic_requests').update({
        methodic_qb_transaction_id: invoice.Id, billing_status: 'partial', updated_by: actor.teamMemberId,
      }).eq('id', request.id).select('*').single();
      if (saved.error) throw saved.error;
      request = saved.data;
      await addEvent(admin, request.id, actor.teamMemberId, 'methodic_invoice_posted',
        `Methodic invoice ${request.methodic_invoice_number} posted to Methodic QuickBooks.`, { qb_invoice_id: invoice.Id });
    }

    if (!request.national_qb_transaction_id) {
      let bill = await findOne(nationalClient, 'Bill', 'DocNumber', request.methodic_invoice_number);
      if (!bill) bill = await nationalClient.create('Bill', buildNationalBill(request, config));
      if (!bill?.Id) throw new Error('National QuickBooks did not return a bill id.');
      const saved = await admin.from('methodic_requests').update({
        national_qb_transaction_id: bill.Id, billing_status: 'partial', updated_by: actor.teamMemberId,
      }).eq('id', request.id).select('*').single();
      if (saved.error) throw saved.error;
      request = saved.data;
      await addEvent(admin, request.id, actor.teamMemberId, 'national_bill_posted',
        `National vendor bill ${request.methodic_invoice_number} posted to National QuickBooks.`, { qb_bill_id: bill.Id });
    }

    const synced = await admin.from('methodic_requests').update({
      billing_status: request.amount_paid_cents >= request.billing_amount_cents ? 'paid' : 'open',
      billing_synced_at: new Date().toISOString(), billing_error: null, updated_by: actor.teamMemberId,
    }).eq('id', request.id).select('*').single();
    if (synced.error) throw synced.error;
    await addEvent(admin, request.id, actor.teamMemberId, 'intercompany_billing_synced',
      `Methodic invoice and National bill are linked for ${request.methodic_invoice_number}.`, {
        methodic_qb_invoice_id: synced.data.methodic_qb_transaction_id,
        national_qb_bill_id: synced.data.national_qb_transaction_id,
      });
    return synced.data;
  } catch (error) {
    const latest = await getRequest(admin, request.id);
    const partial = !!(latest.methodic_qb_transaction_id || latest.national_qb_transaction_id);
    await admin.from('methodic_requests').update({
      billing_status: partial ? 'partial' : 'error', billing_error: cleanText(error.message, 1000), updated_by: actor.teamMemberId,
    }).eq('id', request.id);
    await addEvent(admin, request.id, actor.teamMemberId, 'intercompany_billing_error', error.message, { partial });
    throw error;
  }
}

async function reservePayment(admin, request, body, actor) {
  if (body.payment_id) {
    const { data, error } = await admin.from('methodic_payments').select('*').eq('id', cleanText(body.payment_id, 80)).eq('request_id', request.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Methodic payment not found.');
    return data;
  }
  const amount = cents(body.amount_cents);
  if (!amount) throw new Error('Payment amount must be greater than zero.');
  const paymentDate = isoDate(body.payment_date || today(), 'Payment date');
  const { data, error } = await admin.rpc('reserve_methodic_payment', {
    p_request_id: request.id,
    p_amount_cents: amount,
    p_payment_date: paymentDate,
    p_reference_number: cleanText(body.reference_number, 120),
    p_memo: cleanText(body.memo, 500),
    p_actor_id: actor.teamMemberId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function recordPayment(admin, body, actor) {
  requireFinance(actor);
  let request = await getRequest(admin, body.id);
  const config = await getConfig(admin);
  if (!config.payment_sync_enabled) throw new Error('Methodic payment sync is not enabled.');
  if (!config.national_payment_account_qb_id || !config.methodic_deposit_account_qb_id) throw new Error('Both QuickBooks payment-account mappings are required.');
  if (!request.methodic_qb_transaction_id || !request.national_qb_transaction_id) throw new Error('Sync the Methodic invoice and National bill before recording payment.');
  let payment = await reservePayment(admin, request, body, actor);
  await admin.from('methodic_payments').update({ status: 'syncing', sync_error: null, updated_by: actor.teamMemberId }).eq('id', payment.id);
  try {
    const [nationalClient, methodicClient] = await Promise.all([
      companyClient(admin, 'national', config.national_sandbox),
      companyClient(admin, 'methodic', config.methodic_sandbox),
    ]);

    if (!payment.national_qb_bill_payment_id) {
      let billPayment = await findOne(nationalClient, 'BillPayment', 'DocNumber', payment.payment_number);
      if (!billPayment) billPayment = await nationalClient.create('BillPayment', buildNationalBillPayment(request, payment, config));
      if (!billPayment?.Id) throw new Error('National QuickBooks did not return a bill-payment id.');
      const saved = await admin.from('methodic_payments').update({
        national_qb_bill_payment_id: billPayment.Id, status: 'partial', updated_by: actor.teamMemberId,
      }).eq('id', payment.id).select('*').single();
      if (saved.error) throw saved.error;
      payment = saved.data;
      await addEvent(admin, request.id, actor.teamMemberId, 'national_bill_payment_posted',
        `National recorded ${payment.payment_number} against the Methodic bill.`, { qb_bill_payment_id: billPayment.Id, amount_cents: payment.amount_cents });
    }

    if (!payment.methodic_qb_payment_id) {
      let methodicPayment = await findOne(methodicClient, 'Payment', 'PaymentRefNum', payment.payment_number);
      if (!methodicPayment) methodicPayment = await methodicClient.create('Payment', buildMethodicPayment(request, payment, config));
      if (!methodicPayment?.Id) throw new Error('Methodic QuickBooks did not return a payment id.');
      const saved = await admin.from('methodic_payments').update({
        methodic_qb_payment_id: methodicPayment.Id, status: 'verified', sync_error: null, updated_by: actor.teamMemberId,
      }).eq('id', payment.id).select('*').single();
      if (saved.error) throw saved.error;
      payment = saved.data;
      await addEvent(admin, request.id, actor.teamMemberId, 'methodic_invoice_payment_posted',
        `Methodic recorded ${payment.payment_number} against its National invoice.`, { qb_payment_id: methodicPayment.Id, amount_cents: payment.amount_cents });
    }

    if (payment.status !== 'verified') {
      const verified = await admin.from('methodic_payments').update({
        status: 'verified', sync_error: null, updated_by: actor.teamMemberId,
      }).eq('id', payment.id).select('*').single();
      if (verified.error) throw verified.error;
      payment = verified.data;
    }

    const totals = await admin.from('methodic_payments').select('amount_cents').eq('request_id', request.id).in('status', ['posted', 'verified']);
    if (totals.error) throw totals.error;
    const amountPaid = (totals.data || []).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const isPaid = amountPaid >= Number(request.billing_amount_cents || 0);
    const savedRequest = await admin.from('methodic_requests').update({
      amount_paid_cents: amountPaid,
      payment_status: isPaid ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
      billing_status: isPaid ? 'paid' : 'open',
      paid_at: isPaid ? new Date().toISOString() : null,
      methodic_qb_payment_id: payment.methodic_qb_payment_id,
      national_qb_bill_payment_id: payment.national_qb_bill_payment_id,
      billing_error: null,
      updated_by: actor.teamMemberId,
    }).eq('id', request.id).select('*').single();
    if (savedRequest.error) throw savedRequest.error;
    return { request: savedRequest.data, payment };
  } catch (error) {
    const latest = await admin.from('methodic_payments').select('*').eq('id', payment.id).maybeSingle();
    const partial = !!(latest.data?.national_qb_bill_payment_id || latest.data?.methodic_qb_payment_id);
    await admin.from('methodic_payments').update({
      status: partial ? 'partial' : 'error', sync_error: cleanText(error.message, 1000), updated_by: actor.teamMemberId,
    }).eq('id', payment.id);
    await admin.from('methodic_requests').update({ billing_error: cleanText(error.message, 1000), updated_by: actor.teamMemberId }).eq('id', request.id);
    await addEvent(admin, request.id, actor.teamMemberId, 'intercompany_payment_error', error.message, { payment_id: payment.id, partial });
    throw error;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' });
  const actor = await verifyUser(event);
  if (!actor.ok) return reply(actor.status, { ok: false, error: actor.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  try {
    if (body.action === 'status') return reply(200, { ok: true, ...await status(actor.admin, body) });
    if (body.action === 'save_config') return reply(200, { ok: true, config: await saveConfig(actor.admin, body, actor) });
    if (body.action === 'prepare') return reply(200, { ok: true, request: await prepare(actor.admin, body, actor) });
    if (body.action === 'sync') return reply(200, { ok: true, request: await syncInvoiceAndBill(actor.admin, body, actor) });
    if (body.action === 'record_payment') return reply(200, { ok: true, ...await recordPayment(actor.admin, body, actor) });
    return reply(400, { ok: false, error: 'Unknown action.' });
  } catch (error) {
    console.error('[methodic-accounting]', error);
    const statusCode = error.status || (/required|invalid|must|cannot|before|exceeds|prepare|complete|enable|not found|multiple/i.test(error.message || '') ? 400 : 500);
    return reply(statusCode, { ok: false, error: error.message || 'Methodic accounting failed.' });
  }
};

exports._test = {
  quoteTotalCents, buildMethodicInvoice, buildNationalBill,
  buildNationalBillPayment, buildMethodicPayment, findOne,
};
