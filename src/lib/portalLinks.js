import { supabase } from './supabase';

const PORTAL_BASE = 'https://nationalsportsapparel.com/coach';

// Portal credentials are deliberately kept in memory. A copied link can outlive the
// staff tab, but the staff browser must never persist the plaintext credential itself.
let activeSessionIdentity = null;
const credentialsByCustomer = new Map();
const pendingByCustomer = new Map();

function sessionIdentity(session) {
  const userId = session?.user?.id;
  if (!userId) return '';
  // last_sign_in_at is stable across access-token refreshes and changes on a new login.
  // Fall back to the access token for older/mocked session shapes.
  return `${userId}:${session.user.last_sign_in_at || session.access_token || ''}`;
}

function appendDeepLink(url, deepLink) {
  const query = String(deepLink || '').trim().replace(/^[?&]+/, '');
  return query ? `${url}&${query}` : url;
}

async function issuePortalToken(customerId, accessToken) {
  const response = await fetch('/.netlify/functions/portal-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ customer_id: customerId, action: 'issue' }),
  });

  let payload = null;
  try { payload = await response.json(); } catch (_) { /* handled below */ }
  if (!response.ok || !payload?.ok || !payload?.token || !payload?.id) {
    throw new Error(payload?.error || `Could not create portal link (${response.status})`);
  }
  return payload.token;
}

export async function getPortalUrl(customerId, deepLink) {
  const id = String(customerId || '').trim();
  if (!id) throw new Error('A customer is required to create a portal link');

  let session;
  try {
    const result = await supabase.auth.getSession();
    if (result?.error) throw result.error;
    session = result?.data?.session;
  } catch (error) {
    throw new Error(`Could not verify your staff session: ${error?.message || 'Please sign in again.'}`);
  }
  if (!session?.access_token || !session?.user?.id) {
    throw new Error('Your staff session has expired. Please sign in again.');
  }

  const identity = sessionIdentity(session);
  if (identity !== activeSessionIdentity) {
    credentialsByCustomer.clear();
    pendingByCustomer.clear();
    activeSessionIdentity = identity;
  }

  let token = credentialsByCustomer.get(id);
  if (!token) {
    let pending = pendingByCustomer.get(id);
    if (!pending) {
      pending = issuePortalToken(id, session.access_token);
      pendingByCustomer.set(id, pending);
    }
    try {
      token = await pending;
      // Another login can take over while this request is in flight. The original
      // caller may use its result, but it must never populate the new identity's cache.
      if (activeSessionIdentity === identity) credentialsByCustomer.set(id, token);
    } finally {
      // A rejected request must remain retryable; a fulfilled one now lives in the cache.
      if (pendingByCustomer.get(id) === pending) pendingByCustomer.delete(id);
    }
  }

  return appendDeepLink(`${PORTAL_BASE}?portal=${encodeURIComponent(token)}`, deepLink);
}

// Test-only reset; keeping it here also makes hot-reload behavior deterministic.
export function _resetPortalLinkCache() {
  activeSessionIdentity = null;
  credentialsByCustomer.clear();
  pendingByCustomer.clear();
}
