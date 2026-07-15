// Coach leads sheet sync — daily, scheduled via netlify.toml ([functions."coach-leads-sheet-sync"]).
//
// Pulls the coach-lead Google Sheet (COACH_LEADS_SHEET_URL — any Sheets URL shape, or a
// bare doc id) and inserts NEW rows into coach_leads. Same link-viewable constraint as
// sheet-fetch.js: the sheet must be shared "Anyone with the link → Viewer" (or Published
// to web) — a private sheet returns Google's HTML sign-in page, which we detect and
// report as an error rather than silently ingesting garbage.
//
// Dedup semantics: a re-run must NEVER clobber a lead that staff or enrichment already
// worked on (colors picked, sport confirmed, notes added, status advanced). So this is a
// pure "insert if new email, otherwise leave alone" sync, not an upsert of every field —
// we select existing emails first and only insert the remainder (see insertNewLeads below).
//
// Feeds the auto-store-creation funnel: rows land here with source:'sheet', status:'new',
// and get picked up by the future "New Coaches" review screen / store-quick-build function.
// See COACH_AUTO_STORE_PLAN_2026-07-10.md Phase 1.

const { getSupabaseAdmin } = require('./_shared');
const { parseSheet } = require('./sheet-fetch');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHUNK_SIZE = 200;

// Header variants → coach_leads column, case-insensitive, tolerant of extra whitespace.
// Anything not listed here (with a non-empty value) is kept in `raw`, keyed by the
// original header, so we never silently drop sheet data we don't map yet.
const HEADER_MAP = {
  name: 'name', coach: 'name', 'coach name': 'name', 'full name': 'name',
  email: 'email', 'email address': 'email', 'coach email': 'email',
  phone: 'phone', 'phone number': 'phone', cell: 'phone',
  school: 'school', organization: 'school', org: 'school', team: 'school', club: 'school',
  sport: 'sport',
  notes: 'notes', note: 'notes'
};

const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Small state-machine CSV parser — RFC4180-ish (quoted fields, "" escape, embedded
// commas/newlines). There's no shared server-side CSV parser in this repo, and the
// Sheets export can quote fields containing commas (e.g. "Smith, Jane").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  // Flush the final field/row (files rarely end with a trailing newline).
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Turn CSV rows into coach_leads-shaped objects: map known headers to columns, stash the
// rest in `raw`, normalize/validate email, and dedupe within the batch (keep first).
function mapRows(rows) {
  if (!rows.length) return { leads: [], skippedNoEmail: 0 };
  const headers = rows[0].map(normHeader);
  const seen = new Set();
  const leads = [];
  let skippedNoEmail = 0;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => String(c || '').trim() === '')) continue;

    const lead = { school: null, sport: null, name: null, phone: null, notes: null };
    const raw = {};
    let email = '';

    headers.forEach((h, i) => {
      const val = cells[i] != null ? String(cells[i]).trim() : '';
      if (!val) return;
      const col = HEADER_MAP[h];
      if (col === 'email') email = val;
      else if (col) lead[col] = val;
      else raw[rows[0][i]] = val;
    });

    email = email.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) { skippedNoEmail++; continue; }
    if (seen.has(email)) continue; // batch-level dedupe: keep first occurrence
    seen.add(email);

    leads.push({
      ...lead,
      email,
      source: 'sheet',
      status: 'new',
      raw: Object.keys(raw).length ? raw : null
    });
  }
  return { leads, skippedNoEmail };
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Insert only the leads whose email isn't already in coach_leads. Chosen over
// upsert+ignoreDuplicates because it makes the "never clobber an existing lead" guarantee
// structural (a plain .insert() literally cannot touch an existing row) rather than
// relying on ignoreDuplicates behaving as expected across supabase-js versions.
async function insertNewLeads(supabase, leads) {
  let inserted = 0;
  let alreadyKnown = 0;

  for (const batch of chunk(leads, CHUNK_SIZE)) {
    const emails = batch.map((l) => l.email);
    const { data: existing, error: selErr } = await supabase
      .from('coach_leads').select('email').in('email', emails);
    if (selErr) throw new Error(`lookup failed: ${selErr.message}`);

    const known = new Set((existing || []).map((r) => r.email));
    const toInsert = batch.filter((l) => !known.has(l.email));
    alreadyKnown += batch.length - toInsert.length;
    if (!toInsert.length) continue;

    const { error: insErr } = await supabase.from('coach_leads').insert(toInsert);
    if (insErr) throw new Error(`insert failed: ${insErr.message}`);
    inserted += toInsert.length;
  }
  return { inserted, alreadyKnown };
}

exports.handler = async () => {
  const sheetUrl = process.env.COACH_LEADS_SHEET_URL || '';
  if (!sheetUrl) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'COACH_LEADS_SHEET_URL not configured' }) };
  }

  const parsed = parseSheet(sheetUrl);
  if (!parsed) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'COACH_LEADS_SHEET_URL is not a recognizable Google Sheets URL or id' }) };
  }

  const target = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ''}`;

  let text;
  try {
    const response = await fetch(target, { headers: { 'User-Agent': 'NSA-Portal/1.0' }, redirect: 'follow' });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    text = await response.text();
    // A private sheet returns Google's HTML sign-in page (often with a 200 status), not CSV.
    if (!response.ok || contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not read the coach leads sheet — share it as "Anyone with the link → Viewer" and try again.' }) };
    }
  } catch (error) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: `Could not fetch the sheet: ${error.message}` }) };
  }

  const rows = parseCsv(text);
  const { leads, skippedNoEmail } = mapRows(rows);

  let inserted = 0;
  let alreadyKnown = 0;
  if (leads.length) {
    const supabase = getSupabaseAdmin();
    ({ inserted, alreadyKnown } = await insertNewLeads(supabase, leads));
  }

  const fetched = Math.max(rows.length - 1, 0);
  console.log(`[coach-leads-sheet-sync] fetched=${fetched} inserted=${inserted} skippedNoEmail=${skippedNoEmail} alreadyKnown=${alreadyKnown}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, fetched, inserted, skippedNoEmail, alreadyKnown }) };
};

// Exposed for tests (no other precedent in this repo for a test-only export, so this is
// kept minimal and clearly named rather than restructuring the module around testability).
exports._internals = { parseCsv, mapRows, HEADER_MAP };
