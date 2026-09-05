const crypto = require('crypto');

const CREDENTIAL_TABLE = 'portal_access_credentials';
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

const normalizePresentedCredential = (value) => String(value || '').trim();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokenHash = (value) => sha256('portal-token-v1:' + normalizePresentedCredential(value));
const legacyHash = (value) => sha256('portal-legacy-v1:' + normalizePresentedCredential(value).toLowerCase());

function credentialTableMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  // PGRST204 is a missing-column error. Treating it as a missing table would
  // reopen legacy alpha-tag fallback when the credential table is present but
  // its schema is broken, defeating revocation. PGRST205 is the table lookup
  // failure emitted by PostgREST.
  return ['42P01', 'PGRST205'].includes(code)
    || /(?:relation|table)[^\n]*portal_access_credentials[^\n]*does not exist/i.test(message);
}

async function legacyOwners(admin, presented) {
  const escaped = presented.replace(/([%_\\])/g, '\\$1');
  let { data, error } = await admin.from('customers')
    .select('id,parent_id,alpha_tag').ilike('alpha_tag', escaped);
  if (error) return { error: error.message };
  if (!data || !data.length) {
    const all = await admin.from('customers').select('id,parent_id,alpha_tag').not('alpha_tag', 'is', null);
    if (all.error) return { error: all.error.message };
    const normalized = presented.toLowerCase();
    data = (all.data || []).filter((row) => String(row.alpha_tag || '').trim().toLowerCase() === normalized);
  }
  if (!data.length) return { error: 'Unknown portal credential', notFound: true };
  return { owners: data.map(({ id, parent_id }) => ({ id, parent_id })) };
}

async function credentialOwners(admin, presented) {
  const hashes = [tokenHash(presented), legacyHash(presented)];
  const { data, error } = await admin.from(CREDENTIAL_TABLE)
    .select('customer_id,credential_kind,expires_at,disabled_at')
    .in('credential_hash', hashes);

  // The function and credential-table migrations can be deployed in either order.
  // Fall back only while the table itself is absent. Once it exists, a miss is a miss:
  // silently consulting customers.alpha_tag would make token revocation ineffective.
  if (error) {
    if (credentialTableMissing(error)) return legacyOwners(admin, presented);
    return { error: error.message };
  }

  const now = Date.now();
  const active = (data || []).filter((row) => !row.disabled_at && (!row.expires_at || Date.parse(row.expires_at) > now));
  if (!active.length) return { error: 'Unknown portal credential', notFound: true };
  const ownerIds = [...new Set(active.map((row) => row.customer_id).filter(Boolean))];
  if (ownerIds.length !== 1) return { error: 'Ambiguous portal credential' };

  const { data: owners, error: ownerError } = await admin.from('customers')
    .select('id,parent_id').in('id', ownerIds);
  if (ownerError) return { error: ownerError.message };
  if (!owners || owners.length !== 1) return { error: 'Unknown portal credential', notFound: true };
  return { owners };
}

async function resolvePortalCredential(admin, credential) {
  const presented = normalizePresentedCredential(credential);
  if (!presented || presented.length > 512) return { error: 'Unknown portal credential', notFound: true };

  // Cache by a one-way digest so bearer credentials are not retained in warm-container memory.
  const key = tokenHash(presented);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, fam: new Set(hit.value.familyIds) };

  const found = await credentialOwners(admin, presented);
  if (found.error) return found;
  const ownerIds = found.owners.map((row) => row.id);
  const directParentIds = found.owners.map((row) => row.parent_id).filter(Boolean);
  const { data: children, error } = await admin.from('customers')
    .select('id').in('parent_id', ownerIds);
  if (error) return { error: error.message };

  // A parent credential sees its direct teams. A team credential sees itself and
  // its parent, but not siblings. This matches the existing coach-portal boundary.
  const familyIds = [...new Set([...ownerIds, ...directParentIds, ...(children || []).map((row) => row.id)])];
  const value = { ownerIds, familyIds };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return { ...value, fam: new Set(familyIds) };
}

module.exports = {
  credentialTableMissing,
  legacyHash,
  normalizePresentedCredential,
  resolvePortalCredential,
  tokenHash,
  _cache: cache,
};
