// Pure classification + resolution of a scanned shop-floor code to a job.
//
// No I/O on purpose: callers pass a prebuilt index, so this stays a unit-testable
// pure function. Two code families (per emb-machine-manifest.js + 00185 boxes):
//   * production-sheet barcodes encode the DST filename (or a DG-#### code);
//   * box license plates are BX-#### (migration 00185 `boxes.id`).
//
// The DST/DG helpers mirror src/constants.js (isDstFile / dgCodeOf) and
// emb-machine-manifest.js's fileName — duplicated because the functions runtime is
// CommonJS and can't import the ESM constants module.

const isDst = (name) => String(name || '').toLowerCase().endsWith('.dst');

const dgCodeOf = (name) => {
  const m = String(name || '').match(/DG[-_ ]?(\d{4,})/i);
  return m ? 'DG' + m[1] : null;
};

// Last path segment, URL-decoded, query stripped — matches emb-machine-manifest's fileName.
const normName = (f) => {
  if (f && typeof f === 'object' && f.name) return f.name;
  const s = typeof f === 'string' ? f : (f && f.url) || '';
  if (!s) return '';
  try { return decodeURIComponent(s.split('/').pop().split('?')[0]); }
  catch { return s.split('/').pop().split('?')[0]; }
};

// Every printed box label (boxTracking.buildBoxLabel) and the PO-receive labels
// encode their scan target as a URL query param — <scanBase>?scan=<code> — not a
// bare token. So before classifying, pull the `scan` param out of a URL/query
// string and classify ITS value (a box plate, DST, or DG). Without this, a
// scanned box label ('https://…/?scan=BX-2001') never matched any bare-token
// pattern and resolved as unrecognized_code — the bug this unbreaks. A DST
// download URL (…/EAGLES.DST?token=x) has no `scan` param, so it is untouched
// and still flows through normName below.
const extractScanParam = (code) => {
  const m = code.match(/[?&]scan=([^&#]*)/i);
  if (!m) return code;
  let v = m[1];
  try { v = decodeURIComponent(v); } catch (_) { /* keep raw on malformed % */ }
  return v.trim();
};

// classifyScan(raw) → { type: 'box'|'dst'|'dg'|'unknown', value }
function classifyScan(raw) {
  const code = extractScanParam(String(raw || '').trim());
  if (!code) return { type: 'unknown', value: '' };
  // BX-#### box plate (accept BX2001 or BX-2001; normalize to BX-2001).
  if (/^BX-?\d+$/i.test(code)) {
    return { type: 'box', value: code.toUpperCase().replace(/^BX-?/i, 'BX-') };
  }
  const name = normName(code);
  if (isDst(name)) return { type: 'dst', value: name };
  const dg = dgCodeOf(code);
  if (dg) return { type: 'dg', value: dg };
  return { type: 'unknown', value: code };
}

// resolveScan(raw, index) where
//   index.jobs  = [{ so_id, job_id, dstNames:[...], dgCodes:[...], art_name }]
//   index.boxes = [{ id:'BX-2001', so_id, contents }]
// Returns a resolution descriptor; never throws.
function resolveScan(raw, index) {
  const cls = classifyScan(raw);
  const jobs = (index && index.jobs) || [];
  const boxes = (index && index.boxes) || [];

  if (cls.type === 'unknown') return { ok: false, reason: 'unrecognized_code', code: cls.value };

  if (cls.type === 'box') {
    const box = boxes.find((b) => String(b.id).toUpperCase() === cls.value);
    if (!box) return { ok: false, reason: 'box_not_found', code: cls.value };
    return { ok: true, kind: 'box', box_id: box.id, so_id: box.so_id || null, contents: box.contents || [] };
  }

  // dst / dg → match against jobs' art.
  const wantUpper = cls.value.toUpperCase();
  const matches = jobs.filter((j) =>
    cls.type === 'dst'
      ? (j.dstNames || []).some((n) => String(n).toUpperCase() === wantUpper)
      : (j.dgCodes || []).includes(cls.value));

  if (matches.length === 0) return { ok: false, reason: 'no_job_for_code', code: cls.value };
  if (matches.length > 1) {
    return {
      ok: false, reason: 'ambiguous', code: cls.value,
      matches: matches.map((m) => ({ so_id: m.so_id, job_id: m.job_id })),
    };
  }
  const m = matches[0];
  return { ok: true, kind: 'job', so_id: m.so_id, job_id: m.job_id, art_name: m.art_name || null };
}

module.exports = { classifyScan, resolveScan, isDst, dgCodeOf, normName };
