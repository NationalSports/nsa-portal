// Fetch a Google Sheet as CSV, server-side, so the store importer can read a pasted
// Sheets LINK (browsers can't fetch Google's export endpoint directly — CORS). Strict
// allowlist: only docs.google.com spreadsheet URLs are ever fetched (no open proxy —
// this endpoint must never become an SSRF hop, cf. the ShipStation webhook finding).
// Usage: /.netlify/functions/sheet-fetch?url=<google sheets url>

// Pull the doc id (and optional gid) out of any Google Sheets URL shape:
//   .../spreadsheets/d/<ID>/edit#gid=<GID>   ·   .../spreadsheets/d/<ID>/export?...
//   ...?id=<ID>   ·   a bare id
const parseSheet = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  let id = null; let gid = null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (m) id = m[1];
  else if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) id = s; // a bare id
  const g = s.match(/[#&?]gid=([0-9]+)/);
  if (g) gid = g[1];
  return id ? { id, gid } : null;
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const raw = event.queryStringParameters?.url;
  if (!raw) return { statusCode: 400, headers: CORS, body: 'Missing url parameter' };

  const parsed = parseSheet(raw);
  if (!parsed) return { statusCode: 400, headers: CORS, body: "That doesn't look like a Google Sheets link." };

  // Build the export URL ourselves from the id — we never fetch an attacker-supplied host.
  const target = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ''}`;

  try {
    const response = await fetch(target, { headers: { 'User-Agent': 'NSA-Portal/1.0' }, redirect: 'follow' });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const text = await response.text();
    // A private/restricted sheet returns Google's HTML sign-in page (often 200), not CSV.
    if (!response.ok || contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
      return { statusCode: 403, headers: CORS, body: "Couldn't read that sheet. Share it as “Anyone with the link → Viewer” (or File → Share → Publish to web), then paste the link again." };
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8' }, body: text };
  } catch (error) {
    return { statusCode: 502, headers: CORS, body: `Could not fetch the sheet: ${error.message}` };
  }
};
