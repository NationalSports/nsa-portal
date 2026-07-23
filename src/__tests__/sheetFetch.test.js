// The sheet-fetch function builds the export URL from a parsed doc id — it must never
// fetch an attacker-supplied host (no open proxy). These tests drive the REAL handler
// with a mocked global.fetch and assert on the URL it actually requests, so the
// security property is checked against production code, not a reimplementation.
const path = require('path');

const { handler } = require(path.join(__dirname, '..', '..', 'netlify', 'functions', 'sheet-fetch.js'));

const csvResponse = () => ({
  ok: true,
  headers: { get: () => 'text/csv' },
  text: async () => 'a,b\n1,2',
});

const invoke = async (url) => {
  const calls = [];
  global.fetch = jest.fn(async (target) => { calls.push(target); return csvResponse(); });
  const res = await handler({ httpMethod: 'GET', queryStringParameters: url === undefined ? null : { url } });
  return { res, calls };
};

afterEach(() => { delete global.fetch; });

test('sheet-fetch.js loads as a Netlify function', () => {
  expect(typeof handler).toBe('function');
});

describe('sheet-fetch handler (real module)', () => {
  test('standard edit link: fetches docs.google.com export URL with id and gid', async () => {
    const { res, calls } = await invoke('https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/edit#gid=42');
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/export?format=csv&gid=42']);
  });

  test('export link without gid: no gid param in fetched URL', async () => {
    const { res, calls } = await invoke('https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/export?format=csv');
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/export?format=csv']);
  });

  test('bare long id is accepted', async () => {
    const { res, calls } = await invoke('1AbCdEfGhIjKlMnOpQrStUvWx');
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/export?format=csv']);
  });

  test('non-sheets input is rejected with 400 and nothing is fetched', async () => {
    for (const bad of ['https://evil.example.com/x', 'short', '   ']) {
      const { res, calls } = await invoke(bad);
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  test('missing url parameter returns 400 and nothing is fetched', async () => {
    const { res, calls } = await invoke(undefined);
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  test('hostile host in the pasted link: only docs.google.com is ever fetched', async () => {
    const { res, calls } = await invoke('https://attacker.test/spreadsheets/d/1SafeId000000000000000/edit');
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).origin).toBe('https://docs.google.com');
    expect(calls[0]).toContain('/spreadsheets/d/1SafeId000000000000000/export');
  });

  test('gid smuggled via a hostile query string never changes the host', async () => {
    const { calls } = await invoke('https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/edit?gid=7&x=https://evil.test');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).origin).toBe('https://docs.google.com');
  });

  test('private sheet (HTML sign-in page) maps to 403, not a CSV passthrough', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<!doctype html><html>sign in</html>',
    }));
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { url: 'https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/edit' } });
    expect(res.statusCode).toBe(403);
  });

  test('network failure maps to 502, not an unhandled throw', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); });
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { url: 'https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/edit' } });
    expect(res.statusCode).toBe(502);
  });
});
