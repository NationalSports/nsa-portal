// DTF art-sync: auto-generate dtf_requests from order art (migration 00236).
//
// A DTF/heat-press job whose art_status is 'order_dtf_transfers' (approved,
// films need ordering — the rep todo "🎞️ Order DTF films") becomes a queued
// dtf_requests row automatically:
//   * artwork  — the best production file on the job's art (prefer .ai, then
//     vector .pdf/.eps/.svg, then raster), prod_files before files;
//   * qty      — the job's total_units;
//   * size     — parsed from so_art_files.art_size free text. Two numbers
//     ('12" x 4"') are width × height. ONE number ('10"') is the WIDTH (owner
//     call), with height derived from the artwork's raster aspect ratio via
//     Cloudinary; if no aspect is readable the height falls back to the width
//     and the request is annotated so staff can eyeball it in the queue.
//
// Idempotency: insert-only, keyed by the (so_id, job_id) partial unique index
// (source='art_sync'). A canceled auto request keeps its slot, so canceling is
// a durable opt-out. Jobs with NO usable file or NO parseable size are skipped
// and reported (never guessed into an order).
//
// Pure helpers are exported for src/__tests__/dtfOrders.test.js.

const AI_EXTS = ['ai'];
const VECTOR_EXTS = ['pdf', 'eps', 'svg'];
const RASTER_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
const DTF_DECO_TYPES = ['dtf', 'heat_press', 'heat_transfer'];
const DTF_ORDER_STATUS = 'order_dtf_transfers';

const fileUrlOf = (f) => (typeof f === 'string' ? f : (f && f.url) || '');
const fileNameOf = (f) => {
  if (f && typeof f === 'object' && f.name) return f.name;
  const s = fileUrlOf(f);
  try { return decodeURIComponent(s.split('/').pop().split('?')[0]); } catch { return s.split('/').pop().split('?')[0]; }
};
const extOf = (f) => {
  const m = fileNameOf(f).toLowerCase().match(/\.(\w+)$/);
  return m ? m[1] : '';
};

// Best print file from a set of so_art_files rows: .ai first (the owner's
// stated source of truth), then other vectors, then rasters; production
// uploads outrank pre-production art at the same tier.
function pickArtworkFile(arts) {
  const buckets = [[], [], []]; // [ai, vector, raster]
  for (const art of arts || []) {
    const groups = [art && art.prod_files, art && art.files];
    for (let g = 0; g < groups.length; g++) {
      for (const f of (groups[g] || [])) {
        const url = fileUrlOf(f);
        if (!/^https:\/\//i.test(url)) continue;
        const e = extOf(f);
        const entry = { url, name: fileNameOf(f), prod: g === 0 };
        if (AI_EXTS.includes(e)) buckets[0].push(entry);
        else if (VECTOR_EXTS.includes(e)) buckets[1].push(entry);
        else if (RASTER_EXTS.includes(e)) buckets[2].push(entry);
      }
    }
  }
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    return bucket.find((f) => f.prod) || bucket[0];
  }
  return null;
}

// Parse the free-text art size. Returns:
//   { width, height }          — two numbers found ('12" x 4"', '12x4', '12 by 4')
//   { width, height: null }    — one number found ('10"') → width-only (default-to-width)
//   null                       — nothing parseable
function parseArtSize(text) {
  const s = String(text || '');
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0 && n <= 200);
  if (!nums.length) return null;
  if (nums.length === 1) return { width: nums[0], height: null };
  // 'H x W' conventions exist, but this codebase's placeholder is 'e.g. 12" x 4"'
  // (width first) — take the first two numbers as W × H.
  return { width: nums[0], height: nums[1] };
}

// Cloudinary raster URL for any hosted art file (mirror of src/utils.js
// _cloudinaryPdfPage — duplicated because the functions runtime is CommonJS;
// same duplication note as vendor-digitizing.js). w_100 keeps the fetch tiny.
function cloudinaryRasterUrl(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  const t = String(url).replace('/raw/upload/', '/image/upload/').replace('/video/upload/', '/image/upload/');
  if (!t.includes('/image/upload/')) return null;
  return t.replace('/image/upload/', '/image/upload/pg_1,f_png,w_100/');
}

// Full-quality preview (no w_100) for queue thumbnails / gang-sheet fills.
function cloudinaryPreviewUrl(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  const t = String(url).replace('/raw/upload/', '/image/upload/').replace('/video/upload/', '/image/upload/');
  if (!t.includes('/image/upload/')) return null;
  return t.replace('/image/upload/', '/image/upload/pg_1,f_png/');
}

// Read a PNG's pixel dimensions from its IHDR header (bytes 16–24).
function pngDims(buf) {
  const b = Buffer.from(buf);
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47) return null; // \x89PNG
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

// Aspect ratio (w/h) of a hosted art file via its tiny Cloudinary raster.
// Returns null on any failure — callers fall back to square + annotation.
async function fetchAspect(url, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const raster = cloudinaryRasterUrl(url);
  if (!raster) return null;
  try {
    const res = await doFetch(raster);
    if (!res.ok) return null;
    const dims = pngDims(await res.arrayBuffer());
    return dims ? dims.w / dims.h : null;
  } catch { return null; }
}

const r2 = (n) => Math.round(n * 100) / 100;

// Turn one candidate job (+ its art rows) into a dtf_requests insert payload,
// or a skip record. Pure aside from the injected aspect value.
function buildRequestFromJob({ job, arts, aspect }) {
  const qty = Math.max(0, Math.round(Number(job.total_units) || 0));
  if (qty <= 0) return { skip: { so_id: job.so_id, job_id: job.id, reason: 'no_units' } };
  const file = pickArtworkFile(arts);
  if (!file) return { skip: { so_id: job.so_id, job_id: job.id, reason: 'no_artwork_file' } };
  const sizeText = (arts || []).map((a) => a && a.art_size).find((s) => s && String(s).trim()) || '';
  const size = parseArtSize(sizeText);
  if (!size) return { skip: { so_id: job.so_id, job_id: job.id, reason: 'no_size_on_art', art_size: sizeText } };

  let height = size.height;
  let note = 'Auto from ' + job.so_id + ' · art size "' + String(sizeText).trim() + '"';
  if (height == null) {
    if (aspect && aspect > 0) {
      height = r2(size.width / aspect);
      note += ' · height from artwork aspect';
    } else {
      height = size.width;
      note += ' · HEIGHT ASSUMED (width-only size, artwork aspect unreadable) — please check';
    }
  }
  if (!(height > 0) || height > 200 || !(size.width > 0) || size.width > 200) {
    return { skip: { so_id: job.so_id, job_id: job.id, reason: 'size_out_of_range', art_size: sizeText } };
  }

  const isRaster = RASTER_EXTS.includes((file.name.toLowerCase().match(/\.(\w+)$/) || [])[1] || '');
  return {
    request: {
      design_name: job.art_name || fileNameOf(file).replace(/\.[^.]+$/, '') || 'DTF design',
      file_url: file.url,
      file_name: file.name,
      preview_url: isRaster ? file.url : cloudinaryPreviewUrl(file.url),
      width_in: r2(size.width),
      height_in: r2(height),
      qty,
      outline: false,
      notes: note,
      so_id: job.so_id,
      job_id: job.id,
      status: 'queued',
      source: 'art_sync',
      submitted_by: 'art-sync',
    },
  };
}

// Sweep: find DTF/heat-press jobs waiting on films with no request yet, build
// and insert their requests. Insert-only + ignoreDuplicates on the partial
// unique index = idempotent and race-safe. Aspect fetches are capped per run
// (they're one tiny image each; the next run picks up the remainder).
const ASPECT_FETCH_CAP = 10;
async function syncFromArt(admin, opts) {
  const fetchImpl = opts && opts.fetchImpl;
  const jobsRes = await admin.from('so_jobs')
    .select('so_id, id, art_name, deco_type, art_status, total_units, art_file_id, _art_ids')
    .in('deco_type', DTF_DECO_TYPES).eq('art_status', DTF_ORDER_STATUS).limit(1000);
  if (jobsRes.error) throw jobsRes.error;
  const jobs = jobsRes.data || [];
  if (!jobs.length) return { created: 0, skipped: [] };

  const soIds = [...new Set(jobs.map((j) => j.so_id))];
  const [haveRes, artsRes] = await Promise.all([
    admin.from('dtf_requests').select('so_id, job_id').eq('source', 'art_sync').in('so_id', soIds).limit(5000),
    admin.from('so_art_files').select('so_id, id, art_size, files, prod_files').in('so_id', soIds),
  ]);
  if (haveRes.error) throw haveRes.error;
  if (artsRes.error) throw artsRes.error;
  const have = new Set((haveRes.data || []).map((r) => r.so_id + ' ' + r.job_id));
  const artByKey = new Map((artsRes.data || []).map((a) => [a.so_id + ' ' + a.id, a]));

  const rows = [];
  const skipped = [];
  let aspectFetches = 0;
  for (const job of jobs) {
    if (have.has(job.so_id + ' ' + job.id)) continue;
    const ids = (Array.isArray(job._art_ids) && job._art_ids.length ? job._art_ids : [job.art_file_id])
      .filter((id) => id && id !== '__tbd');
    const arts = ids.map((id) => artByKey.get(job.so_id + ' ' + id)).filter(Boolean);

    // Only pay for an aspect fetch when the size is width-only and a file exists.
    let aspect = null;
    const sizeText = arts.map((a) => a.art_size).find((s) => s && String(s).trim()) || '';
    const size = parseArtSize(sizeText);
    const file = pickArtworkFile(arts);
    if (size && size.height == null && file && aspectFetches < ASPECT_FETCH_CAP) {
      aspectFetches++;
      aspect = await fetchAspect(file.url, fetchImpl);
    }

    const built = buildRequestFromJob({ job, arts, aspect });
    if (built.skip) skipped.push(built.skip);
    else rows.push(built.request);
  }

  if (rows.length) {
    const ins = await admin.from('dtf_requests').insert(rows); // partial unique index absorbs races
    if (ins.error) {
      // Pre-00236 (no source column / index) or a race burst: report, don't throw.
      return { created: 0, skipped, error: ins.error.message };
    }
  }
  return { created: rows.length, skipped };
}

module.exports = {
  syncFromArt,
  buildRequestFromJob,
  parseArtSize,
  pickArtworkFile,
  cloudinaryRasterUrl,
  cloudinaryPreviewUrl,
  pngDims,
  fetchAspect,
  DTF_DECO_TYPES,
  DTF_ORDER_STATUS,
};
