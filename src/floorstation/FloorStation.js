import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import {
  STATIONS, stationByKey, stationAccepts, stationFilesFor, previewImageFor,
  normProdStatus, nextActionFor, sortedSizeEntries, notReadyMessage,
  jobReadiness, stageDisplay,
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

// Connect design tokens (portal.css sidebar navy family) — Floor Station kiosk skin.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const S = {
  page: { fontFamily: FONT, background: '#0f172a', color: '#f1f5f9', minHeight: '100vh', padding: 16 },
  // Big touch scan field — Connect accent-blue focus (via the .fs-input CSS below).
  input: {
    width: '100%', boxSizing: 'border-box', padding: '0 22px', height: 72, fontSize: 32, fontWeight: 600,
    letterSpacing: 2, fontVariantNumeric: 'tabular-nums', background: '#1e293b', color: '#f1f5f9',
    border: '2px solid #334155', borderRadius: 6, outline: 'none',
  },
  label: { display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  bigBtn: (bg) => ({
    width: '100%', minHeight: 96, padding: '20px 16px', fontSize: 28, fontWeight: 800, background: bg,
    color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 'auto',
    textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
    boxShadow: bg === '#334155' ? 'none' : '0 8px 24px rgba(37,99,235,0.4)',
  }),
};

// Small scoped CSS for states inline styles can't express: accent-blue focus glow
// on the scan field and the hover darken on the stage button.
const FS_CSS = `
.fs-input:focus { border-color:#3b82f6; box-shadow:0 0 0 4px rgba(59,130,246,0.15); }
.fs-btn:hover:not(:disabled) { background:#1d4ed8; }
`;

// Tone → color for the "current stage" badge (stageDisplay) and readiness rows.
const TONE = {
  ready:  { dot: '#60a5fa', border: '#334155' },
  active: { dot: '#60a5fa', border: '#334155' },
  wait:   { dot: '#f59e0b', border: '#d97706' },
  done:   { dot: '#22c55e', border: '#166534' },
};

function StationPicker({ value, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {STATIONS.map((st) => {
        const active = value === st.key;
        return (
          <button
            key={st.key}
            type="button"
            aria-label={'station-' + st.key}
            onClick={() => onPick(st.key)}
            style={{
              padding: '10px 18px', fontSize: 15, fontWeight: 800, borderRadius: 6, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 0.5,
              border: '1px solid ' + (active ? '#3b82f6' : '#334155'),
              background: active ? '#1e3a5f' : '#1e293b',
              color: active ? '#fff' : '#94a3b8',
            }}
          >
            {st.label}
          </button>
        );
      })}
    </div>
  );
}

// One readiness row (Artwork / Garments) in the job card checklist. ok → green
// check; a failure is amber for goods-on-order, red for art-not-approved — the
// same danger/warning split the two mockup states show.
function ReadinessCard({ label, state, danger }) {
  const tone = state.ok ? { border: '#166534', ring: 'rgba(34,197,94,0.15)', text: '#22c55e' }
    : danger ? { border: '#7f1d1d', ring: 'rgba(220,38,38,0.15)', text: '#f87171' }
    : { border: '#d97706', ring: 'rgba(217,119,6,0.18)', text: '#fbbf24' };
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, background: '#0f172a', border: '1px solid ' + tone.border, borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: tone.ring, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tone.text, fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
        {state.ok ? '✓' : danger ? '✕' : '!'}
      </div>
      <div>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ color: tone.text, fontSize: 19, fontWeight: 700 }}>{state.label}</div>
      </div>
    </div>
  );
}

function JobPanel({ station, job, resolvedCode, busy, onAdvance }) {
  const stage = normProdStatus(job.prod_status);
  const mismatch = !stationAccepts(station, job.deco_type);
  const files = stationFilesFor(station, job.files);
  const preview = previewImageFor(job.files);
  const action = nextActionFor(job);
  const stationLabel = stationByKey(station) ? stationByKey(station).label : station;

  const disp = stageDisplay(job);
  const tone = TONE[disp.tone] || TONE.wait;
  const readiness = jobReadiness(job);
  // Readiness only gates the pre-release (hold) tap — past release those checks
  // are moot. When a held job isn't ready, show the banner up front instead of a
  // release button that would bounce off the 00205 server gate.
  const preRelease = stage === 'hold' && !job.packed_at;
  const blocked = preRelease && !readiness.ready;
  const blockReason = !readiness.art.ok
    ? "Artwork isn't approved yet."
    : "Garments aren't all in hand yet.";

  const labelCap = { color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' };

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, overflow: 'hidden', marginTop: 14, display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
      {/* Station identity bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,0.18)' }} />
          <span style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>{stationLabel}</span>
        </div>
        <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>NSA Connect · Floor</span>
      </div>

      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {mismatch && (
          <div role="alert" style={{ background: 'rgba(220,38,38,0.12)', color: '#fecaca', border: '1px solid #dc2626', borderLeft: '6px solid #dc2626', borderRadius: 6, padding: '14px 18px', fontSize: 20, fontWeight: 800 }}>
            WRONG STATION — this is a {job.deco_type || 'unknown'} job, not {stationLabel} work. You can still proceed.
          </div>
        )}

        {/* Header: name + current-stage badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ ...labelCap, marginBottom: 8 }}>Job {job.so_id} · {job.job_id}</div>
            <div style={{ color: '#f1f5f9', fontSize: 52, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.5px' }}>{job.art_name || 'Unassigned Art'}</div>
            <div style={{ color: '#94a3b8', fontSize: 20, marginTop: 6 }}>
              {job.deco_type || '—'}{job.positions ? ' · ' + job.positions : ''} · {job.total_units || 0} pieces
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ ...labelCap, marginBottom: 8 }}>Current stage</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#0f172a', border: '1px solid ' + tone.border, borderRadius: 6, padding: '14px 20px' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: tone.dot }} />
              <span style={{ color: '#e2e8f0', fontSize: 28, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{disp.label}</span>
            </div>
          </div>
        </div>

        {/* Readiness checklist — only meaningful before release */}
        {preRelease && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <ReadinessCard label="Artwork" state={readiness.art} danger />
            <ReadinessCard label="Garments" state={readiness.goods} danger={false} />
          </div>
        )}

        {/* DTF prints status */}
        {job.dtf_prints_status && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...labelCap }}>DTF prints</span>
            <span style={{ fontSize: 15, fontWeight: 800, padding: '3px 10px', borderRadius: 4,
              background: job.dtf_prints_status === 'received' ? '#052e16' : '#422006',
              border: '1px solid ' + (job.dtf_prints_status === 'received' ? '#166534' : '#d97706'),
              color: job.dtf_prints_status === 'received' ? '#22c55e' : '#fbbf24' }}>
              {job.dtf_prints_status === 'received' ? 'RECEIVED' : job.dtf_prints_status === 'ordered' ? 'ON ORDER' : 'NEEDED'}
            </span>
            {job.dtf_bin && <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>· BIN {job.dtf_bin}</span>}
          </div>
        )}

        {/* Sizes */}
        {job.size_breakdown && Object.keys(job.size_breakdown).length > 0 && (
          <div>
            <div style={{ ...labelCap, marginBottom: 6 }}>Sizes</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sortedSizeEntries(job.size_breakdown).map(([sz, qty]) => (
                <span key={sz} style={{ fontSize: 17, fontWeight: 700, background: '#0f172a', border: '1px solid #334155', borderRadius: 4, padding: '4px 10px' }}>
                  <span style={{ color: '#94a3b8' }}>{sz}</span> <span style={{ color: '#e2e8f0' }}>{qty}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Production files (+ preview) */}
        {station !== 'packing' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {preview && (
              <img src={preview.url} alt={preview.name} style={{ width: 72, height: 72, objectFit: 'contain', background: '#fff', borderRadius: 8, flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ ...labelCap, marginBottom: 6 }}>{station === 'embroidery' ? 'DST file' : 'Production file'}</div>
              {files.length === 0 ? (
                <div style={{ fontSize: 16, color: '#fbbf24', fontWeight: 700 }}>
                  No {station === 'embroidery' ? 'DST' : 'print'} file on this job yet.
                </div>
              ) : files.map((f) => (
                <a key={f.url} href={f.url} target="_blank" rel="noreferrer"
                  style={{ display: 'block', fontSize: 18, fontWeight: 700, color: '#60a5fa', margin: '4px 0', wordBreak: 'break-all' }}>
                  {f.name || f.url}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {job.notes && (
          <div style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid #d97706', borderRadius: 6, padding: '12px 16px' }}>
            <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 17, color: '#fef3c7', whiteSpace: 'pre-wrap' }}>{job.notes}</div>
          </div>
        )}

        {/* Action: not-ready banner, stage button, or done */}
        {blocked ? (
          <div style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid #dc2626', borderLeft: '6px solid #dc2626', borderRadius: 6, padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ color: '#f87171', fontSize: 34, flexShrink: 0, lineHeight: 1 }}>⚠</span>
            <div>
              <div style={{ color: '#f87171', fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Not ready to run</div>
              <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 700, lineHeight: 1.25 }}>{blockReason} Set this aside and scan the next job.</div>
            </div>
          </div>
        ) : action ? (
          <button
            type="button"
            className="fs-btn"
            disabled={busy}
            onClick={() => onAdvance(job, action, resolvedCode)}
            style={S.bigBtn(busy ? '#334155' : '#2563eb')}
          >
            {busy ? 'Working…' : action.label}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#22c55e', fontSize: 20, fontWeight: 800 }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>✓</span> Done — packed.
          </div>
        )}
      </div>
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
        const notReady = notReadyMessage(r.error);
        setMsg({ kind: 'err', text: notReady || ('Move failed: ' + (r.error || 'unknown error')) });
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
      <style>{FS_CSS}</style>
      <div style={{ maxWidth: 1024, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#64748b', margin: 0, textTransform: 'uppercase', letterSpacing: 2 }}>
            Floor Station{stationToken ? ' · station mode' : ''}
          </h1>
          <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>NSA Connect · Floor</span>
        </div>
        <StationPicker value={station} onPick={pickStation} />
        <form onSubmit={onScanSubmit}>
          <label htmlFor="fs-scan" style={S.label}>Scan job barcode</label>
          <input
            id="fs-scan"
            ref={inputRef}
            className="fs-input"
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
            marginTop: 12, padding: '14px 18px', borderRadius: 6, fontSize: 18, fontWeight: 700,
            background: msg.kind === 'err' ? 'rgba(220,38,38,0.12)' : 'rgba(34,197,94,0.12)',
            border: '1px solid ' + (msg.kind === 'err' ? '#dc2626' : '#166534'),
            borderLeft: '6px solid ' + (msg.kind === 'err' ? '#dc2626' : '#22c55e'),
            color: msg.kind === 'err' ? '#fecaca' : '#a7f3d0',
          }}>
            {msg.text}
          </div>
        )}

        {pickJobs && pickJobs.jobs.map((j) => (
          <button
            key={j.job_id}
            type="button"
            className="fs-btn"
            onClick={() => resolve(pickJobs.code, j.job_id)}
            style={{ ...S.bigBtn('#2563eb'), fontSize: 20, minHeight: 0, padding: '14px 16px', marginTop: 10 }}
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

        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: 13 }}>
          <span>Scan next job to continue</span>
          <span style={{ fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{stationByKey(station) ? stationByKey(station).label : station}</span>
        </div>
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
