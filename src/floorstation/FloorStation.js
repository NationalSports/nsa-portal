import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import {
  STATIONS, stationByKey, stationAccepts, stationFilesFor, previewImageFor,
  normProdStatus, nextActionFor,
} from './floorLogic';

// Floor Station — scan-at-machine routing for the Team Shop fast-turn floor.
// A staff-only lazy chunk routed at /floor-station by src/index.js (same
// wiring as /teamshop-queue). Big type, minimal chrome: it runs on a tablet
// zip-tied next to the embroidery machine / heat press.
//
// Flow: pick a station (persisted per device) → scan a job ticket barcode
// (keyboard-wedge scanners type the code + Enter into the autofocused input)
// → netlify/functions/job-scan with event:'resolve' (READ-ONLY — resolution
// logic lives server-side in _jobScanResolver.js; this page never re-implements
// it) shows the job + the station's production file (DST for embroidery, print
// art for DTF/heat) → one big button drives the legal next stage through
// job-scan's existing advance path, with expected=<shown stage> so a
// concurrent move surfaces as NSA_STALE_STATE instead of a silent double-move.
//
// Auth, two modes (exactly the two trust levels job-scan already has):
//   * staff mode — signed-in staff (useStaffSession), Bearer JWT;
//   * station mode — an unattended tablet opened with ?token=<PROD_SCAN_TOKEN>.
//     The token comes ONLY from the page URL typed/bookmarked on that device;
//     it is never present in this bundle, never persisted by this code, and is
//     forwarded as the x-machine-token header job-scan already validates.
//     job-scan supports both its read (resolve) and write (advance) paths with
//     this token, so no function auth changes were needed.

const STATION_LS_KEY = 'nsa_floor_station';

const stationTokenFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('token') || null; }
  catch { return null; }
};

const isStale = (msg) => /NSA_STALE_STATE/.test(String(msg || ''));

// One fetch wrapper for both resolve + advance. authRef carries either
// { token } (station mode) or nothing (staff mode → fresh Bearer per call).
async function callJobScan(body, stationToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (stationToken) {
    headers['x-machine-token'] = stationToken;
  } else {
    const { data } = await supabase.auth.getSession();
    const jwt = data && data.session && data.session.access_token;
    headers.Authorization = `Bearer ${jwt || ''}`;
  }
  const res = await fetch('/.netlify/functions/job-scan', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

const S = {
  page: { fontFamily: 'system-ui,-apple-system,sans-serif', background: '#0f172a', color: '#f1f5f9', minHeight: '100vh', padding: 16 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '16px 18px', fontSize: 26, fontWeight: 700,
    fontFamily: 'ui-monospace,monospace', background: '#1e293b', color: '#f1f5f9',
    border: '2px solid #334155', borderRadius: 12, outline: 'none',
  },
  bigBtn: (bg) => ({
    width: '100%', padding: '20px 16px', fontSize: 28, fontWeight: 800, background: bg,
    color: '#fff', border: 'none', borderRadius: 14, cursor: 'pointer', marginTop: 14,
  }),
};

function StationPicker({ value, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {STATIONS.map((st) => (
        <button
          key={st.key}
          type="button"
          aria-label={'station-' + st.key}
          onClick={() => onPick(st.key)}
          style={{
            padding: '10px 16px', fontSize: 15, fontWeight: 800, borderRadius: 10, cursor: 'pointer',
            border: value === st.key ? '2px solid #38bdf8' : '2px solid #334155',
            background: value === st.key ? '#0c4a6e' : '#1e293b',
            color: value === st.key ? '#e0f2fe' : '#94a3b8',
          }}
        >
          {st.label}
        </button>
      ))}
    </div>
  );
}

function JobPanel({ station, job, resolvedCode, busy, onAdvance }) {
  const stage = normProdStatus(job.prod_status);
  const mismatch = !stationAccepts(station, job.deco_type);
  const files = stationFilesFor(station, job.files);
  const preview = previewImageFor(job.files);
  const action = nextActionFor(job);

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 18, marginTop: 14 }}>
      {mismatch && (
        <div
          role="alert"
          style={{ background: '#7f1d1d', color: '#fecaca', border: '3px solid #ef4444', borderRadius: 10, padding: '14px 16px', fontSize: 22, fontWeight: 800, marginBottom: 14 }}
        >
          WRONG STATION — this is a {job.deco_type || 'unknown'} job, not {stationByKey(station) ? stationByKey(station).label : station} work. You can still proceed.
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {preview && (
          <img src={preview.url} alt={preview.name} style={{ width: 130, height: 130, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.15 }}>{job.art_name || 'Unassigned Art'}</div>
          <div style={{ fontSize: 18, color: '#94a3b8', marginTop: 4 }}>
            {job.so_id} · {job.job_id}
          </div>
          <div style={{ fontSize: 20, marginTop: 8 }}>
            <b>{job.deco_type || '—'}</b>
            {job.positions ? ' · ' + job.positions : ''} · <b>{job.total_units || 0}</b> units
          </div>
          <div style={{ fontSize: 16, marginTop: 6, color: '#38bdf8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>
            Stage: {stage}{job.packed_at ? ' · packed' : ''}
          </div>
        </div>
      </div>

      {station !== 'packing' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {station === 'embroidery' ? 'DST file' : 'Production file'}
          </div>
          {files.length === 0 ? (
            <div style={{ fontSize: 16, color: '#fbbf24', fontWeight: 700 }}>
              No {station === 'embroidery' ? 'DST' : 'print'} file on this job yet.
            </div>
          ) : files.map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', fontSize: 18, fontWeight: 700, color: '#7dd3fc', margin: '4px 0', wordBreak: 'break-all' }}
            >
              {f.name || f.url}
            </a>
          ))}
        </div>
      )}

      {action && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdvance(job, action, resolvedCode)}
          style={S.bigBtn(busy ? '#334155' : '#15803d')}
        >
          {busy ? 'Working…' : action.label}
        </button>
      )}
      {!action && (
        <div style={{ marginTop: 14, fontSize: 18, color: '#4ade80', fontWeight: 800 }}>Done — packed.</div>
      )}
    </div>
  );
}

function FloorStationScreen({ stationToken }) {
  const [station, setStation] = useState(() => {
    try {
      const saved = localStorage.getItem(STATION_LS_KEY);
      return stationByKey(saved) ? saved : 'embroidery';
    } catch { return 'embroidery'; }
  });
  const [code, setCode] = useState('');
  const [job, setJob] = useState(null); // job detail from event:'resolve'
  const [resolvedCode, setResolvedCode] = useState(null); // the scanned code the shown job came from
  const [pickJobs, setPickJobs] = useState(null); // box_needs_job / ambiguous candidates
  const [msg, setMsg] = useState(null); // { kind: 'err'|'info', text }
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pickStation = (key) => {
    setStation(key);
    try { localStorage.setItem(STATION_LS_KEY, key); } catch {}
    if (inputRef.current) inputRef.current.focus();
  };

  // Resolve a scanned code (read-only) and show the job. jobId disambiguates a
  // box scan; the resolution itself stays server-side. Returns true when a job
  // is shown so advance() can layer its own message on top afterwards.
  const resolve = useCallback(async (scanned, jobId) => {
    setBusy(true);
    setMsg(null);
    setPickJobs(null);
    try {
      const r = await callJobScan(
        { code: scanned, event: 'resolve', ...(jobId ? { job_id: jobId } : {}) },
        stationToken
      );
      setBusy(false);
      if (r.ok && r.job) {
        setJob(r.job);
        setResolvedCode(scanned);
        return true;
      }
      setJob(null);
      setResolvedCode(null);
      if (r.reason === 'box_needs_job' && Array.isArray(r.jobs)) {
        setPickJobs({ code: scanned, jobs: r.jobs });
        setMsg({ kind: 'info', text: 'Box has several jobs — tap the one you\'re running.' });
        return false;
      }
      const reason = (r.resolution && r.resolution.reason) || r.reason || r.error || 'scan failed';
      setMsg({
        kind: 'err',
        text: r.status === 401
          ? 'Not authorized — sign in, or open this page with the station token.'
          : 'Scan not recognized: ' + reason,
      });
      return false;
    } catch (e) {
      setBusy(false);
      setJob(null);
      setMsg({ kind: 'err', text: 'Lookup failed: ' + (e.message || String(e)) });
      return false;
    }
  }, [stationToken]);

  const onScanSubmit = (e) => {
    e.preventDefault();
    const scanned = code.trim();
    setCode('');
    if (scanned) resolve(scanned);
  };

  // Advance through job-scan's existing write path. expected= the stage the
  // operator is looking at; NSA_STALE_STATE means someone moved it first — we
  // re-resolve and say so instead of pretending the tap worked.
  const advance = useCallback(async (shownJob, action, scannedCode) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await callJobScan({
        code: scannedCode,
        event: action.event,
        expected: action.expected,
        so_id: shownJob.so_id,
        job_id: shownJob.job_id,
        actor: 'floor:' + station,
      }, stationToken);
      if (isStale(r.error)) {
        const shown = await resolve(scannedCode, shownJob.job_id);
        if (shown) setMsg({ kind: 'err', text: 'Someone else moved this job — re-scanned, showing its current stage.' });
        return;
      }
      if (!r.ok) {
        setBusy(false);
        setMsg({ kind: 'err', text: 'Move failed: ' + (r.error || 'unknown error') });
        return;
      }
      const shown = await resolve(scannedCode, shownJob.job_id); // refresh the shown stage
      if (shown) setMsg({ kind: 'info', text: action.label.replace(/\s*→$/, '') + ' ✓' });
    } catch (e) {
      setBusy(false);
      setMsg({ kind: 'err', text: 'Move failed: ' + (e.message || String(e)) });
    }
  }, [station, stationToken, resolve]);

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#64748b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 2 }}>
          Floor Station{stationToken ? ' · station mode' : ''}
        </h1>
        <StationPicker value={station} onPick={pickStation} />
        <form onSubmit={onScanSubmit}>
          <input
            ref={inputRef}
            autoFocus
            aria-label="scan-input"
            placeholder="Scan job barcode…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={S.input}
            autoComplete="off"
            autoCapitalize="off"
          />
        </form>

        {msg && (
          <div style={{
            marginTop: 12, padding: '12px 14px', borderRadius: 10, fontSize: 18, fontWeight: 700,
            background: msg.kind === 'err' ? '#7f1d1d' : '#064e3b',
            color: msg.kind === 'err' ? '#fecaca' : '#a7f3d0',
          }}>
            {msg.text}
          </div>
        )}

        {pickJobs && pickJobs.jobs.map((j) => (
          <button
            key={j.job_id}
            type="button"
            onClick={() => resolve(pickJobs.code, j.job_id)}
            style={{ ...S.bigBtn('#1d4ed8'), fontSize: 20, padding: '14px 16px' }}
          >
            {j.art_name || j.job_id} · {j.so_id}
          </button>
        ))}

        {job && (
          <JobPanel
            station={station}
            job={job}
            resolvedCode={resolvedCode}
            busy={busy}
            onAdvance={advance}
          />
        )}
        {!job && !pickJobs && !msg && (
          <div style={{ marginTop: 40, textAlign: 'center', color: '#334155', fontSize: 22, fontWeight: 700 }}>
            Scan a job ticket to begin
          </div>
        )}
      </div>
    </div>
  );
}

export default function FloorStation() {
  // Station mode: ?token= present → skip the staff gate entirely (job-scan
  // validates the token server-side on every call; a bad token just 401s).
  const [stationToken] = useState(stationTokenFromUrl);
  const { loading, signedIn } = useStaffSession();

  if (stationToken) return <FloorStationScreen stationToken={stationToken} />;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>
        Loading…
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#334155', fontSize: 15, marginBottom: 12 }}>Sign in to Connect first.</p>
          <a href="/" style={{ color: '#1d4ed8', fontWeight: 700 }}>Go to sign in</a>
        </div>
      </div>
    );
  }
  return <FloorStationScreen stationToken={null} />;
}
