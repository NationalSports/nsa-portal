const { createClient } = require('@supabase/supabase-js');
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON' }); }
  const { alphaTag, action, id, version, decision, comment } = body;
  if (typeof alphaTag !== 'string' || !alphaTag.trim() || !['list','decide'].includes(action)) return reply(400, { error: 'Portal and action required' });
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return reply(503, { error: 'Portal unavailable' });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: parents, error } = await db.from('customers').select('id').eq('alpha_tag', alphaTag.trim());
    if (error) throw error;
    if (!parents?.length) return reply(403, { error: 'Unknown portal' });
    const { data: children, error: childError } = await db.from('customers').select('id').in('parent_id', parents.map(c => c.id));
    if (childError) throw childError;
    const family = [...parents, ...(children || [])].map(c => c.id);
    if (action === 'decide') {
      if (typeof id !== 'string' || !Number.isInteger(version) || !['approve','reject'].includes(decision) || typeof comment !== 'string' || comment.length > 5000 || (decision === 'reject' && !comment.trim())) return reply(400, { error: 'Choose a decision and describe any requested changes' });
      const { data: row, error: rowError } = await db.from('standalone_art_requests').select('id').eq('id', id).in('customer_id', family).maybeSingle();
      if (rowError) throw rowError;
      if (!row) return reply(403, { error: 'Artwork not in this portal' });
      const { data, error: decisionError } = await db.rpc('decide_standalone_art_proof', { p_id: id, p_alpha_tag: alphaTag.trim(), p_version: version, p_decision: decision, p_comment: comment });
      if (decisionError) return reply(409, { error: 'This proof could not be reviewed. Refresh to see the latest artwork or contact your rep.' });
      return reply(200, { proof: data });
    }
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error: listError } = await db.from('standalone_art_requests')
        .select('id,art_name,estimate_id,so_id,color_way_label,portal_proofs').in('customer_id', family)
        .neq('portal_proofs', '[]').order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
      if (listError) throw listError;
      // Never expose internal instructions, references, or staff identity to customers.
      rows.push(...data.map(r => ({ ...r, portal_proofs: r.portal_proofs.map(({ shared_by, ...proof }) => proof) })));
      if (data.length < 500) break;
    }
    return reply(200, { requests: rows });
  } catch (error) {
    console.error('Art portal request failed:', error.message);
    return reply(500, { error: 'Could not load artwork. Please try again.' });
  }
};
