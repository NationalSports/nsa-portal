#!/usr/bin/env node
/* Writes build/build-meta.json with a build id so the deployed app can detect new deployments and
 * reload long-lived tabs (see src/deployReload.js). Runs as the npm `postbuild` step.
 *
 * The id is CONTENT-derived: the content hashes CRA already put in the built entrypoint filenames
 * (main.<hash>.js / main.<hash>.css). It was previously Date.now(), which changed on every build —
 * so a commit that touched only markdown, a Netlify function, a SQL migration or a script (most
 * commits in this repo) still force-reloaded every open tab in the office. Those deploys ship a
 * byte-identical client bundle, so tabs have nothing to pick up. Hashing the bundle instead means a
 * reload happens when, and only when, the code running in the tab actually changed.
 *
 * Set FORCE_RELOAD_BUILD=1 in the Netlify build env to get the old behavior for one deploy (a
 * timestamp is appended), for when you need to boot the fleet off an unchanged bundle anyway.
 * Never fails the build. */
const fs = require('fs');
const path = require('path');

const ref = process.env.COMMIT_REF || process.env.BUILD_ID || '';
const dir = path.join(__dirname, '..', 'build');
const file = path.join(dir, 'build-meta.json');

// CRA writes build/asset-manifest.json before postbuild runs. `entrypoints` lists the hashed
// filenames of the JS/CSS a tab actually executes — exactly the surface a reload would refresh.
const bundleSig = () => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'asset-manifest.json'), 'utf8'));
    const parts = Array.isArray(m.entrypoints) && m.entrypoints.length
      ? m.entrypoints
      : [m.files && m.files['main.js'], m.files && m.files['main.css']].filter(Boolean);
    if (parts.length) return parts.join(',');
  } catch (e) { /* fall through */ }
  return null;
};

// No manifest (unexpected) → fall back to the old timestamp so the watcher still functions. It
// over-reloads rather than silently never reloading, which is the safer failure direction.
// NOTE: the commit ref is deliberately NOT part of `id` — it changes on every commit, which would
// reintroduce exactly the reload-on-every-deploy behavior this is fixing. It stays in the `ref`
// field for traceability; deployReload.js compares `id` only.
const sig = bundleSig();
const id = [
  'build',
  sig ? require('crypto').createHash('sha1').update(sig).digest('hex').slice(0, 16) : Date.now(),
  process.env.FORCE_RELOAD_BUILD ? 'force' + Date.now() : '',
].filter(Boolean).join('-');

try {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, ref: ref || null, built_at: new Date().toISOString() }) + '\n');
  console.log('[write-build-meta] wrote build/build-meta.json id=' + id + (sig ? '' : ' (no asset-manifest — fell back to timestamp)'));
} catch (e) {
  console.error('[write-build-meta] skipped:', e && e.message);
}
