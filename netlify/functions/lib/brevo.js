// Single chokepoint for every Brevo API call made from a Netlify function.
//
// Why this exists: Brevo emails a "your key was used from a new IP" security
// alert each time the key is used from an unfamiliar IP. Our functions run on
// serverless (rotating AWS IPs), so Brevo fired ~50 of those a day. The fix is
// to route ALL Brevo traffic through a single static-IP relay (see
// /brevo-relay) and authorize that one IP in Brevo.
//
// Behaviour:
//   • BREVO_RELAY_URL set  -> send to the relay, authenticated with
//     BREVO_RELAY_SECRET. The relay injects the real api-key and forwards to
//     Brevo from its stable IP.
//   • otherwise            -> call Brevo directly with BREVO_API_KEY, exactly
//     as before (local dev, or before the relay is cut over).
//
// Files in this `lib/` subdirectory are NOT published as their own Netlify
// endpoints (only top-level files in the functions dir are); esbuild bundles
// this into each function that requires it.

const BREVO_API_BASE = 'https://api.brevo.com';

const directKey = () =>
  process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';

// True when we can reach Brevo at all (relay OR direct key). Callers use this
// for their "is email configured?" guard instead of checking the key directly,
// because once we cut over to the relay the key no longer lives in this env.
const brevoConfigured = () => !!(process.env.BREVO_RELAY_URL || directKey());

// Make a Brevo API call. `path` is the Brevo path, e.g. '/v3/smtp/email'.
// `init` is passed through to fetch; auth headers are added here.
async function brevoFetch(path, init = {}) {
  const relay = process.env.BREVO_RELAY_URL;
  const headers = { accept: 'application/json', ...(init.headers || {}) };

  let url;
  if (relay) {
    url = relay.replace(/\/+$/, '') + path;
    headers['x-relay-secret'] = process.env.BREVO_RELAY_SECRET || '';
  } else {
    url = BREVO_API_BASE + path;
    headers['api-key'] = directKey();
  }
  return fetch(url, { ...init, headers });
}

module.exports = { brevoFetch, brevoConfigured };
