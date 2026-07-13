// Pure helpers for the shop-floor scan station (src/floorstation/FloorStation.js)
// — no React, no supabase, no window, so they unit-test directly
// (src/__tests__/floorStation.test.js).

// The five physical stations on the Team Shop fast-turn floor. `accepts` lists
// the so_jobs.deco_type kinds a station expects — a scan whose job is outside
// the list gets a loud wrong-station warning (but can still proceed; small
// shop, the operator on the floor outranks the picker). DTF prints on the DTF
// printer and is APPLIED at the heat press, so 'dtf' appears at both.
export const STATIONS = [
  { key: 'embroidery', label: 'Embroidery', accepts: ['embroidery'] },
  { key: 'dtf', label: 'DTF', accepts: ['dtf'] },
  { key: 'heat_press', label: 'Heat Press', accepts: ['dtf', 'vinyl', 'silicone_patch'] },
  { key: 'screen_print', label: 'Screen Print', accepts: ['screen_print'] },
  { key: 'packing', label: 'Packing', accepts: null }, // packs every deco kind
];

export const stationByKey = (key) => STATIONS.find((s) => s.key === key) || null;

// Does this station expect this deco kind? Unknown station or null accepts
// (packing) accepts everything; an unknown/missing deco_type never matches a
// deco-specific station (better a spurious warning than a missed one).
export function stationAccepts(stationKey, decoType) {
  const st = stationByKey(stationKey);
  if (!st || !st.accepts) return true;
  return st.accepts.includes(decoType);
}

const extOf = (name) => {
  const m = String(name || '').split('?')[0].match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : '';
};
export const isDstName = (name) => extOf(name) === 'dst';
export const isImageName = (name) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extOf(name));

// The production file(s) a station runs from, out of the resolve response's
// files list ([{ name, url, source: 'prod'|'art' }], prod first — job-scan's
// fetchJobDetail ordering):
//   embroidery           → the DSTs (the machine loads these);
//   dtf/heat/screen      → the print/production art: prod_files first, minus
//                          DSTs (a heat operator can't use a stitch file);
//   packing              → nothing to run; empty.
export function stationFilesFor(stationKey, files) {
  const list = Array.isArray(files) ? files : [];
  if (stationKey === 'packing') return [];
  if (stationKey === 'embroidery') return list.filter((f) => isDstName(f.name));
  const nonDst = list.filter((f) => !isDstName(f.name));
  const prod = nonDst.filter((f) => f.source === 'prod');
  return prod.length ? prod : nonDst;
}

// First image in the files list — the art preview thumbnail.
export const previewImageFor = (files) =>
  (Array.isArray(files) ? files : []).find((f) => isImageName(f.name)) || null;

// Apparel size order for the floor sheet's size breakdown. Known sizes sort in
// wear order (YXS..5XL); anything unrecognized sorts last, alphabetically, so a
// custom/one-size cell never disappears.
const SIZE_ORDER = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', 'OS', 'OSFA'];
const sizeRank = (sz) => {
  const i = SIZE_ORDER.indexOf(String(sz || '').toUpperCase());
  return i === -1 ? SIZE_ORDER.length : i;
};
// Object {S:3,M:2} → [['S',3],['M',2]] in wear order (see sizeRank).
export const sortedSizeEntries = (breakdown) =>
  Object.entries(breakdown || {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => sizeRank(a[0]) - sizeRank(b[0]) || String(a[0]).localeCompare(String(b[0])));

// Mirrors advance_job_stage's legacy normalization (00192: 'ready' → 'hold'),
// same as TeamShopQueue's normProdStatus.
export const normProdStatus = (s) => {
  const v = s || 'hold';
  return v === 'ready' ? 'hold' : v;
};

// The single legal next-stage action for a job's current stage — the same
// event/expected pairs TeamShopQueue's JobCard drives through
// advance_job_stage. `expected` is sent to job-scan as the optimistic guard;
// packed doesn't move prod_status (00192), so a packed job gets no action.
export function nextActionFor(job) {
  const status = normProdStatus(job && job.prod_status);
  const map = {
    hold: { event: 'release', label: 'Release →', expected: 'hold' },
    staging: { event: 'start_run', label: 'Start →', expected: 'staging' },
    in_process: { event: 'decorated', label: 'Done →', expected: 'in_process' },
    completed: (job && job.packed_at) ? null : { event: 'packed', label: 'Packed', expected: 'completed' },
  };
  return map[status] || null;
}

// Readiness of a not-yet-released (hold) job, mirroring advance_job_stage's
// 00205 gate: art must be 'art_complete' AND garments must be past
// 'need_to_order'. Drives the Floor Station readiness checklist and whether the
// release button or the "not ready" banner shows. The server gate stays the
// authoritative backstop — this only decides what the tablet offers up front so
// the operator doesn't tap a release that will bounce.
export function jobReadiness(job) {
  const art = (job && job.art_status) || null;
  const item = (job && job.item_status) || null;
  const artOk = art === 'art_complete';
  // goodsOk mirrors the 00205 gate exactly (anything past 'need_to_order' can
  // release, INCLUDING a partial receive). But 'partially_received' must not read
  // as "All received" — the operator needs to know some garments aren't in yet, so
  // it's flagged partial and labelled honestly while still counting as releasable.
  const goodsOk = !!item && item !== 'need_to_order';
  const partial = item === 'partially_received';
  const goodsLabel = item === 'items_received' ? 'All received'
    : partial ? 'Partially received'
    : goodsOk ? 'Received'
    : 'On order';
  return {
    art: { ok: artOk, label: artOk ? 'Approved' : (art === 'waiting_approval' ? 'Waiting approval' : 'Not approved') },
    goods: { ok: goodsOk, partial, label: goodsLabel },
    ready: artOk && goodsOk,
  };
}

// The big "current stage" badge for the Floor Station job card: a label + a
// semantic tone the card maps to a color. Past release it names the production
// stage; for a still-held job it reflects readiness at a glance (Ready to Run /
// On Order / Needs Art), matching the two mockup states.
export function stageDisplay(job) {
  if (job && job.packed_at) return { label: 'Packed', tone: 'done' };
  const s = normProdStatus(job && job.prod_status);
  if (s === 'completed') return { label: 'Decorated', tone: 'done' };
  if (s === 'in_process') return { label: 'Running', tone: 'active' };
  if (s === 'staging') return { label: 'In Line', tone: 'active' };
  const r = jobReadiness(job);
  if (r.ready) return { label: 'Ready to Run', tone: 'ready' };
  if (!r.goods.ok) return { label: 'On Order', tone: 'wait' };
  if (!r.art.ok) return { label: 'Needs Art', tone: 'wait' };
  return { label: 'On Hold', tone: 'wait' };
}

// Releasing a job whose art isn't finished or whose garments are still on order
// makes advance_job_stage's readiness gate (00205) raise
// NSA_NOT_READY:art=<art_status>,item=<item_status>. On the floor tablet that
// raw code reads as a broken scanner, so translate it into plain language the
// operator can act on. Returns null when the error is NOT a readiness rejection
// (so the caller falls back to its generic "move failed" handling). Same parse
// shape as TeamShopQueue's parseNotReady.
export function notReadyMessage(errMsg) {
  const m = /NSA_NOT_READY:art=([^,]*),item=(.*)$/.exec(String(errMsg || ''));
  if (!m) return null;
  const art = m[1];
  const item = m[2];
  const reasons = [];
  if (art !== 'art_complete') {
    reasons.push(art === 'waiting_approval' ? 'art still waiting for approval' : 'art not done yet');
  }
  if (item === 'need_to_order') {
    reasons.push('garments not in hand yet');
  }
  if (reasons.length === 0) reasons.push('not ready to run yet');
  return 'Not ready to run — ' + reasons.join(' and ') + '. Check with the office before running this job.';
}
