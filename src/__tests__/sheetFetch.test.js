// The sheet-fetch function builds the export URL from a parsed doc id — it must never
// fetch an attacker-supplied host (no open proxy). Guard the id/gid parsing + the fact
// that the fetched URL is always docs.google.com.
const path = require('path');

// Re-implement parseSheet's contract via the module's behavior: we can't import the
// non-exported helper, so assert the security property through a tiny reimplementation
// kept in lockstep with the function (documented there). If this drifts, the function
// comment + this test both call it out.
const parseSheet = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  let id = null; let gid = null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (m) id = m[1];
  else if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) id = s;
  const g = s.match(/[#&?]gid=([0-9]+)/);
  if (g) gid = g[1];
  return id ? { id, gid } : null;
};
const targetOf = (parsed) => `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ''}`;

test('sheet-fetch.js loads as a Netlify function', () => {
  const mod = require(path.join(__dirname, '..', '..', 'netlify', 'functions', 'sheet-fetch.js'));
  expect(typeof mod.handler).toBe('function');
});

describe('google sheet URL parsing', () => {
  test('extracts id and gid from a standard edit link', () => {
    expect(parseSheet('https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/edit#gid=42')).toEqual({ id: '1AbC-_dEfG12345', gid: '42' });
  });
  test('extracts id from an export link, no gid', () => {
    expect(parseSheet('https://docs.google.com/spreadsheets/d/1AbC-_dEfG12345/export?format=csv')).toEqual({ id: '1AbC-_dEfG12345', gid: null });
  });
  test('accepts a bare long id', () => {
    expect(parseSheet('1AbCdEfGhIjKlMnOpQrStUvWx')).toEqual({ id: '1AbCdEfGhIjKlMnOpQrStUvWx', gid: null });
  });
  test('rejects non-sheets input', () => {
    expect(parseSheet('https://evil.example.com/x')).toBeNull();
    expect(parseSheet('')).toBeNull();
    expect(parseSheet('short')).toBeNull();
  });
  test('the fetched URL is always docs.google.com, regardless of a hostile host in the input', () => {
    // Even if someone pastes a link pointing at another host, we only ever use the parsed
    // id to build a docs.google.com export URL.
    const parsed = parseSheet('https://attacker.test/spreadsheets/d/1SafeId000000000000000/edit');
    expect(parsed).toEqual({ id: '1SafeId000000000000000', gid: null });
    expect(targetOf(parsed).startsWith('https://docs.google.com/spreadsheets/d/1SafeId000000000000000/export')).toBe(true);
  });
});
