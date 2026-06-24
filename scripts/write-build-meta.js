#!/usr/bin/env node
/* Writes build/build-meta.json with a unique per-build id so the deployed app can detect
 * new deployments and reload long-lived tabs (see src/deployReload.js). Runs as the npm
 * `postbuild` step.
 *
 * The id combines the CI commit ref (for traceability) with a build timestamp, so it is
 * fresh on every build — including same-commit redeploys, letting a manual redeploy force a
 * fleet-wide reload. Never fails the build. */
const fs = require('fs');
const path = require('path');

const ref = process.env.COMMIT_REF || process.env.BUILD_ID || '';
const id = [ref ? ref.slice(0, 12) : 'build', Date.now()].join('-');
const dir = path.join(__dirname, '..', 'build');
const file = path.join(dir, 'build-meta.json');

try {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, ref: ref || null, built_at: new Date().toISOString() }) + '\n');
  console.log('[write-build-meta] wrote build/build-meta.json id=' + id);
} catch (e) {
  console.error('[write-build-meta] skipped:', e && e.message);
}
