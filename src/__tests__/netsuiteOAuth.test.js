const {
  pctEncode, normalizeParams, normalizeBaseUrl, queryParamsOf,
  buildBaseString, signingKey, sign, buildAuthHeader,
  readCredentials, restBaseUrl,
} = require('../../netlify/functions/_netsuiteOAuth');

const { assertReadOnly, namedQuery } = require('../../netlify/functions/netsuite-suiteql');

// A wrong OAuth signature comes back from NetSuite as a bare 401 with no
// diagnostic, so these tests exist to catch the construction errors that
// would otherwise only show up as an unexplained auth failure.

describe('percent encoding (RFC 3986)', () => {
  it('encodes the characters encodeURIComponent leaves alone', () => {
    // These five are the classic OAuth 1.0a signature-mismatch cause.
    expect(pctEncode("!")).toBe('%21');
    expect(pctEncode("'")).toBe('%27');
    expect(pctEncode('(')).toBe('%28');
    expect(pctEncode(')')).toBe('%29');
    expect(pctEncode('*')).toBe('%2A');
  });

  it('leaves unreserved characters untouched', () => {
    expect(pctEncode('abcXYZ019-._~')).toBe('abcXYZ019-._~');
  });

  it('encodes reserved characters and spaces', () => {
    expect(pctEncode('a b')).toBe('a%20b');
    expect(pctEncode('a&b=c')).toBe('a%26b%3Dc');
    expect(pctEncode('a/b')).toBe('a%2Fb');
  });

  it('uses uppercase hex', () => {
    expect(pctEncode('~!*')).toBe('~%21%2A');
    expect(pctEncode(' ')).toBe('%20');
  });
});

describe('parameter normalisation', () => {
  it('sorts by encoded key', () => {
    expect(normalizeParams({ b: '2', a: '1', c: '3' })).toBe('a=1&b=2&c=3');
  });

  it('sorts by value when keys collide', () => {
    expect(normalizeParams({ a: ['2', '1'] })).toBe('a=1&a=2');
  });

  it('percent-encodes both sides before sorting', () => {
    expect(normalizeParams({ 'a b': 'c d' })).toBe('a%20b=c%20d');
  });

  it('drops null and undefined rather than emitting empty pairs', () => {
    expect(normalizeParams({ a: '1', b: null, c: undefined })).toBe('a=1');
  });
});

describe('base URL normalisation (RFC 5849 §3.4.1.2)', () => {
  it('strips the query string', () => {
    expect(normalizeBaseUrl('https://x.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=10&offset=0'))
      .toBe('https://x.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql');
  });

  it('drops the default port but keeps a non-default one', () => {
    expect(normalizeBaseUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeBaseUrl('http://example.com:80/a')).toBe('http://example.com/a');
    expect(normalizeBaseUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
  });

  it('lower-cases scheme and host', () => {
    expect(normalizeBaseUrl('HTTPS://Example.COM/a')).toBe('https://example.com/a');
  });

  it('extracts query params separately so they can be signed', () => {
    expect(queryParamsOf('https://e.com/a?limit=10&offset=0')).toEqual({ limit: '10', offset: '0' });
  });
});

describe('signature base string', () => {
  const oauth = {
    oauth_consumer_key: 'ck',
    oauth_nonce: 'nonce123',
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: '1700000000',
    oauth_token: 'tk',
    oauth_version: '1.0',
  };

  it('is METHOD & encoded-url & encoded-params', () => {
    const bs = buildBaseString('POST', 'https://e.com/suiteql', oauth);
    const parts = bs.split('&');
    expect(parts[0]).toBe('POST');
    expect(parts[1]).toBe(pctEncode('https://e.com/suiteql'));
  });

  it('folds the query string into the signed parameters', () => {
    const bs = buildBaseString('POST', 'https://e.com/suiteql?limit=1000&offset=0', oauth);
    // limit and offset must be inside the signed parameter blob.
    expect(decodeURIComponent(bs.split('&')[2])).toContain('limit=1000');
    expect(decodeURIComponent(bs.split('&')[2])).toContain('offset=0');
  });

  it('excludes the JSON request body — correct for SuiteQL', () => {
    // OAuth only folds in form-encoded bodies. SuiteQL posts JSON, so the
    // body must NOT appear; including it is a common 401 cause.
    const bs = buildBaseString('POST', 'https://e.com/suiteql', oauth);
    expect(bs).not.toContain('SELECT');
    // No parameter named `q` may appear among the signed params.
    const signedParams = decodeURIComponent(bs.split('&')[2]).split('&').map(p => p.split('=')[0]);
    expect(signedParams).not.toContain('q');
    expect(signedParams.sort()).toEqual(Object.keys(oauth).sort());
  });

  it('upper-cases the method', () => {
    expect(buildBaseString('post', 'https://e.com/a', oauth).startsWith('POST&')).toBe(true);
  });
});

describe('signing key and HMAC', () => {
  it('joins the two secrets with & and encodes each', () => {
    expect(signingKey('cs', 'ts')).toBe('cs&ts');
    expect(signingKey('c s', 't&s')).toBe('c%20s&t%26s');
  });

  it('computes a genuine HMAC-SHA256 (RFC 4231 test case 1)', () => {
    // Independent published vector — verifies the algorithm is really
    // SHA-256 and the output is base64 of the raw digest.
    const key = Buffer.from('0b'.repeat(20), 'hex');
    const expectedHex = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7';
    const expectedB64 = Buffer.from(expectedHex, 'hex').toString('base64');
    expect(sign('Hi There', key)).toBe(expectedB64);
  });

  it('is deterministic for a fixed base string and key', () => {
    expect(sign('abc', 'key')).toBe(sign('abc', 'key'));
  });

  it('changes when the base string changes', () => {
    expect(sign('abc', 'key')).not.toBe(sign('abd', 'key'));
  });
});

describe('Authorization header', () => {
  const opts = {
    method: 'POST',
    url: 'https://6108444.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0',
    accountId: '6108444',
    consumerKey: 'CK', consumerSecret: 'CS',
    tokenId: 'TK', tokenSecret: 'TS',
    nonce: 'fixednonce', timestamp: 1700000000,
  };

  it('includes realm plus every required oauth parameter', () => {
    const { header } = buildAuthHeader(opts);
    expect(header).toMatch(/^OAuth realm="6108444", /);
    for (const k of ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version']) {
      expect(header).toContain(`${k}="`);
    }
    expect(header).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it('upper-cases the realm — NetSuite rejects a lower-case sandbox realm', () => {
    const { header } = buildAuthHeader({ ...opts, accountId: '6108444_sb1' });
    expect(header).toContain('realm="6108444_SB1"');
  });

  it('is reproducible with a pinned nonce and timestamp', () => {
    expect(buildAuthHeader(opts).signature).toBe(buildAuthHeader(opts).signature);
  });

  it('produces a different signature when the token secret changes', () => {
    const a = buildAuthHeader(opts).signature;
    const b = buildAuthHeader({ ...opts, tokenSecret: 'OTHER' }).signature;
    expect(a).not.toBe(b);
  });

  it('signs the query parameters — changing limit changes the signature', () => {
    const a = buildAuthHeader(opts).signature;
    const b = buildAuthHeader({ ...opts, url: opts.url.replace('limit=1000', 'limit=500') }).signature;
    expect(a).not.toBe(b);
  });

  it('percent-encodes the signature inside the header', () => {
    const { header, signature } = buildAuthHeader(opts);
    expect(header).toContain(`oauth_signature="${pctEncode(signature)}"`);
    // A raw + or / from base64 must not appear unencoded.
    expect(/oauth_signature="[^"]*[+/]/.test(header)).toBe(false);
  });
});

describe('credentials and host', () => {
  it('names exactly which env vars are missing', () => {
    const { missing } = readCredentials({});
    expect(missing.sort()).toEqual([
      'accountId', 'consumerKey', 'consumerSecret', 'tokenId', 'tokenSecret',
    ]);
  });

  it('reports none missing when all five are set', () => {
    const { missing, creds } = readCredentials({
      NETSUITE_ACCOUNT_ID: '6108444', NETSUITE_CONSUMER_KEY: 'a',
      NETSUITE_CONSUMER_SECRET: 'b', NETSUITE_TOKEN_ID: 'c', NETSUITE_TOKEN_SECRET: 'd',
    });
    expect(missing).toEqual([]);
    expect(creds.accountId).toBe('6108444');
  });

  it('builds the SuiteTalk host, lower-cased with underscores swapped', () => {
    expect(restBaseUrl('6108444')).toBe('https://6108444.suitetalk.api.netsuite.com');
    expect(restBaseUrl('6108444_SB1')).toBe('https://6108444-sb1.suitetalk.api.netsuite.com');
  });
});

describe('query safety gate', () => {
  it('accepts a plain SELECT', () => {
    expect(assertReadOnly('SELECT * FROM account')).toBe('SELECT * FROM account');
  });

  it('rejects anything that is not a SELECT', () => {
    expect(() => assertReadOnly('DELETE FROM account')).toThrow(/Only SELECT/);
    expect(() => assertReadOnly('UPDATE account SET x=1')).toThrow(/Only SELECT/);
    expect(() => assertReadOnly('')).toThrow(/Empty query/);
  });

  it('rejects statement chaining', () => {
    expect(() => assertReadOnly('SELECT 1; DROP TABLE account')).toThrow(/Multiple statements/);
  });

  it('allows a semicolon inside a string literal', () => {
    expect(() => assertReadOnly("SELECT * FROM account WHERE name = 'a;b'")).not.toThrow();
  });

  it('rejects a write verb hidden after a SELECT', () => {
    expect(() => assertReadOnly('SELECT * FROM a WHERE x IN (INSERT INTO b VALUES (1))')).toThrow(/Only SELECT/);
  });
});

describe('named queries', () => {
  it('builds the invoice + credit memo pull covering both types', () => {
    const q = namedQuery('invoices_with_tax', 2025);
    expect(q).toContain("'CustInvc'");
    expect(q).toContain("'CustCred'"); // credit memos — the §6 gap
    expect(q).toContain('2025-01-01');
    expect(q).toContain('2025-12-31');
  });

  it('restricts the GL pull to posting transactions', () => {
    expect(namedQuery('gl_detail', 2024)).toContain("t.posting = 'T'");
  });

  it('does not require a year for the chart of accounts', () => {
    expect(() => namedQuery('chart_of_accounts')).not.toThrow();
  });

  it('rejects an implausible or non-numeric year rather than interpolating it', () => {
    expect(() => namedQuery('gl_detail', '1999')).toThrow(/valid fiscal year/);
    expect(() => namedQuery('gl_detail', "2025' OR '1'='1")).toThrow(/valid fiscal year/);
    expect(() => namedQuery('gl_detail', undefined)).toThrow(/valid fiscal year/);
  });

  it('rejects an unknown report name', () => {
    expect(() => namedQuery('nope', 2025)).toThrow(/Unknown report/);
  });

  it('ignores a malformed asOf date instead of interpolating it', () => {
    const q = namedQuery('trial_balance', 2025, "2025-06-01' OR '1'='1");
    expect(q).not.toContain("OR '1'='1");
    expect(q).toContain('2025-12-31');
  });
});
