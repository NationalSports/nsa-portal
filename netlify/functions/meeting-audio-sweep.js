// Hourly backstop for AI meeting notes: audio is never kept. Processing deletes
// it as soon as the transcript is saved; this removes whatever a failed,
// abandoned or discarded recording left behind after 24 hours, and marks
// recordings nobody finished (browser closed mid-recording) as failed.
const { getSupabaseAdmin } = require('./_shared');
const { purgeAudio, purgeProviderJobs } = require('./_meetingPipeline');

exports.handler = async () => {
  const admin = getSupabaseAdmin();
  const {purgeImages}=require('./_meetingAttachments');
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await admin.from('meetings')
    .select('id,team_member_id,status')
    .or('audio_purged_at.is.null,status.eq.discarded')
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
      let providerClean=true;
      try{await purgeProviderJobs(admin,m)}catch(e){providerClean=false;console.error('[meeting-audio-sweep] provider cleanup will retry',e.message)}
      purged += await purgeAudio(admin, m);
      if(providerClean)await admin.from('meeting_processing_jobs').delete().eq('meeting_id',m.id);
      if(['discarded','recording','failed'].includes(m.status))await purgeImages(admin,m);
      if (m.status === 'recording' || m.status === 'processing') {
        await admin.from('meetings').update({ status: 'failed', error: 'Recording was never finished; the audio has expired.', updated_at: new Date().toISOString() })
          .eq('id', m.id).in('status', ['recording', 'processing']);
      }
    } catch (e) {
      console.error('[meeting-audio-sweep]', m.id, e.message);
    }
  }
  // Provider outages never extend retention of our cloud audio. Failed provider
  // deletions remain in the private checkpoint table for the next sweep.
  const {data:expiredJobs}=await admin.from('meeting_processing_jobs').select('meeting_id').lt('created_at',cutoff).limit(100);
  for(const job of expiredJobs||[])try{await purgeProviderJobs(admin,{id:job.meeting_id});await admin.from('meeting_processing_jobs').delete().eq('meeting_id',job.meeting_id)}catch(e){console.error('[meeting-audio-sweep] expired provider job',e.message)}
  return { statusCode: 200, body: JSON.stringify({ ok: true, meetings: (data || []).length, files: purged }) };
};
