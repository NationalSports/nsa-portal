// Microphone recorder for AI meeting notes. This module's only contract is
// start / pause / resume / stop and "here is a chunk" — if reps ever need to
// record with the phone locked, a native (Capacitor) recorder replaces this one
// file and nothing downstream changes (docs/AI_MEETING_NOTES_V1_SPEC.md).
//
// Each MediaRecorder run is a "segment": its chunks concatenate into one valid
// file. A phone lock / app switch / call ends the run; resume() starts a new
// segment so already-uploaded audio is kept and the note continues.
// The screen is kept on with the Wake Lock API while recording.

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickMime() {
  if (typeof window === 'undefined' || !window.MediaRecorder) return '';
  const ok = MIME_CANDIDATES.find((m) => { try { return window.MediaRecorder.isTypeSupported(m); } catch { return false; } });
  return ok || '';
}

// iOS Safari records audio/mp4 (AAC); Chrome/Android audio/webm (Opus).
export function extForMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/aac' || base === 'audio/x-m4a') return 'mp4';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  return 'webm';
}

export function recorderSupported() {
  return typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;
}

export function createMeetingRecorder({ onChunk, onState, chunkMs = 30000 } = {}) {
  let state = 'idle'; // idle | recording | paused | interrupted | stopped
  let run = null; // { rec, stream, expectingStop, stopWaiter } for the current MediaRecorder
  let segment = -1;
  let wakeLock = null;
  let activeMs = 0;
  let runStartedAt = 0;

  const set = (s, info) => { state = s; onState && onState(s, info || {}); };
  const elapsedMs = () => activeMs + (state === 'recording' && runStartedAt ? Date.now() - runStartedAt : 0);
  const bank = () => { if (runStartedAt) { activeMs += Date.now() - runStartedAt; runStartedAt = 0; } };

  const lockScreen = async () => {
    try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } } catch { wakeLock = null; }
  };
  const unlockScreen = () => { try { wakeLock?.release(); } catch {} wakeLock = null; };
  // Stop the current run; its last chunk still arrives through ondataavailable.
  const endRun = (r) => {
    if (!r) return;
    r.expectingStop = true;
    try { if (r.rec.state !== 'inactive') r.rec.stop(); } catch {}
    try { r.stream.getTracks().forEach((t) => t.stop()); } catch {}
  };

  const interrupted = (r, why) => {
    if (r !== run) return; // a late event from an earlier run
    if (state !== 'recording' && state !== 'paused') return;
    bank();
    endRun(r);
    unlockScreen();
    set('interrupted', { reason: why, elapsedMs: elapsedMs() });
  };

  // Coming back to the app: re-take the wake lock, and notice if the OS killed
  // the recorder while we were away.
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !run) return;
    if (state === 'recording' || state === 'paused') {
      const dead = run.rec.state === 'inactive' || run.stream.getAudioTracks().some((t) => t.readyState === 'ended');
      if (dead) interrupted(run, 'The recording stopped while the phone was locked or in another app.');
      else lockScreen();
    }
  };

  const beginRun = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime();
    const rec = mime ? new window.MediaRecorder(stream, { mimeType: mime }) : new window.MediaRecorder(stream);
    const actualMime = rec.mimeType || mime || 'audio/webm';
    const ext = extForMime(actualMime);
    segment += 1;
    const seg = segment;
    let chunkIndex = 0;
    const r = { rec, stream, expectingStop: false, stopWaiter: null };
    run = r;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) onChunk && onChunk(e.data, { segment: seg, index: chunkIndex++, ext, mime: actualMime.split(';')[0] });
    };
    rec.onstop = () => {
      if (r.stopWaiter) { const w = r.stopWaiter; r.stopWaiter = null; w(); return; }
      if (!r.expectingStop) interrupted(r, 'The recording was interrupted.');
    };
    rec.onerror = () => interrupted(r, 'The microphone stopped.');
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => interrupted(r, 'The microphone was taken by another app or a call.')));
    rec.start(chunkMs);
    runStartedAt = Date.now();
    await lockScreen();
    set('recording', { segment: seg });
  };

  return {
    get state() { return state; },
    elapsedMs,
    async start() {
      if (state !== 'idle') return;
      if (!recorderSupported()) throw new Error('This browser cannot record audio.');
      document.addEventListener('visibilitychange', onVisible);
      await beginRun();
    },
    pause() {
      if (state !== 'recording' || !run || typeof run.rec.pause !== 'function') return;
      run.rec.pause();
      bank();
      set('paused');
    },
    async resume() {
      if (state === 'paused' && run && run.rec.state === 'paused') {
        run.rec.resume();
        runStartedAt = Date.now();
        await lockScreen();
        set('recording', { segment });
        return;
      }
      if (state === 'interrupted' || state === 'paused') await beginRun();
    },
    // Resolves after the last chunk has been handed to onChunk.
    async stop() {
      if (state === 'stopped' || state === 'idle') return;
      bank();
      document.removeEventListener('visibilitychange', onVisible);
      const r = run;
      if (r && r.rec.state !== 'inactive') {
        await new Promise((resolve) => {
          r.stopWaiter = resolve;
          r.expectingStop = true;
          try { r.rec.stop(); } catch { r.stopWaiter = null; resolve(); }
        });
      }
      endRun(r);
      unlockScreen();
      set('stopped', { elapsedMs: activeMs });
    },
    // Throw away without waiting for the last chunk (discard).
    cancel() {
      document.removeEventListener('visibilitychange', onVisible);
      endRun(run);
      run = null;
      unlockScreen();
      set('stopped', { cancelled: true });
    },
  };
}

// Uploads chunks in order with retries. A dropped connection just waits and
// retries; nothing is lost while the page stays open.
export function createChunkUploader({ supabase, bucket = 'meeting-audio', folder, onProgress, retryBaseMs = 1000 }) {
  const queue = [];
  let uploaded = 0;
  let running = false;
  let failures = 0;
  let idleWaiters = [];

  const report = () => onProgress && onProgress({ uploaded, pending: queue.length, retrying: failures > 0 });
  const pad = (n) => String(n).padStart(4, '0');

  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue[0];
      const path = `${folder}/s${job.segment}-c${pad(job.index)}.${job.ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, job.blob, { contentType: job.mime, upsert: false });
      // "already exists" means an earlier attempt landed but its response was lost.
      if (!error || /exist|duplicate|409/i.test(String(error.message || error.statusCode || ''))) {
        queue.shift();
        uploaded += 1;
        failures = 0;
        report();
      } else {
        failures += 1;
        report();
        await new Promise((r) => setTimeout(r, Math.min(30000, retryBaseMs * 2 ** Math.min(failures, 5))));
      }
    }
    running = false;
    const w = idleWaiters; idleWaiters = [];
    w.forEach((f) => f());
  };

  return {
    add(blob, meta) { queue.push({ blob, ...meta }); report(); pump(); },
    get pending() { return queue.length; },
    get uploaded() { return uploaded; },
    // Resolves when every queued chunk has uploaded.
    flush() { return queue.length || running ? new Promise((r) => { idleWaiters.push(r); pump(); }) : Promise.resolve(); },
  };
}
