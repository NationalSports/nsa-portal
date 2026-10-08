import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the artifact outside the checkout: importing source with the repo's
// node_modules present masked the production MODULE_NOT_FOUND startup failure.
// Install the pinned bundler in CI's temporary directory, not app dependencies.
test('isolated Netlify Showcase bundle boots and reads the requested job', async () => {
  const { zipFunction } = await import(pathToFileURL(process.env.SHOWCASE_BUNDLER_PATH).href);
  const dest = await mkdtemp(join(tmpdir(), 'showcase-bundle-'));
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  try {
    const result = await zipFunction('netlify/functions/showcase-image-background.mjs', dest, {
      archiveFormat: 'none', basePath: resolve('.'), config: { '*': { nodeVersion: '22', includedFiles: ['src/lib/showcaseSettings.js'] } },
    });
    assert.equal(result.runtimeAPIVersion, 2);
    assert.equal(result.invocationMode, 'background');
    const entry = await import(pathToFileURL(join(result.path, 'netlify/functions/showcase-image-background.mjs')).href);
    process.env.INTERNAL_FUNCTION_SECRET = 'test-only';
    process.env.REACT_APP_SUPABASE_URL = 'https://showcase-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
    const reads = [];
    globalThis.fetch = async (url) => {
      reads.push(String(url));
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const asset = '11111111-1111-4111-8111-111111111111';
    const request = '22222222-2222-4222-8222-222222222222';
    const response = await entry.default(new Request('https://example.test/.netlify/functions/showcase-image-background', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': 'test-only' },
      body: JSON.stringify({ asset_id: asset, generation_request_id: request }),
    }), { requestId: 'test' });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).stale, true);
    assert.equal(reads.length, 1);
    const read = new URL(reads[0]);
    assert.equal(read.pathname, '/rest/v1/webstore_showcase_assets');
    assert.equal(read.searchParams.get('id'), `eq.${asset}`);
    assert.equal(read.searchParams.get('generation_request_id'), `eq.${request}`);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await rm(dest, { recursive: true, force: true });
  }
});
