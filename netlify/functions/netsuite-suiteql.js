// ═══════════════════════════════════════════════════════════════════════
// NETSUITE SUITEQL PULLER
//
// The §9 route from NETSUITE_TAX_EXPORT_HANDOFF.md: instead of a human
// clicking through eight reports in the NetSuite UI, pull the same data
// over SuiteTalk REST. Headless, no 2FA, repeatable on a schedule.
//
// Setup (a NetSuite administrator does this once):
//   1. Setup → Company → Enable Features → SuiteCloud:
//      tick REST Web Services + Token-Based Authentication
//   2. Setup → Integration → Manage Integrations → New
//        → Consumer Key + Consumer Secret (shown once)
//   3. Setup → Users/Roles → Access Tokens → New
//        → Token ID + Token Secret (shown once)
//
// Then set, in Netlify env vars (never in the client):
//   NETSUITE_ACCOUNT_ID, NETSUITE_CONSUMER_KEY, NETSUITE_CONSUMER_SECRET,
//   NETSUITE_TOKEN_ID, NETSUITE_TOKEN_SECRET
//
// Admin-only: SuiteQL can read every transaction in the general ledger.
// ═══════════════════════════════════════════════════════════════════════

const { verifyAdmin } = require('./_shared');
const { buildAuthHeader, readCredentials, restBaseUrl } = require('./_netsuiteOAuth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// SuiteQL is read-only by design, but a caller-supplied query still gets a
// gate: only a single SELECT, no statement chaining. Defence in depth — the
// integration role should also be read-only in NetSuite.
function assertReadOnly(q) {
  const sql = String(q || '').trim();
  if (!sql) throw new Error('Empty query');
  if (!/^select\b/i.test(sql)) throw new Error('Only SELECT queries are allowed');
  // Strip string literals before looking for statement separators, so a
  // semicolon inside 'a;b' does not trip the check.
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (withoutLiterals.includes(';')) throw new Error('Multiple statements are not allowed');
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke)\b/i.test(withoutLiterals)) {
    throw new Error('Only SELECT queries are allowed');
  }
  return sql;
}

// Named queries mirroring the handoff's report list, so the portal does not
// have to hand-write SuiteQL. Dates are bound as literals built from a
// validated year, never from raw caller text.
function namedQuery(report, year, asOf) {
  // Strict, not just parseInt: "2025' OR '1'='1" parses to 2025 and would
  // slip through a loose check. The interpolation below uses the parsed
  // integer so that string could not actually escape, but a guarantee that
  // depends on parseInt truncating is a guarantee nobody can see. Require
  // four clean digits and the safety is stated rather than incidental.
  const raw = String(year === undefined || year === null ? '' : year).trim();
  const y = /^\d{4}$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (report !== 'chart_of_accounts' && (!isFinite(y) || y < 2000 || y > 2100)) {
    throw new Error('A valid fiscal year is required');
  }
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;
  switch (report) {
    case 'chart_of_accounts':
      return `SELECT a.id, a.acctnumber, a.acctname, a.accttype, a.fullname, a.parent, a.isinactive, a.issummary
              FROM account a`;
    case 'gl_detail':
      return `SELECT t.trandate, t.tranid, t.type, t.id AS transaction_id,
                     tal.account, tal.debit, tal.credit, tal.memo,
                     a.acctnumber, a.acctname, a.accttype, a.fullname AS account_fullname,
                     tap.periodname
              FROM transaction t
              JOIN transactionaccountingline tal ON tal.transaction = t.id
              JOIN account a ON a.id = tal.account
              LEFT JOIN accountingperiod tap ON tap.id = t.postingperiod
              WHERE t.posting = 'T'
                AND t.trandate >= TO_DATE('${start}','YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${end}','YYYY-MM-DD')`;
    case 'invoices_with_tax':
      // The file-8 equivalent: invoices AND credit memos, with the
      // subtotal/tax split that is NULL on all 9,082 rows already loaded.
      return `SELECT t.id AS internal_id, t.tranid AS document_number, t.trandate, t.type,
                     t.entity AS customer_internal_id, t.status, t.memo,
                     BUILTIN.DF(t.entity) AS customer_name,
                     t.foreigntotal AS total
              FROM transaction t
              WHERE t.type IN ('CustInvc','CustCred')
                AND t.trandate >= TO_DATE('${start}','YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${end}','YYYY-MM-DD')`;
    case 'trial_balance':
      return `SELECT a.acctnumber, a.acctname, a.accttype, a.fullname AS account_fullname,
                     SUM(tal.debit) AS debit, SUM(tal.credit) AS credit
              FROM transactionaccountingline tal
              JOIN transaction t ON t.id = tal.transaction
              JOIN account a ON a.id = tal.account
              WHERE t.posting = 'T'
                AND t.trandate >= TO_DATE('${start}','YYYY-MM-DD')
                AND t.trandate <= TO_DATE('${asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : end}','YYYY-MM-DD')
              GROUP BY a.acctnumber, a.acctname, a.accttype, a.fullname`;
    default:
      throw new Error(`Unknown report "${report}"`);
  }
}

async function runSuiteQL(creds, sql, limit, offset) {
  const url = `${restBaseUrl(creds.accountId)}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  const { header } = buildAuthHeader({
    method: 'POST',
    url,
    accountId: creds.accountId,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    tokenId: creds.tokenId,
    tokenSecret: creds.tokenSecret,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: header,
      'Content-Type': 'application/json',
      Prefer: 'transient', // required by SuiteQL
    },
    body: JSON.stringify({ q: sql }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = (json && (json['o:errorDetails']?.[0]?.detail || json.title || json.message)) || text.slice(0, 500);
    const err = new Error(`NetSuite ${res.status}: ${detail}`);
    err.statusCode = res.status;
    throw err;
  }
  return json || { items: [], hasMore: false };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'POST only' }) };
  }

  const v = await verifyAdmin(event);
  if (!v.ok) {
    return { statusCode: v.status, headers: JSON_HEADERS, body: JSON.stringify({ error: v.error }) };
  }

  const { creds, missing } = readCredentials();
  if (missing.length) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'NetSuite Token-Based Auth is not configured',
        missing,
        help: 'See NETSUITE_TAX_EXPORT_HANDOFF.md §9 — an administrator creates an integration record and an access token, then these are set as Netlify environment variables.',
      }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  let sql;
  try {
    sql = body.report ? namedQuery(body.report, body.year, body.asOf) : assertReadOnly(body.query);
  } catch (e) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  // Page through the result set. maxRows caps a runaway pull; the caller can
  // raise it deliberately rather than discovering a truncation silently.
  const pageSize = Math.min(Math.max(parseInt(body.pageSize, 10) || 1000, 1), 1000);
  const maxRows = Math.min(Math.max(parseInt(body.maxRows, 10) || 50000, 1), 500000);
  const items = [];
  let offset = 0;
  let hasMore = true;
  let pages = 0;

  try {
    while (hasMore && items.length < maxRows) {
      const page = await runSuiteQL(creds, sql, pageSize, offset);
      const batch = Array.isArray(page.items) ? page.items : [];
      items.push(...batch);
      pages++;
      hasMore = !!page.hasMore && batch.length > 0;
      offset += batch.length || pageSize;
      if (pages > 600) break; // hard stop against a pathological loop
    }
  } catch (e) {
    return {
      statusCode: e.statusCode === 401 ? 401 : 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: e.message,
        hint: e.statusCode === 401
          ? 'A 401 from SuiteTalk usually means the signature or the role is wrong: check the four credentials, that the integration record has Token-Based Authentication ticked, and that the token\'s role can read Reports → Financial.'
          : undefined,
      }),
    };
  }

  const truncated = items.length >= maxRows && hasMore;
  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      rowCount: items.length,
      pages,
      // Never report a partial pull as complete — that is the failure the
      // handoff calls "the worst possible outcome" for a partial year.
      truncated,
      ...(truncated ? { warning: `Stopped at maxRows=${maxRows}; more rows remain. Raise maxRows or pull a narrower date range.` } : {}),
      items,
    }),
  };
};

// Exported for tests.
exports.assertReadOnly = assertReadOnly;
exports.namedQuery = namedQuery;
