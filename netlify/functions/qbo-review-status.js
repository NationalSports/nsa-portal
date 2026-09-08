const { verifyQBOUser, getSupabaseAdmin } = require('./_shared');
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{}' };
  const auth = await verifyQBOUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: '{}' };
  const { data, error } = await getSupabaseAdmin().from('qbo_review_runs')
    .select('*').eq('company_key','national').order('started_at', { ascending: false }).limit(10);
  return { statusCode: error ? 503 : 200, headers, body: JSON.stringify(error ? { error: 'Run history unavailable' } : { runs: data }) };
};
