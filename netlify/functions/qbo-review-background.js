const { verifyQBOUser, getSupabaseAdmin } = require('./_shared');
const { getValidAccessToken, qbRequest } = require('./_qb');
const { runReview, reviewStore } = require('./_qboServerReview');
const { reviewEnabled } = require('./_qboReviewConfig');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  const auth = await verifyQBOUser(event);
  if (!auth.ok) return { statusCode: auth.status };
  // Preview deployments must never run against the production ledger.
  const expectedRealm = process.env.QBO_REVIEW_REALM_ID;
  if (!reviewEnabled())
    return { statusCode: 409, body: 'Server review is disabled' };
  const admin = getSupabaseAdmin();
  const result = await runReview({ store: reviewStore(admin), realm: expectedRealm, requestedBy: auth.userId,
    queryInvoices: async ids => {
      const token = await getValidAccessToken(admin, 'national');
      if (String(token.realm_id) !== expectedRealm) throw new Error('realm_changed');
      const sql = `SELECT Id, DocNumber, TotalAmt, Balance FROM Invoice WHERE Id IN ('${ids.join("','")}') MAXRESULTS 100`;
      // GET is fixed here: there is no action, payload, realm, or mode supplied
      // by the caller and no transaction write route in this worker.
      const response = await qbRequest('GET', `/v3/company/${expectedRealm}/query?query=${encodeURIComponent(sql)}`, token.access_token, null, false);
      if (response.status !== 200 || response.data?.Fault || !response.data?.QueryResponse) throw new Error('qbo_read_failed');
      return response.data.QueryResponse.Invoice || [];
    } });
  return { statusCode: 200, body: JSON.stringify({ id: result.id, status: result.status }) };
};
