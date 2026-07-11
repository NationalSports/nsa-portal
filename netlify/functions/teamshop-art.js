// Coach-facing Team Shop logo library — list + upload logos for a team.
//
// POST { action: 'list'|'upload', customer_id, ... }
//   Authorization: Bearer <coach Supabase session JWT>
//
// Auth mirrors teamshop-context.js exactly: verifyCoach resolves the bearer
// token to an active coach_accounts row, and every action re-checks
// coachHasCustomerAccess for the requested customer (./_coachAuth, the same
// helper quickorder-quote.js gates a quote on).
//
// list  { customer_id }
//   Union of two read-only sources:
//     (a) customers.art_files JSONB — the STAFF-maintained art library. Read
//         server-side and sanitized to id/name/url/deco_type/stitches only
//         (internal notes, storage paths, mockup/prod file lists never leave
//         the server). NEVER written here: the staff client save engine
//         whole-value rewrites that column, so a server-side append would be
//         silently clobbered. Tagged source:'art_library'.
//     (b) teamshop_logos rows (coach uploads, migration 00194), tagged
//         source:'teamshop'.
//
// upload { customer_id, name, file_base64, mime, deco_hint? }
//   Validates mime (png/jpg/jpeg/svg+xml/pdf) and decoded size (≤ 10 MB), then
//   writes to the `artwork` bucket with the SERVICE-ROLE client — migration
//   00191 made artwork-bucket writes staff-only, so coach uploads must go
//   through here (service_role bypasses storage RLS). The storage path is
//   SERVER-CONSTRUCTED only (teamshop/<customer_id>/<uuid>.<ext>); no
//   client-supplied path ever reaches storage. PNG/JPEG dimensions are probed
//   from the file header (no deps); other types store null.
const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB decoded
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

// Strip control chars, collapse whitespace, cap length. Never returns ''.
function sanitizeName(raw, max = 120) {
  const s = String(raw == null ? '' : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s || 'Logo';
}

// First renderable URL on a staff art_files entry (entries store files/mockups
// as strings or {url} objects — see the customer Artwork tab in CustDetail.js).
function artEntryUrl(a) {
  if (!a) return '';
  if (typeof a.url === 'string' && a.url) return a.url;
  const lists = [a.files, a.mockup_files];
  for (const list of lists) {
    for (const f of (Array.isArray(list) ? list : [])) {
      const u = typeof f === 'string' ? f : (f && f.url) || '';
      if (u) return u;
    }
  }
  return '';
}

// Sanitize customers.art_files entries for the coach-facing list: ONLY
// id/name/url/deco_type/stitches — internal notes/paths/status never leave.
function sanitizeArtFiles(artFiles) {
  return (Array.isArray(artFiles) ? artFiles : [])
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      id: a.id != null ? String(a.id) : null,
      name: sanitizeName(a.name),
      url: artEntryUrl(a),
      deco_type: a.deco_type || null,
      stitches: a.stitches != null ? Number(a.stitches) || null : null,
      source: 'art_library',
    }))
    .filter((a) => a.url); // an entry with no renderable file can't be picked as a logo
}

// Probe PNG / JPEG dimensions from the header bytes — enough for preview
// sizing, no image library. Returns { width, height } or nulls.
function probeImageSize(buf, mime) {
  try {
    if (mime === 'image/png') {
      // 8-byte signature, then IHDR: width @16, height @20 (big-endian).
      if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
    } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
      if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let off = 2;
        while (off + 9 < buf.length) {
          if (buf[off] !== 0xff) { off += 1; continue; }
          const marker = buf[off + 1];
          // SOFn markers carry dimensions (all except DHT/JPG/DAC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
          }
          const len = buf.readUInt16BE(off + 2);
          if (len < 2) break;
          off += 2 + len;
        }
      }
    }
  } catch (e) { /* header probe is best-effort */ }
  return { width: null, height: null };
}

async function handleList(admin, coach, body) {
  const customerId = String(body.customer_id || '');
  if (!customerId) return bad(400, 'customer_id required');
  const acc = await coachHasCustomerAccess(admin, coach, customerId);
  if (acc.error) return bad(500, acc.error);
  if (!acc.ok) return bad(403, 'No access to this customer');

  // (a) staff art library — read-only, sanitized server-side.
  const { data: cust, error: cErr } = await admin.from('customers')
    .select('art_files').eq('id', customerId).maybeSingle();
  if (cErr) return bad(500, cErr.message);
  const library = sanitizeArtFiles(cust && cust.art_files);

  // (b) coach uploads.
  const { data: rows, error: lErr } = await admin.from('teamshop_logos')
    .select('id,name,url,file_type,width,height,deco_hint,created_at')
    .eq('customer_id', customerId).order('created_at', { ascending: false });
  if (lErr) return bad(500, lErr.message);
  const uploads = (rows || []).map((r) => ({ ...r, source: 'teamshop' }));

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true, logos: [...library, ...uploads] }),
  };
}

async function handleUpload(admin, coach, body) {
  const customerId = String(body.customer_id || '');
  if (!customerId) return bad(400, 'customer_id required');
  const acc = await coachHasCustomerAccess(admin, coach, customerId);
  if (acc.error) return bad(500, acc.error);
  if (!acc.ok) return bad(403, 'No access to this customer');

  const mime = String(body.mime || '').toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return bad(400, 'Unsupported file type — use PNG, JPG, SVG, or PDF');
  const b64 = String(body.file_base64 || '');
  if (!b64) return bad(400, 'No file data');
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return bad(400, 'Invalid file data'); }
  if (!buf || !buf.length) return bad(400, 'No file data');
  if (buf.length > MAX_BYTES) return bad(413, 'File too large (max 10 MB)');

  const name = sanitizeName(body.name);
  const decoHint = body.deco_hint ? sanitizeName(body.deco_hint, 40) : null;
  const { width, height } = probeImageSize(buf, mime);

  // SECURITY: server-constructed path only — no client-supplied path fragment.
  // customer_id was verified against this coach's access above; sanitize the
  // path segment anyway so a legitimate id can't produce a weird object key.
  const safeCustSeg = customerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `teamshop/${safeCustSeg}/${crypto.randomUUID()}.${ext}`;

  const up = await admin.storage.from('artwork').upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) return bad(500, up.error.message);

  const { data: pub } = admin.storage.from('artwork').getPublicUrl(path);
  const url = (pub && pub.publicUrl) || '';

  const { data: row, error: insErr } = await admin.from('teamshop_logos')
    .insert({
      customer_id: customerId,
      coach_id: coach.id,
      name,
      url,
      storage_path: path,
      file_type: mime,
      width,
      height,
      deco_hint: decoHint,
    })
    .select('id,customer_id,name,url,storage_path,file_type,width,height,deco_hint,created_at')
    .maybeSingle();
  if (insErr) return bad(500, insErr.message);

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true, logo: { ...(row || {}), source: 'teamshop' } }),
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    const v = await verifyCoach(admin, event);
    if (!v.coach) return bad(v.status, v.error);
    const coach = v.coach;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return bad(400, 'Invalid JSON'); }

    if (body.action === 'list') return await handleList(admin, coach, body);
    if (body.action === 'upload') return await handleUpload(admin, coach, body);
    return bad(400, 'Unknown action');
  } catch (e) {
    return bad(500, e.message);
  }
};

// Exported for tests (src/__tests__/teamshopArt.test.js) — same pattern as teamshop-context.
module.exports.sanitizeName = sanitizeName;
module.exports.sanitizeArtFiles = sanitizeArtFiles;
module.exports.probeImageSize = probeImageSize;
