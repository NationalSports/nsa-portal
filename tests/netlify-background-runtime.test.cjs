const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const workers = ['omg-order-sync-background', 'omg-profit-sync-background', 'momentec-sync-background', 'momentec-image-verify-background', 'onboarding-finalize-background'];

for (const name of workers) {
  test(`${name} preserves the legacy request on the modern background runtime`, async () => {
    const worker = require(`../netlify/functions/_${name}.js`);
    const original = worker.handler;
    const events = [];
    // Replace only the worker's I/O boundary; exercise the actual entry and SDK.
    worker.handler = async event => {
      events.push(event);
      return { statusCode: 401, headers: { 'content-type': 'application/json' }, body: '{"error":"Unauthorized"}' };
    };
    let entry;
    try {
      entry = await import(pathToFileURL(path.join(__dirname, `../netlify/functions/${name}.mjs`)).href);
    } finally {
      worker.handler = original;
    }
    assert.equal(entry.config.background, true);
    const request = new Request(`https://example.test/.netlify/functions/${name}?design=790&limit=1`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-only', 'x-internal-secret': 'test-only' },
      body: JSON.stringify({ token: 'test-token', force: false }),
    });
    const response = await entry.default(request, { requestId: 'test-request' });
    assert.equal(events.length, 1);
    assert.equal(events[0].httpMethod, 'POST');
    assert.equal(events[0].path, `/.netlify/functions/${name}`);
    assert.deepEqual(events[0].queryStringParameters, { design: '790', limit: '1' });
    assert.equal(events[0].headers.authorization, 'Bearer test-only');
    assert.equal(events[0].headers['x-internal-secret'], 'test-only');
    assert.deepEqual(JSON.parse(events[0].body), { token: 'test-token', force: false });
    assert.equal(events[0].isBase64Encoded, false);
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '{"error":"Unauthorized"}');
  });
}
