// Uniform Builder — public data route.
//
// The uniform tables are staff-only under RLS (00179 lockdown), so the
// login-free builder cannot read uniform_settings/uniform_patterns or write
// uniform_designs with the anon key. This function is the one sanctioned
// bridge: service role behind an allow-list, so the public builder gets
// exactly the curated data it needs and nothing else.
//
// Actions:
//   bootstrap    → admin-curated builder settings + active pattern library
//   save_design  → best-effort save of a coach's design (size-capped)
const { corsHeaders, getSupabaseAdmin } = require('./_shared');

// Only these uniform_settings keys are public. pricing_policy is included on
// purpose: it drives the prices shown to coaches, and the server re-quotes
// from the same row at checkout, so serving it keeps preview === charge.
const PUBLIC_SETTING_KEYS = new Set(['numberStyles', 'palette', 'presets', 'customFonts', 'pricing_policy']);

const response = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

async function bootstrap(sb) {
  const [settingsRes, patternsRes] = await Promise.all([
    sb.from('uniform_settings').select('key,value'),
    sb.from('uniform_patterns').select('id,name,image,tintable,tint_mode').eq('active', true).order('created_at', { ascending: false }).limit(40),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (patternsRes.error) throw patternsRes.error;
  const settings = {};
  for (const row of settingsRes.data || []) {
    if (PUBLIC_SETTING_KEYS.has(row.key)) settings[row.key] = row.value;
  }
  return response(200, { ok: true, settings, patterns: patternsRes.data || [] });
}

async function saveDesign(sb, body) {
  const name = String(body.name || '').trim().slice(0, 120) || 'Custom Uniform';
  const spec = body.spec && typeof body.spec === 'object' ? body.spec : null;
  if (!spec) return response(400, { ok: false, error: 'Missing design spec.' });
  if (JSON.stringify(spec).length > 200000) return response(413, { ok: false, error: 'Design spec is too large.' });
  const thumb = typeof body.thumb === 'string' && body.thumb.length <= 600000 ? body.thumb : null;
  const { data, error } = await sb.from('uniform_designs').insert({ name, spec, thumb }).select('id').single();
  if (error) throw error;
  return response(201, { ok: true, id: data.id });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  let sb;
  try { sb = getSupabaseAdmin(); } catch (_e) { return response(503, { ok: false, error: 'Builder data is not configured.' }); }
  try {
    if (event.httpMethod === 'GET') return await bootstrap(sb);
    if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { ok: false, error: 'Invalid request.' }); }
    if (body.action === 'bootstrap') return await bootstrap(sb);
    if (body.action === 'save_design') return await saveDesign(sb, body);
    return response(400, { ok: false, error: 'Unknown action.' });
  } catch (error) {
    console.error('[uniform-builder-data]', error.message);
    return response(500, { ok: false, error: 'Builder data is temporarily unavailable.' });
  }
};

exports._test = { bootstrap, saveDesign };
