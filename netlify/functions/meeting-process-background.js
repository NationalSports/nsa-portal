// Background worker for AI meeting notes: transcribe (AssemblyAI) and extract
// the draft (Claude) for one meeting. Started by meeting-notes with the internal
// secret; Netlify background functions get 15 minutes, enough for a long meeting.
const { getSupabaseAdmin, safeEqualStr } = require('./_shared');
const { processMeeting } = require('./_meetingPipeline');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  const provided = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
  const expected = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!provided || !expected || !safeEqualStr(provided, expected)) return { statusCode: 401, body: 'Unauthorized' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!UUID_RE.test(String(body.meeting_id || ''))) return { statusCode: 400, body: 'Invalid meeting id' };
  const result = await processMeeting(getSupabaseAdmin(), body.meeting_id);
  return { statusCode: 200, body: JSON.stringify(result) };
};
