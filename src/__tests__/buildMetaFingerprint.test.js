/* Deploy-reload fingerprint — scripts/write-build-meta.js.
 *
 * src/deployReload.js reloads every open tab in the office when build-meta.json's `id` changes.
 * The id used to be Date.now(), so it changed on EVERY build — meaning a commit that touched only
 * markdown, a Netlify function or a SQL migration (most commits in this repo) still force-reloaded
 * everyone, even though those deploys ship a byte-identical client bundle with nothing for a tab to
 * pick up. That is the "we're getting refreshed way too often" report.
 *
 * The guarantee under test: `id` is derived from the built bundle's content hashes, so it changes
 * when — and only when — the code running in the tab changed. The commit ref must stay OUT of the
 * id (it changes on every commit, which would reintroduce the bug) while remaining available as a
 * separate field for traceability.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'write-build-meta.js');

// The script writes to <repo>/build, so run it against a throwaway copy of the repo layout:
// a temp dir with scripts/ + build/ and nothing else.
const runBuildMeta = (manifest, env = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buildmeta-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'build'));
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'write-build-meta.js'));
  if (manifest) fs.writeFileSync(path.join(root, 'build', 'asset-manifest.json'), JSON.stringify(manifest));
  execFileSync(process.execPath, [path.join(root, 'scripts', 'write-build-meta.js')], {
    env: { ...process.env, COMMIT_REF: '', BUILD_ID: '', FORCE_RELOAD_BUILD: '', ...env },
    stdio: 'pipe',
  });
  const out = JSON.parse(fs.readFileSync(path.join(root, 'build', 'build-meta.json'), 'utf8'));
  fs.rmSync(root, { recursive: true, force: true });
  return out;
};

const MANIFEST_A = { entrypoints: ['static/js/main.aaaaaaaa.js'], files: { 'main.js': '/static/js/main.aaaaaaaa.js' } };
const MANIFEST_B = { entrypoints: ['static/js/main.bbbbbbbb.js'], files: { 'main.js': '/static/js/main.bbbbbbbb.js' } };

describe('build-meta id is content-derived, not time-derived', () => {
  test('an unchanged bundle produces the SAME id across builds — no fleet reload', () => {
    expect(runBuildMeta(MANIFEST_A).id).toBe(runBuildMeta(MANIFEST_A).id);
  });

  test('a docs/function-only deploy (new commit ref, same bundle) does not change the id', () => {
    const first = runBuildMeta(MANIFEST_A, { COMMIT_REF: '1111111111111111' });
    const second = runBuildMeta(MANIFEST_A, { COMMIT_REF: '2222222222222222' });
    expect(second.id).toBe(first.id);
    // ...but the ref is still recorded for traceability
    expect(second.ref).toBe('2222222222222222');
    expect(second.id).not.toContain('2222');
  });

  test('a changed bundle DOES change the id — real code changes still reload tabs', () => {
    expect(runBuildMeta(MANIFEST_B).id).not.toBe(runBuildMeta(MANIFEST_A).id);
  });

  test('FORCE_RELOAD_BUILD is the escape hatch for booting the fleet off an unchanged bundle', () => {
    const plain = runBuildMeta(MANIFEST_A);
    const forced = runBuildMeta(MANIFEST_A, { FORCE_RELOAD_BUILD: '1' });
    expect(forced.id).not.toBe(plain.id);
  });

  test('no asset-manifest → falls back to a unique id (over-reload beats never reloading)', () => {
    expect(runBuildMeta(null).id).not.toBe(runBuildMeta(null).id);
  });
});
