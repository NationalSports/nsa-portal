// AI meeting notes: every write the rep makes goes through here (the browser
// can only read its meetings and upload its own audio chunks).
//   POST { action, ... } with a portal bearer token
//     create   { mode: 'dictated'|'recorded', customer_id?, consent? } → { meeting }
//     paste    { text, customer_id? }                               → { meeting }
//     finalize { id, duration_sec? }   recording done, start processing
//     retry    { id }                  failed → processing again
//     set_customer { id, customer_id } change the account on a draft
//     approve  { id, customer_id, final, speaker_map? } → { todo_ids, contacts_added }
//     discard  { id }                  drop a draft and its audio
// Processing (transcribe + extract) runs in meeting-process-background.
const { corsHeaders, verifyUser, getTrustedSiteBaseUrl } = require('./_shared');
const { purgeAudio, normalizeFinal, writeApproval, folderOf, purgeProviderJobs } = require('./_meetingPipeline');

const {annotations,imageAction,purgeImages,BUCKET:IMAGE_BUCKET}=require('./_meetingAttachments');
const MAX_PASTE = 60000;
const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEETING_COLS = 'id,team_member_id,customer_id,mode,status,title,duration_sec,consent_confirmed_at,draft,final,speaker_map,error,created_at,updated_at,processed_at,approved_at,annotations,attachments';

async function startProcessing(event, meetingId) {
  const base = getTrustedSiteBaseUrl(event) || process.env.URL;
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) throw new Error('Background processing is not configured');
  const resp = await fetch(`${base.replace(/\/+$/, '')}/.netlify/functions/meeting-process-background`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ meeting_id: meetingId }),
  });
  if (resp.status !== 202 && !resp.ok) throw new Error(`Could not start processing (${resp.status})`);
}

async function customerOk(admin, customerId) {
  if (!customerId) return true;
  const { data } = await admin.from('customers').select('id').eq('id', String(customerId)).maybeSingle();
  return !!data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const { admin, teamMemberId } = auth;
  if (!teamMemberId) return json(403, { error: 'No team member linked to this login' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Invalid JSON' }); }
  const action = String(body.action || '');
  const now = new Date().toISOString();

  // Load one of the caller's own meetings.
  const own = async () => {
    if (!UUID_RE.test(String(body.id || ''))) return null;
    const { data } = await admin.from('meetings').select(MEETING_COLS).eq('id', body.id).eq('team_member_id', teamMemberId).maybeSingle();
    return data || null;
  };

  try {
    if (action === 'create') {
      const mode = body.mode === 'recorded' ? 'recorded' : body.mode === 'dictated' ? 'dictated' : null;
      if (!mode) return json(400, { error: 'mode must be dictated or recorded' });
      if (mode === 'recorded' && body.consent !== true) return json(400, { error: 'Confirm that everyone knows you are taking notes' });
      if (!(await customerOk(admin, body.customer_id))) return json(400, { error: 'Unknown account' });
      const { data, error } = await admin.from('meetings').insert({
        team_member_id: teamMemberId, customer_id: body.customer_id || null, mode, status: 'recording',
        consent_confirmed_at: mode === 'recorded' ? now : null,
      }).select(MEETING_COLS).single();
      if (error) throw new Error(error.message);
      return json(200, { meeting: data, folder: folderOf(data) });
    }

    if (action === 'paste') {
      const text = String(body.text || '').trim();
      if (text.length < 20) return json(400, { error: 'Paste a bit more text to take notes from' });
      if (text.length > MAX_PASTE) return json(400, { error: 'That is too long. Paste under 60,000 characters.' });
      if (!(await customerOk(admin, body.customer_id))) return json(400, { error: 'Unknown account' });
      const { data: m, error } = await admin.from('meetings').insert({
        team_member_id: teamMemberId, customer_id: body.customer_id || null, mode: 'pasted', status: 'processing', annotations: annotations(body.annotations),
      }).select(MEETING_COLS).single();
      if (error) throw new Error(error.message);
      const { error: tErr } = await admin.from('meeting_transcripts').insert({ meeting_id: m.id, source_text: text });
      if (tErr) throw new Error(tErr.message);
      await startProcessing(event, m.id);
      return json(200, { meeting: m });
    }

    if(action==='images') {
      if(!UUID_RE.test(String(body.id||'')))return json(404,{error:'Note not found'});
      const {data:n,error}=await admin.from('meetings').select(MEETING_COLS).eq('id',body.id).maybeSingle();
      if(error)throw new Error(error.message);
      const privileged=['admin','super_admin','gm'].includes(auth.role);
      if(!n||!(n.team_member_id===teamMemberId||privileged||n.status==='approved'))return json(404,{error:'Note not found'});
      const images=[];
      for(const f of (n.attachments||[]).filter(f=>!f.pending)) {
        const r=await admin.storage.from(IMAGE_BUCKET).createSignedUrl(f.path,300);
        if(r.error)throw new Error(r.error.message);
        images.push({name:f.name,url:r.data.signedUrl});
      }
      return json(200,{images,annotations:n.annotations||[]});
    }
    const m = await own();
    if (!m) return json(404, { error: 'Note not found' });

    if(action==='annotate') {
      if(m.status!=='recording')return json(409,{error:'This recording has finished.'});
      const {error}=await admin.from('meetings').update({annotations:annotations(body.annotations),updated_at:now}).eq('id',m.id).eq('status','recording');
      if(error)throw new Error(error.message);return json(200,{ok:true});
    }
    if(action==='image_upload'||action==='image_commit'||action==='image_remove') {
      if(m.status!=='recording')return json(409,{error:'Add photos before finishing the recording.'});
      return json(200,await imageAction(admin,m,action,body));
    }
    if (action === 'finalize') {
      if (m.status !== 'recording') return json(409, { error: 'This note is already ' + m.status });
      if ((m.attachments||[]).some(f=>f.pending)) return json(409,{error:'Finish uploading photos before processing.'});
      const dur = Math.max(0, Math.min(6 * 3600, Math.round(Number(body.duration_sec) || 0))) || null;
      const { data, error } = await admin.from('meetings').update({ status: 'processing', duration_sec: dur, capture_incomplete: body.capture_complete !== true, annotations: body.annotations ? annotations(body.annotations) : m.annotations||[], updated_at: now })
        .eq('id', m.id).eq('status', 'recording').select(MEETING_COLS).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json(409, { error: 'This note was already finished' });
      await startProcessing(event, m.id);
      return json(200, { meeting: data });
    }

    if (action === 'retry') {
      if (m.status !== 'failed') return json(409, { error: 'Only failed notes can be retried' });
      const { data, error } = await admin.from('meetings').update({ status: 'processing', error: null, updated_at: now })
        .eq('id', m.id).eq('status', 'failed').select(MEETING_COLS).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json(409, { error: 'This note changed. Refresh and try again.' });
      await startProcessing(event, m.id);
      return json(200, { meeting: data });
    }

    if (action === 'set_customer') {
      if (m.status === 'approved' || m.status === 'discarded') return json(409, { error: 'This note is already ' + m.status });
      if (!(await customerOk(admin, body.customer_id))) return json(400, { error: 'Unknown account' });
      const { data, error } = await admin.from('meetings').update({ customer_id: body.customer_id || null, updated_at: now }).eq('id', m.id).select(MEETING_COLS).single();
      if (error) throw new Error(error.message);
      return json(200, { meeting: data });
    }

    if (action === 'approve') {
      // Re-approving an approved note re-runs the (idempotent) writes from the
      // stored note, so a rep can safely retry after a network error.
      if (m.status === 'approved') {
        const res = await writeApproval(admin, m, m.final || {});
        return json(200, { meeting: m, ...res, already: true });
      }
      if (m.status !== 'ready') return json(409, { error: 'This note is not ready to approve (' + m.status + ')' });
      const customerId = body.customer_id || m.customer_id;
      if (!customerId) return json(400, { error: 'Pick the account this note belongs to' });
      if (!(await customerOk(admin, customerId))) return json(400, { error: 'Unknown account' });
      const speakerMap = {};
      Object.entries(body.speaker_map && typeof body.speaker_map === 'object' ? body.speaker_map : {}).forEach(([k, v]) => {
        if (/^[A-Z]$/.test(k) && v) speakerMap[k] = String(v).slice(0, 80);
      });
      let final;
      try { final = {...normalizeFinal(body.final, { speakerMap }), warnings:m.draft?.warnings||[],coverage:m.draft?.coverage||null}; } catch (e) { return json(400, { error: e.message }); }
      const { data: approved, error } = await admin.from('meetings').update({
        status: 'approved', final, speaker_map: speakerMap, customer_id: customerId, title: final.headline, approved_at: now, updated_at: now,
      }).eq('id', m.id).eq('status', 'ready').select(MEETING_COLS).maybeSingle();
      if (error) throw new Error(error.message);
      if (!approved) return json(409, { error: 'This note changed. Refresh and try again.' });
      const res = await writeApproval(admin, approved, final);
      return json(200, { meeting: approved, ...res });
    }

    if (action === 'discard') {
      if (m.status === 'approved') return json(409, { error: 'Approved notes can only be removed by an admin' });
      const { error } = await admin.from('meetings').update({ status: 'discarded', updated_at: now }).eq('id', m.id).neq('status', 'approved');
      if (error) throw new Error(error.message);
      await admin.from('meeting_transcripts').delete().eq('meeting_id', m.id);
      try{await purgeProviderJobs(admin,m);await admin.from('meeting_processing_jobs').delete().eq('meeting_id',m.id)}catch(e){console.warn('[meeting-notes] provider deletion will retry',e.message)}
      await purgeImages(admin,m);
      await purgeAudio(admin, m).catch((e) => console.warn('[meeting-notes] purge on discard failed:', e.message));
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[meeting-notes]', action, err.message);
    return json(500, { error: err.message });
  }
};
