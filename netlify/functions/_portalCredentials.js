const crypto = require('crypto');
const { tokenHash } = require('./_portalAuth');

// Called only after the caller has authenticated and established customer scope.
// The returned bearer credential is shown/sent once; only its hash is stored.
async function issuePortalCredential(admin, customerId, { label = 'Portal link' } = {}) {
  if (typeof customerId !== 'string' || !customerId.trim()) throw new Error('Customer required');
  const token = crypto.randomBytes(32).toString('base64url');
  const { data, error } = await admin.from('portal_access_credentials').insert({
    customer_id: customerId.trim(), credential_hash: tokenHash(token),
    credential_kind: 'token', label: String(label).slice(0, 120),
  }).select('id').single();
  if (error || !data?.id) throw new Error('Portal link could not be saved');
  return { token, id: data.id };
}

module.exports = { issuePortalCredential };
