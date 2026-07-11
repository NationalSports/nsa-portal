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
