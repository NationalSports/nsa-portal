// AI meeting notes pipeline, shared by meeting-notes (the rep's actions),
// meeting-process-background (transcribe + extract) and meeting-audio-sweep.
//
// Audio path: the browser uploads chunks to the private meeting-audio bucket
// under {team_member_id}/{meeting_id}/s{segment}-c{chunk}.{ext}. Processing
// concatenates each recorder session ("segment") into one file, sends it to
// AssemblyAI, saves the transcript, then deletes the audio (ours and theirs).
const { extractDraft, transcriptForModel, normalizeDraft, isRealDate } = require('./_meetingAi');
const { safePush } = require('./_push');

const BUCKET = 'meeting-audio';
const AAI = 'https://api.assemblyai.com/v2';
const POLL_MS = 4000;
const TRANSCRIBE_BUDGET_MS = 10 * 60 * 1000; // background functions get 15 minutes

const folderOf = (m) => `${m.team_member_id}/${m.id}`;
const CHUNK_RE = /^s(\d+)-c(\d+)\.([a-z0-9]+)$/i;

// Today's date where the team works; relative dates ("next Friday") resolve against it.
const meetingDateOf = (m) => new Date(m.created_at || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

async function listAudio(admin, m) {
  const { data, error } = await admin.storage.from(BUCKET).list(folderOf(m), { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error('Could not list audio: ' + error.message);
  return (data || []).filter((o) => CHUNK_RE.test(o.name));
}

async function purgeAudio(admin, m) {
  const files = await listAudio(admin, m);
  if (files.length) {
    const { error } = await admin.storage.from(BUCKET).remove(files.map((f) => `${folderOf(m)}/${f.name}`));
    if (error) throw new Error('Could not delete audio: ' + error.message);
  }
  const { error: stampError } = await admin.from('meetings').update({ audio_purged_at: new Date().toISOString() }).eq('id', m.id);
  if (stampError) throw new Error(stampError.message);
  return files.length;
}

// Group chunk files into recorder sessions, in order. A missing chunk inside a
// session is reported but not fatal (the rest of the session still decodes).
function groupSegments(files) {
  const segs = new Map();
  for (const f of files) {
    const [, s, c, ext] = f.name.match(CHUNK_RE);
    const seg = Number(s);
    if (!segs.has(seg)) segs.set(seg, { index: seg, ext: ext.toLowerCase(), chunks: [] });
    segs.get(seg).chunks.push({ n: Number(c), name: f.name });
  }
  return [...segs.values()]
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      s.chunks.sort((a, b) => a.n - b.n);
      s.gaps = s.chunks.length ? (s.chunks[s.chunks.length - 1].n + 1 - s.chunks.length) : 0;
      return s;
    });
}

async function aai(path, { key, method = 'GET', body, raw } = {}) {
  const resp = await fetch(AAI + path, {
    method,
    headers: { authorization: key, ...(raw ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const data = await resp.json().catch(() => ({}));
  if (method === 'DELETE' && resp.status === 404) return {};
  if (!resp.ok) throw new Error(`AssemblyAI ${resp.status}: ${data.error || 'request failed'}`);
  return data;
}

async function logJob(admin, row) {
  const { error } = await admin.from('ai_jobs').insert(row);
  if (error) console.warn('[meetings] ai_jobs insert failed:', error.message);
}

// Transcribe every segment, merge into one utterance list, save it, delete audio.
async function transcribeMeeting(admin, m, { key = process.env.ASSEMBLYAI_API_KEY, deadline = Date.now() + TRANSCRIBE_BUDGET_MS, pollMs = POLL_MS } = {}) {
  if (!key) throw new Error('Transcription is not set up yet (ASSEMBLYAI_API_KEY missing)');
  const segments = groupSegments(await listAudio(admin, m));
  if (!segments.length) throw new Error('No audio was uploaded for this note');
  const diarize = m.mode === 'recorded';
  const utterances = [];
  let totalAudioBytes=0;
  const { data: checkpointRow, error: checkpointError } = await admin.from('meeting_processing_jobs').select('segments').eq('meeting_id',m.id).maybeSingle();
  if (checkpointError) throw new Error(checkpointError.message);
  const checkpoints = { ...(checkpointRow?.segments || {}) };
  const saveJobs = async () => {
    const {data:live,error:liveError}=await admin.from('meetings').select('status').eq('id',m.id).maybeSingle();
    if(liveError||live?.status!=='processing')throw new Error('This note is no longer processing.');
    const { error } = await admin.from('meeting_processing_jobs').upsert({ meeting_id: m.id, segments: checkpoints }, { onConflict: 'meeting_id' });
    if (error) throw new Error('Could not checkpoint transcription: ' + error.message);
  };
  let offsetMs = 0;
  let audioSeconds = 0;
  for (const seg of segments) {
    const started = Date.now();
    if (seg.gaps) throw new Error('Audio is incomplete: a chunk is missing. Recover the upload before processing this note.');
    let checkpoint = checkpoints[seg.index];
    let t = checkpoint?.completed;
    if (!t) {
      if (!checkpoint?.job_id) {
        const parts = [];
        let bytes = 0;
        for (const c of seg.chunks) {
          const { data, error } = await admin.storage.from(BUCKET).download(`${folderOf(m)}/${c.name}`);
          if (error) throw new Error('Could not read audio: ' + error.message);
          const part = Buffer.from(await data.arrayBuffer()); bytes += part.length; totalAudioBytes+=part.length;
          if (totalAudioBytes > 150 * 1024 * 1024) throw new Error('Recording exceeds the 150 MB processing limit.');
          parts.push(part);
        }
        const { upload_url } = await aai('/upload', { key, method: 'POST', raw: Buffer.concat(parts) });
        const job = await aai('/transcript', { key, method: 'POST', body: { audio_url: upload_url, speaker_labels: diarize, language_code: 'en_us', punctuate: true, format_text: true } });
        checkpoint = checkpoints[seg.index] = { job_id: job.id };
        await saveJobs();
      }
      t = await aai('/transcript/' + checkpoint.job_id, { key });
      while (t.status !== 'completed' && t.status !== 'error') {
        if (Date.now() > deadline) { const e = new Error('Transcription is still running; it will resume automatically.'); e.pending = true; throw e; }
        await new Promise((r) => setTimeout(r, pollMs));
        t = await aai('/transcript/' + checkpoint.job_id, { key });
      }
      if (t.status === 'error') {
        await aai('/transcript/' + checkpoint.job_id, { key, method: 'DELETE' }).catch(()=>{});
        delete checkpoints[seg.index]; await saveJobs();
        throw new Error('Transcription failed: ' + String(t.error || 'unknown error').slice(0,200));
      }
      checkpoint.completed = { text: t.text, utterances: t.utterances, audio_duration: t.audio_duration, speech_model: t.speech_model };
      await saveJobs(); // commit transcript before deleting the provider copy
    }
    if (!checkpoint.deleted) {
      await aai('/transcript/' + checkpoint.job_id, { key, method: 'DELETE' });
      checkpoint.deleted = true; await saveJobs();
    }
    const secs = Number(t.audio_duration) || 0;
    await logJob(admin, { meeting_id: m.id, provider: 'assemblyai', model: t.speech_model || null, audio_seconds: secs, duration_ms: Date.now() - started, ok: t.status !== 'error', error: t.status === 'error' ? String(t.error || '').slice(0, 300) : null });
    if (t.status === 'error') throw new Error('Transcription failed: ' + String(t.error || 'unknown error').slice(0, 200));
    const us = Array.isArray(t.utterances) && t.utterances.length
      ? t.utterances
      : (t.text ? [{ speaker: null, text: t.text, start: 0, end: secs * 1000 }] : []);
    for (const u of us) {
      utterances.push({ speaker: diarize ? (u.speaker || null) : null, text: String(u.text || '').trim(), start: offsetMs + (Number(u.start) || 0), end: offsetMs + (Number(u.end) || 0), segment: seg.index });
    }
    offsetMs += secs * 1000;
    audioSeconds += secs;
  }
  const clean = utterances.filter((u) => u.text);
  const { error } = await admin.from('meeting_transcripts').upsert({ meeting_id: m.id, utterances: clean, source_text: null }, { onConflict: 'meeting_id' });
  if (error) throw new Error('Could not save transcript: ' + error.message);
  await admin.from('meetings').update({ duration_sec: Math.round(audioSeconds) || m.duration_sec || null, updated_at: new Date().toISOString() }).eq('id', m.id);
  await purgeAudio(admin, m);

  return { utterances: clean, gaps: segments.reduce((a, s) => a + s.gaps, 0) };
}

async function purgeProviderJobs(admin,m) {
  const {data:row,error}=await admin.from('meeting_processing_jobs').select('segments').eq('meeting_id',m.id).maybeSingle();
  if(error)throw new Error(error.message);
  for(const job of Object.values(row?.segments||{})) if(job.job_id&&!job.deleted){
    if(!process.env.ASSEMBLYAI_API_KEY)throw new Error('Provider cleanup needs the transcription key.');
    await aai('/transcript/'+job.job_id,{key:process.env.ASSEMBLYAI_API_KEY,method:'DELETE'});
  }
}

async function contextFor(admin, m) {
  const [{ data: rep }, cust, contacts] = await Promise.all([
    admin.from('team_members').select('name').eq('id', m.team_member_id).maybeSingle(),
    m.customer_id ? admin.from('customers').select('id,name').eq('id', m.customer_id).maybeSingle().then((r) => r.data) : null,
    m.customer_id ? admin.from('customer_contacts').select('name,role').eq('customer_id', m.customer_id).then((r) => r.data || []) : [],
  ]);
  const { accountContext } = await require('./_meetingContext').accountContextFor(admin, m.customer_id);
  return { repName: rep?.name || null, customerName: cust?.name || null, contacts, accountContext, annotations: m.annotations || [], images: await require('./_meetingAttachments').imagesForModel(admin,m) };
}

// Full processing for a meeting in status 'processing': transcribe if needed,
// then extract a draft. Leaves the meeting 'ready' or 'failed'.
async function processMeeting(admin, meetingId, { apiKey = process.env.ANTHROPIC_API_KEY, pollMs } = {}) {
  const { data: m, error } = await admin.from('meetings').select('*').eq('id', meetingId).maybeSingle();
  if (error || !m) throw new Error('Meeting not found');
  if (m.status !== 'processing') return { skipped: m.status };
  const lease = require('crypto').randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc('claim_meeting_processing', { p_id: m.id, p_token: lease });
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { skipped: 'already processing' };
  try {
    let { data: tr } = await admin.from('meeting_transcripts').select('*').eq('meeting_id', m.id).maybeSingle();
    let gaps = 0;
    if (!tr && m.mode !== 'pasted') {
      const res = await transcribeMeeting(admin, m, pollMs != null ? { pollMs } : {});
      tr = { utterances: res.utterances, source_text: null };
      gaps = res.gaps;
    }
    if (!tr) throw new Error('Nothing to take notes from');
    if (!m.audio_purged_at && m.mode !== 'pasted') await purgeAudio(admin, m);
    const transcript = transcriptForModel({ mode: m.mode, utterances: tr.utterances, sourceText: tr.source_text });
    const ctx = await contextFor(admin, m);
    const started = Date.now();
    let result;
    try {
      const extractionKey = require('crypto').createHash('sha256').update(JSON.stringify({ transcript, customer:m.customer_id, annotations:m.annotations, attachments:m.attachments })).digest('hex');
      const {data:job,error:jobError}=await admin.from('meeting_processing_jobs').select('*').eq('meeting_id',m.id).maybeSingle();
      if(jobError) throw new Error(jobError.message);
      const parts=job?.extraction_key===extractionKey ? job.extraction_parts||{} : {};
      result = await extractDraft({ apiKey, mode: m.mode, transcript, meetingDate: meetingDateOf(m), ...ctx,
        cachedParts:parts, deadline:Date.now()+3*60*1000,
        onPart:async(i,r)=>{parts[i]=r;const {error}=await admin.from('meeting_processing_jobs').upsert({meeting_id:m.id,extraction_key:extractionKey,extraction_parts:parts},{onConflict:'meeting_id'});if(error)throw new Error(error.message);},
      });
    } catch (e) {
      await logJob(admin, { meeting_id: m.id, provider: 'anthropic', model: null, input_tokens: e.usage?.input_tokens || null, output_tokens: e.usage?.output_tokens || null, duration_ms: Date.now() - started, ok: false, error: String(e.message).slice(0, 300) });
      throw e;
    }
    await logJob(admin, { meeting_id: m.id, provider: 'anthropic', model: result.model, input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens, duration_ms: Date.now() - started, ok: true });
    const now = new Date().toISOString();
    const draft = { ...result.draft, ...(gaps ? { audio_gaps: gaps } : {}), warnings: [...(result.draft.warnings||[]), ...(m.capture_incomplete?['This recording was recovered after an interruption. The ending or unuploaded audio may be missing.']:[])] };
    const { data: saved, error: saveError } = await admin.from('meetings').update({ status: 'ready', draft, title: draft.headline, error: null, processed_at: now, updated_at: now }).eq('id', m.id).eq('status', 'processing').eq('processing_token', lease).select('id').maybeSingle();
    if (saveError) throw new Error(saveError.message);
    if (!saved) return { skipped: 'note changed' };
    await admin.from('meeting_processing_jobs').delete().eq('meeting_id',m.id);
    await safePush(admin, [m.team_member_id], { title: '🎙️ Your notes are ready', body: draft.headline + ' · tap to review and save', url: '/?pg=meeting_notes&mtab=more&msub=notes', tag: 'note-' + m.id }, { onceKey: 'note-ready:' + m.id });
    return { ok: true };
  } catch (e) {
    if (e.pending) return { pending: true };
    const msg = String(e.message || e).slice(0, 500);
    console.error('[meetings] processing failed', m.id, msg);
    await admin.from('meetings').update({ status: 'failed', error: msg, updated_at: new Date().toISOString() }).eq('id', m.id).eq('status', 'processing').eq('processing_token',lease);
    return { ok: false, error: msg };
  } finally {
    const {data:live}=await admin.from('meetings').select('status').eq('id',m.id).maybeSingle();
    if(live?.status==='discarded'){try{await purgeProviderJobs(admin,m);await admin.from('meeting_processing_jobs').delete().eq('meeting_id',m.id)}catch(e){console.warn('[meetings] provider cleanup will retry',e.message)}await purgeAudio(admin,m);await admin.from('meeting_transcripts').delete().eq('meeting_id',m.id);}
    await admin.from('meetings').update({ processing_token: null, processing_lease_until: null }).eq('id',m.id).eq('processing_token',lease);
  }
}

// Clamp the rep's edited note into the stored shape. Items the rep unchecked
// are dropped; speaker letters used as owners become the names the rep chose.
function normalizeFinal(input, { speakerMap = {} } = {}) {
  const f = input && typeof input === 'object' ? input : {};
  const nameFor = (owner) => {
    const s = String(owner || '').trim();
    const letter = (s.match(/^(?:speaker\s+)?([A-Z])$/i) || [])[1];
    const mapped = letter && speakerMap[letter.toUpperCase()];
    return mapped ? (String(mapped).toLowerCase() === 'me' ? 'rep' : String(mapped)) : s;
  };
  const base = normalizeDraft({
    ...f,
    action_items: (Array.isArray(f.action_items) ? f.action_items : []).filter((a) => a && a.include !== false).map((a) => ({ ...a, owner: nameFor(a.owner) })),
    people_mentioned: (Array.isArray(f.people_mentioned) ? f.people_mentioned : []).filter((p) => p && p.add !== false),
  });
  return { ...base, next_action_date: isRealDate(f.next_action_date) ? f.next_action_date : null, accepted_stage: base.suggested_stage && f.accept_stage ? base.suggested_stage : null };
}

const todoIdFor = (meetingId, n) => `todo-meeting-${meetingId}-${n}`;

// Write the approved note's to-dos and new contacts. Safe to run more than once
// for the same meeting: to-do ids are deterministic and contacts are matched by
// name. Returns what was created.
async function writeApproval(admin, m, final) {
  const repId = m.team_member_id;
  const now = new Date().toISOString();
  const todos = (final.action_items || []).map((a, n) => ({
    id: todoIdFor(m.id, n),
    title: a.text.slice(0, 180),
    description: [a.owner && a.owner !== 'rep' ? `Owner: ${a.owner}` : '', `From AI note: ${final.headline}`].filter(Boolean).join('\n'),
    created_by: repId,
    assigned_to: repId,
    customer_id: m.customer_id,
    priority: 2,
    status: 'open',
    due_date: a.due_date || null,
    source: `meeting:${m.id}:${n}`,
    created_at: now,
    updated_at: now,
  }));
  if (final.next_action_date && !todos.some((t) => t.due_date === final.next_action_date)) {
    todos.push({ id: todoIdFor(m.id, 'next'), title: `Next touch: ${final.headline}`.slice(0, 180), description: 'Next action date from AI note', created_by: repId, assigned_to: repId, customer_id: m.customer_id, priority: 2, status: 'open', due_date: final.next_action_date, source: `meeting:${m.id}:next`, created_at: now, updated_at: now });
  }
  if (todos.length) {
    const { error } = await admin.from('assigned_todos').upsert(todos, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error('Could not create reminders: ' + error.message);
  }

  const added = [];
  const people = final.people_mentioned || [];
  if (m.customer_id && people.length) {
    const { data: existing, error } = await admin.from('customer_contacts').select('name,sort_order').eq('customer_id', m.customer_id);
    if (error) throw new Error('Could not read contacts: ' + error.message);
    const have = new Set((existing || []).map((c) => String(c.name || '').trim().toLowerCase()));
    // Append after the last contact: the portal saves contacts by list position.
    let next = (existing || []).reduce((mx, c) => Math.max(mx, Number(c.sort_order) || 0), -1) + 1;
    const sport = (final.sports || [])[0] || null;
    const rows = [];
    for (const p of people) {
      const key = p.name.toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      rows.push({ customer_id: m.customer_id, name: p.name, role: p.role || null, sport, source: 'ai_note', sort_order: next++ });
    }
    if (rows.length) {
      const { error: insErr } = await admin.from('customer_contacts').insert(rows);
      if (insErr) throw new Error('Could not add contacts: ' + insErr.message);
      rows.forEach((r) => added.push({ name: r.name, role: r.role, email: null, phone: null }));
    }
  }
  return { todo_ids: todos.map((t) => t.id), contacts_added: added };
}

module.exports = { BUCKET, folderOf, meetingDateOf, groupSegments, listAudio, purgeAudio, transcribeMeeting, processMeeting, normalizeFinal, writeApproval, todoIdFor, purgeProviderJobs };
