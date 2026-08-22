// ═══════════════════════════════════════════════════════════════════════
// NETSUITE TOKEN-BASED AUTHENTICATION — OAuth 1.0a request signing
//
// NetSuite's SuiteTalk REST endpoint does not accept bearer tokens; it wants
// a full OAuth 1.0a signature (HMAC-SHA256) with the account id as `realm`.
// This module is the signing half, kept separate from the handler so the
// signature construction can be unit-tested without live credentials —
// a wrong signature comes back as a bare 401 with no diagnostic, so
// "test it against the real endpoint" is a terrible debugging loop.
//
// Reference: RFC 5849 §3.4 (signature base string, signing key) and
// NetSuite's TBA docs (realm, HMAC-SHA256).
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// RFC 3986 percent-encoding. encodeURIComponent leaves ! ' ( ) * alone,
// which OAuth requires encoded — getting this wrong is the single most
// common cause of a silent 401.
function pctEncode(str) {
  return encodeURIComponent(String(str === null || str === undefined ? '' : str))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Sort by encoded key, then by encoded value (RFC 5849 §3.4.1.3.2).
function normalizeParams(params) {
  const pairs = [];
  for (const key of Object.keys(params || {})) {
    const val = params[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      for (const v of val) pairs.push([pctEncode(key), pctEncode(v)]);
    } else {
      pairs.push([pctEncode(key), pctEncode(val)]);
    }
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  return pairs.map(p => `${p[0]}=${p[1]}`).join('&');
}

// The base URL must exclude the query string and default ports, and be
// lower-cased in scheme/host (RFC 5849 §3.4.1.2).
function normalizeBaseUrl(rawUrl) {
  const u = new URL(rawUrl);
  const scheme = u.protocol.replace(':', '').toLowerCase();
  const host = u.hostname.toLowerCase();
  const port = u.port;
  const isDefault = (scheme === 'https' && (port === '' || port === '443'))
    || (scheme === 'http' && (port === '' || port === '80'));
  return `${scheme}://${host}${isDefault ? '' : ':' + port}${u.pathname}`;
}

function queryParamsOf(rawUrl) {
  const u = new URL(rawUrl);
  const out = {};
  for (const [k, v] of u.searchParams.entries()) {
    if (out[k] === undefined) out[k] = v;
    else if (Array.isArray(out[k])) out[k].push(v);
    else out[k] = [out[k], v];
  }
  return out;
}

function buildBaseString(method, rawUrl, oauthParams) {
  const all = Object.assign({}, queryParamsOf(rawUrl), oauthParams);
  return [
    String(method).toUpperCase(),
    pctEncode(normalizeBaseUrl(rawUrl)),
    pctEncode(normalizeParams(all)),
  ].join('&');
}

function signingKey(consumerSecret, tokenSecret) {
  return `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
}

function sign(baseString, key) {
  return crypto.createHmac('sha256', key).update(baseString, 'utf8').digest('base64');
}

// `nonce` and `timestamp` are injectable so tests can pin them; production
// callers omit them and get fresh random values.
function buildAuthHeader(opts) {
  const {
    method, url, accountId,
    consumerKey, consumerSecret, tokenId, tokenSecret,
    nonce, timestamp,
  } = opts;

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: tokenId,
    oauth_version: '1.0',
  };

  const baseString = buildBaseString(method, url, oauthParams);
  const signature = sign(baseString, signingKey(consumerSecret, tokenSecret));

  // realm is NOT part of the signature but IS required by NetSuite. It is the
  // account id, upper-cased (sandbox ids keep their _SB1 suffix).
  const headerParams = Object.assign({}, oauthParams, { oauth_signature: signature });
  const rendered = Object.keys(headerParams).sort()
    .map(k => `${pctEncode(k)}="${pctEncode(headerParams[k])}"`)
    .join(', ');

  return {
    header: `OAuth realm="${pctEncode(String(accountId).toUpperCase())}", ${rendered}`,
    baseString,
    signature,
  };
}

// Credentials come from Netlify env vars; never from the client.
function readCredentials(env) {
  const e = env || process.env;
  const creds = {
    accountId: e.NETSUITE_ACCOUNT_ID,
    consumerKey: e.NETSUITE_CONSUMER_KEY,
    consumerSecret: e.NETSUITE_CONSUMER_SECRET,
    tokenId: e.NETSUITE_TOKEN_ID,
    tokenSecret: e.NETSUITE_TOKEN_SECRET,
  };
  const missing = Object.keys(creds).filter(k => !creds[k]);
  return { creds, missing };
}

function restBaseUrl(accountId) {
  // NetSuite lower-cases the account id in the hostname and swaps _ for -.
  const host = String(accountId).toLowerCase().replace(/_/g, '-');
  return `https://${host}.suitetalk.api.netsuite.com`;
}

module.exports = {
  pctEncode, normalizeParams, normalizeBaseUrl, queryParamsOf,
  buildBaseString, signingKey, sign, buildAuthHeader,
  readCredentials, restBaseUrl,
};
