// Deploy-aware auto-reload.
//
// Browser tabs left open for hours/days keep running whatever JS bundle they first loaded.
// When many stale tabs accumulate they can hammer the API with outdated request patterns
// (e.g. auto-saving estimates they've drifted out of version-sync on, re-downloading whole
// tables), and there is otherwise no way to push fresh code into an already-open tab.
//
// This watcher fetches a tiny build fingerprint on a slow interval and, when it changes
// (a new build has been deployed), reloads the tab so every open window converges on the
// current build. Cost is one small static fetch per cycle — no database or realtime load.
//
// Fingerprint source, in order of preference:
//   1. /build-meta.json     — written at build time with a unique id (changes on every
//                             deploy, including same-commit redeploys, so re-deploying is
//                             enough to force a fleet-wide reload). See scripts/write-build-meta.js.
//   2. /asset-manifest.json — CRA's content-hashed manifest, used if the stamp is absent.
//
// Paths are root-relative, so this runs for the internal portal (served at the app's own
// origin) and harmlessly no-ops where the file isn't served (e.g. the customer storefront
// proxy on the marketing domain returns 404 → no fingerprint → never reloads).

const META_URL = '/build-meta.json';
const ASSET_URL = '/asset-manifest.json';

let _started = false;
let _baseline = null;
let _committed = false; // once a new build is seen we commit to reloading; stop re-detecting

async function _fingerprint() {
  for (const url of [META_URL, ASSET_URL]) {
    try {
      const res = await fetch(url + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (!text) continue;
      try {
        const j = JSON.parse(text);
        if (url === META_URL && j && j.id != null) return 'meta:' + j.id;
        const entry = (j.files && (j.files['main.js'] || j.files['main.css']))
                   || (Array.isArray(j.entrypoints) && j.entrypoints.join(','));
        if (entry) return 'asset:' + entry;
      } catch {
        // Not JSON — fall back to a cheap content signature.
        return 'raw:' + text.length + ':' + text.slice(0, 80);
      }
    } catch {
      // Offline / fetch error — skip this source this cycle.
    }
  }
  return null;
}

/**
 * Begin watching for new deployments. Idempotent — safe to call more than once.
 * @param {Object} [opts]
 * @param {number} [opts.intervalMs=180000] How often to check for a new build (min 60s, default 3 min).
 * @param {() => boolean} [opts.isSafe] Return false to defer the reload (e.g. a save is in flight).
 */
export function startDeployReloadWatcher(opts = {}) {
  if (_started || typeof window === 'undefined' || typeof fetch === 'undefined') return;
  _started = true;
  const intervalMs = Math.max(60000, opts.intervalMs || 180000);
  const isSafe = typeof opts.isSafe === 'function' ? opts.isSafe : () => true;
  // Upper bound on how long we defer the reload waiting for isSafe(). A tab stuck in a failed-save
  // retry loop NEVER becomes safe (it always has a pending/failed save) — and that is exactly the tab
  // whose stale requests hammer the API. Deferring forever means the one tab that most needs the fixed
  // build is the one that never reloads (the root cause of the recurring save_estimate storms). Past
  // this deadline we reload regardless: a doomed/looping save will not succeed, and its estimate's
  // authoritative copy already lives in the DB, which the reload re-fetches. A healthy tab finishes its
  // save in seconds and reloads via the normal safe path long before this fires.
  const maxDeferMs = Math.max(30000, opts.maxDeferMs || 90000);
  let _reloadDeadline = 0;
  const canReload = () => isSafe() || (_reloadDeadline > 0 && Date.now() >= _reloadDeadline);

  // Seed the baseline from the same source we'll compare against, so a freshly-opened tab
  // never reloads on its first read.
  _fingerprint().then((fp) => { if (_baseline == null) _baseline = fp; });

  const reloadWhenSafe = () => {
    if (!canReload()) { setTimeout(reloadWhenSafe, 5000); return; } // wait for quiescence (bounded by deadline)
    // Small random delay so a fleet of tabs doesn't reload — and then re-fetch all data —
    // at the same instant, which would itself spike the DB.
    const jitter = 2000 + Math.floor(Math.random() * 18000); // 2–20s
    setTimeout(() => {
      if (!canReload()) { reloadWhenSafe(); return; } // re-check right before reloading
      try { window.location.reload(); } catch (_) { /* noop */ }
    }, jitter);
  };

  setInterval(async () => {
    if (_committed) return;
    const fp = await _fingerprint();
    if (fp == null) return;                       // couldn't read — try again next cycle
    if (_baseline == null) { _baseline = fp; return; }
    if (fp === _baseline) return;                 // same build — nothing to do
    _committed = true;
    _reloadDeadline = Date.now() + maxDeferMs;    // force reload past this point even if never "safe"
    try { console.warn('[deploy-reload] new build detected — reloading when idle'); } catch (_) { /* noop */ }
    reloadWhenSafe();
  }, intervalMs);
}
