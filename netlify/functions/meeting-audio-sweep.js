// Hourly backstop for AI meeting notes: audio is never kept. Processing deletes
// it as soon as the transcript is saved; this removes whatever a failed,
// abandoned or discarded recording left behind after 24 hours, and marks
// recordings nobody finished (browser closed mid-recording) as failed.
const { getSupabaseAdmin } = require('./_shared');
const { purgeAudio } = require('./_meetingPipeline');

exports.handler = async () => {
  const admin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await admin.from('meetings')
    .select('id,team_member_id,status')
    .is('audio_purged_at', null)
    .neq('mode', 'pasted')
    .lt('created_at', cutoff)
    .limit(200);
  if (error) {
    console.error('[meeting-audio-sweep]', error.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
  let purged = 0;
  for (const m of data || []) {
    try {
      purged += await purgeAudio(admin, m);
      if (m.status === 'recording' || m.status === 'processing') {
        await admin.from('meetings').update({ status: 'failed', error: 'Recording was never finished; the audio has expired.', updated_at: new Date().toISOString() })
          .eq('id', m.id).in('status', ['recording', 'processing']);
      }
    } catch (e) {
      console.error('[meeting-audio-sweep]', m.id, e.message);
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, meetings: (data || []).length, files: purged }) };
};
