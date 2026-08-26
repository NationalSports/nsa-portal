import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import { plateFromCounter, boxUnits, buildBoxLabel, BOX_STATUS_META } from '../boxTracking';
import { printQrLabel, printQrLabels } from '../utils';
import { classifyMoveScan, boxesForRef, parseLegacyItems, makeLegacyMoveBox, normShelf, moveStats, inventoryTally, buildSubmitPlan, isCountedInventoryBox, boxStage, STAGE_META, placePatch, buildLocationLabels, submitPlanCsv, contentsToLines, linesToContents, splitGroups, assignBySo, assignEachLine, makeSplitBoxRow } from './moveLogic';

// Move Check-In station — September building move. Routed at /move-checkin by
// src/index.js (same wiring as /floor-station). Staff mode only: sign in to the
// portal once on the phone, then this page talks to the `boxes` table directly
// (staff RLS). Three jobs, one screen:
// The move flow is three stages: CHECKED IN → STAGING → ON SHELF.
//   1. CHECK IN — camera stays live; every BX QR scanned is stamped
//      checked_in_at/by. Old pre-plate labels (IF#/PO#) resolve to their boxes.
//   2. PLACE — pick a staging zone OR a final shelf once (locked), then scan
//      box after box into it (staging_area / bin; also checks in boxes that
//      skipped step 1). Staging is temporary; the shelf scan later finalizes.
//      Boxes with NO QR code are hand-entered from this same screen (the
//      "add a box by hand" panel): SO# + items, assigned to a job or to
//      inventory, and a 4×6 BX label prints so it's scannable from now on.
// A Boxes tab shows per-stage progress + filters and per-box actions; a Submit
// tab turns the counted inventory boxes into the new inventory numbers.

// ── feedback: sound + haptics (BaggingStation's pattern, local on purpose) ──
let _audioCtx = null;
function tone(freq, ms, delay = 0, type = 'sine', gain = 0.06) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = _audioCtx.currentTime + delay / 1000;
    const osc = _audioCtx.createOscillator(); const g = _audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g); g.connect(_audioCtx.destination);
    osc.start(t0); osc.stop(t0 + ms / 1000);
  } catch { /* audio unavailable — fine */ }
}
const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch {} };
const fxOk = () => { tone(660, 90); tone(990, 140, 80); vibrate(40); };
const fxDupe = () => { tone(440, 120); vibrate(15); };
const fxErr = () => { tone(160, 220, 0, 'square', 0.05); vibrate([80, 50, 80]); };

// Keep the phone awake while scanning (screen sleep mid-aisle kills the camera).
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock = null; let alive = true;
    const acquire = () => navigator.wakeLock.request('screen').then((l) => { if (alive) lock = l; else l.release(); }).catch(() => {});
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); if (lock) lock.release().catch(() => {}); };
  }, [active]);
}

// ── continuous camera scanner ─────────────────────────────────────────────────
// Unlike src/BarcodeScanner.js (one read → camera closes), the move flow is
// scan-scan-scan: the camera stays live and each NEW value fires onRead. The
// same value is ignored for a few seconds so a label held in frame doesn't
// double-fire. Same detector stack: native BarcodeDetector, polyfill on iOS.
function ContinuousScanner({ onRead, paused }) {
  const videoRef = useRef(null); const streamRef = useRef(null);
  const detectorRef = useRef(null); const loopRef = useRef(false);
  const lastRef = useRef({}); // value → last-fired ms
  const pausedRef = useRef(paused);
  const [on, setOn] = useState(false); const [err, setErr] = useState(null);
  const [torchOn, setTorchOn] = useState(false); const [torchOk, setTorchOk] = useState(false);
  pausedRef.current = paused;
  const onReadRef = useRef(onRead); onReadRef.current = onRead;

  const stop = useCallback(() => {
    loopRef.current = false;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setOn(false); setTorchOn(false); setTorchOk(false);
  }, []);

  const start = useCallback(async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      try { const trk = stream.getVideoTracks()[0]; const caps = trk && trk.getCapabilities && trk.getCapabilities(); setTorchOk(!!(caps && caps.torch)); } catch { setTorchOk(false); }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await new Promise((res) => { if (v.readyState >= v.HAVE_METADATA) res(); else v.onloadedmetadata = () => res(); });
        await v.play();
      }
      let Impl = 'BarcodeDetector' in window ? window.BarcodeDetector : null;
      if (!Impl) { const mod = await import('barcode-detector'); Impl = mod.BarcodeDetector; }
      detectorRef.current = new Impl({ formats: ['qr_code', 'code_128', 'code_39'] });
      setOn(true); loopRef.current = true; loop();
    } catch (e) {
      if (e && e.name === 'NotAllowedError') setErr('Camera permission denied — allow camera access and try again.');
      else if (e && e.name === 'NotFoundError') setErr('No camera found — use the type-in box below.');
      else setErr('Camera error: ' + ((e && e.message) || e));
    }
  }, []); // eslint-disable-line

  const loop = async () => {
    if (!loopRef.current || !videoRef.current || !detectorRef.current) return;
    try {
      if (!pausedRef.current) {
        const codes = await detectorRef.current.detect(videoRef.current);
        const val = codes && codes[0] && codes[0].rawValue;
        if (val) {
          const nowMs = Date.now();
          if (!lastRef.current[val] || nowMs - lastRef.current[val] > 3500) {
            lastRef.current[val] = nowMs;
            onReadRef.current(val);
          }
        }
      }
    } catch (e) { if (!e || e.name !== 'InvalidStateError') console.warn('[MoveCheckIn] detect:', (e && e.message) || e); }
    requestAnimationFrame(() => setTimeout(loop, 140));
  };

  const toggleTorch = async () => {
    try { const trk = streamRef.current && streamRef.current.getVideoTracks()[0]; if (!trk) return; const next = !torchOn; await trk.applyConstraints({ advanced: [{ torch: next }] }); setTorchOn(next); } catch { setTorchOk(false); }
  };

  useEffect(() => () => { loopRef.current = false; if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', border: '2px solid #334155', position: 'relative' }}>
      <video ref={videoRef} style={{ width: '100%', height: '38vh', minHeight: 220, objectFit: 'cover', display: on ? 'block' : 'none', background: '#000' }} autoPlay playsInline muted />
      {on && <>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 190, height: 190, border: '2px solid rgba(34,197,94,0.75)', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)' }} />
        </div>
        {torchOk && <button onClick={toggleTorch} style={{ position: 'absolute', top: 8, left: 8, background: torchOn ? '#fde68a' : 'rgba(0,0,0,0.6)', border: 'none', color: torchOn ? '#000' : '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🔦 {torchOn ? 'On' : 'Off'}</button>}
        <button onClick={stop} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>Close</button>
      </>}
      {!on && <div style={{ padding: 24, textAlign: 'center' }}>
        {err && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button onClick={start} style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 28px', fontSize: 17, fontWeight: 800, cursor: 'pointer' }}>📷 Start Scanning</button>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>Camera stays on — scan box after box.</div>
      </div>}
    </div>
  );
}

// ── kiosk skin ────────────────────────────────────────────────────────────────
// Phone-first, but a landscape tablet parked at the door is the other real
// station: from 900px the page widens, the type scales up, and the scanning
// tabs split into scanner-left / live-activity-right. Media queries can't live
// in inline styles, so the responsive half is this stylesheet (class names) and
// the rest stays inline, matching the other station chunks.
const MC_CSS = `
.mc-page { max-width: 560px; }
.mc-side { display: none; }
@media (min-width: 900px) {
  .mc-page { max-width: 1180px; padding: 20px 24px; }
  .mc-h1 { font-size: 28px !important; }
  .mc-stats { font-size: 15px !important; gap: 18px !important; }
  .mc-tabs button { font-size: 15px !important; padding: 15px 6px !important; }
  .mc-split { display: grid; grid-template-columns: 1.05fr .95fr; gap: 18px; align-items: start; }
  .mc-side { display: block; }
  .mc-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
  .mc-list > button { margin-bottom: 0 !important; }
  .mc-sheet { border-radius: 14px !important; max-height: 86vh !important; }
  .mc-overlay { align-items: center !important; padding: 24px; }
}
@media (min-width: 1280px) {
  .mc-list { grid-template-columns: 1fr 1fr 1fr; }
}
`;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const S = {
  page: { fontFamily: FONT, background: '#0f172a', color: '#f1f5f9', minHeight: '100vh', padding: 12, margin: '0 auto' },
  cap: { color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  input: { width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px 12px', color: '#fff', fontSize: 16, fontWeight: 600 },
  btn: (bg, disabled) => ({ width: '100%', padding: '14px 12px', fontSize: 17, fontWeight: 800, background: disabled ? '#334155' : bg, color: '#fff', border: 'none', borderRadius: 10, cursor: disabled ? 'default' : 'pointer' }),
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 12 },
};

const fmtWhen = (ts) => { try { const d = new Date(ts); return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const boxTitle = (b) => [b.so_id, b.if_id, b.po_id].filter(Boolean).join(' · ') || (b.assigned_to === 'inventory' ? 'INVENTORY' : (b.kind || ''));

export default function MoveCheckIn() {
  const { loading, signedIn, email } = useStaffSession();
  const [mode, setMode] = useState('checkin'); // 'checkin' | 'place' | 'boxes' | 'submit'
  const [boxes, setBoxes] = useState([]);
  const [banner, setBanner] = useState(null); // {kind:'ok'|'dupe'|'err', title, sub}
  const [sessionCount, setSessionCount] = useState(0);
  const [pick, setPick] = useState(null); // {ref, matches:[boxes]} — old-label multi-match
  const [manualVal, setManualVal] = useState('');
  const [shelf, setShelf] = useState('');
  const [placeKind, setPlaceKind] = useState('staging'); // Place tab: 'staging' | 'shelf'
  const [locCodes, setLocCodes] = useState(''); const [locOpen, setLocOpen] = useState(false); // location-label printer
  const [lgOpen, setLgOpen] = useState(false); // hand-entry panel on the Check In tab
  const [splitAssign, setSplitAssign] = useState(null); // null = not splitting; array parallel to detail.contents
  const [splitBusy, setSplitBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // box opened from the Boxes tab
  const [q, setQ] = useState('');
  const [stageFilter, setStageFilter] = useState('all'); // 'all' | boxStage values
  const [lastAction, setLastAction] = useState(null); // one-tap undo of the latest scan action
  // box detail "edit contents" mode (fix a scanned box after the fact)
  const [editLines, setEditLines] = useState(null); // null = viewing; array = editing
  const [edQ, setEdQ] = useState(''); const [edResults, setEdResults] = useState([]);
  // legacy form
  const [lgSo, setLgSo] = useState(''); const [lgAssign, setLgAssign] = useState('job');
  const [lgItems, setLgItems] = useState(''); const [lgShelf, setLgShelf] = useState('');
  // inventory boxes are counted by SKU + sizes (they become the new stocktake)
  const [lgLines, setLgLines] = useState([]); // [{product_id,sku,name,color,available_sizes,sizes:{}}]
  const [skuQ, setSkuQ] = useState(''); const [skuResults, setSkuResults] = useState([]);
  // submit tab
  const [plan, setPlan] = useState(null); // null | 'loading' | {counted,zeroCandidates,unmatched}
  const [zeroChecked, setZeroChecked] = useState({}); // product_id → true (confirmed zero-out)
  const [submitProg, setSubmitProg] = useState(null); // {done,total,fails:[]} while writing
  const [submitDone, setSubmitDone] = useState(null); // final summary
  // ── who's allowed in ──
  // Gating on the Supabase auth session ALONE locked out anyone who signed into
  // the portal with the admin-password override (LoginGate's pick-your-name
  // path sets _adminOverride and never creates an auth session). What actually
  // matters is whether this browser can read the boxes table, so probe that and
  // let real access — however it was obtained — decide.
  //   'checking' | 'ok' | 'no_session' (nothing signed in) | 'no_access' (signed in, RLS says no)
  const [access, setAccess] = useState('checking');
  // Who to stamp on checked_in_by/created_by: the auth email when there is one,
  // otherwise the portal user the browser is carrying.
  const whoRef = useRef(null);
  const [probeErr, setProbeErr] = useState('');
  const portalUser = (() => { try { return JSON.parse(localStorage.getItem('nsa_user') || 'null'); } catch (e) { return null; } })();
  const who = email || (portalUser && (portalUser.email || portalUser.name)) || null;
  whoRef.current = who;
  useWakeLock(access === 'ok' && (mode === 'checkin' || mode === 'place'));

  const boxesRef = useRef(boxes); boxesRef.current = boxes;
  const shelfRef = useRef(''); shelfRef.current = normShelf(shelf);
  const placeKindRef = useRef(placeKind); placeKindRef.current = placeKind;
  const modeRef = useRef(mode); modeRef.current = mode;

  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('boxes').select('*').order('updated_at', { ascending: false }).limit(1500);
    if (!error && data) setBoxes(data);
  }, []);
  useEffect(() => {
    if (loading) return undefined; // wait for the session check to settle first
    let alive = true;
    (async () => {
      if (!supabase) { if (alive) { setAccess('no_access'); setProbeErr('No database connection configured.'); } return; }
      const { error } = await supabase.from('boxes').select('id').limit(1);
      if (!alive) return;
      if (!error) { setAccess('ok'); reload(); return; }
      setProbeErr(error.message || String(error));
      setAccess(signedIn || portalUser ? 'no_access' : 'no_session');
    })();
    return () => { alive = false; };
  }, [loading, signedIn]);// eslint-disable-line
  // Several people scan at once during the move — keep counts/lists fresh
  // with a light poll while the page is visible.
  useEffect(() => {
    if (access !== 'ok') return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 20000);
    return () => clearInterval(t);
  }, [access, reload]);

  const show = (kind, title, sub, boxId) => { setBanner({ kind, title, sub, boxId: boxId || null, at: Date.now() }); (kind === 'ok' ? fxOk : kind === 'dupe' ? fxDupe : fxErr)(); };

  const patchBox = async (id, upd) => {
    const patch = { ...upd, updated_at: new Date().toISOString() };
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    const { error } = await supabase.from('boxes').update(patch).eq('id', id);
    if (error) { show('err', 'Save failed', error.message + ' — scan it again'); reload(); return false; }
    return true;
  };

  // Where is a box, human-readable ("shelf A3" / "staging DOCK 1").
  const whereStr = (b) => (b.bin ? 'shelf ' + b.bin : b.staging_area ? 'staging ' + b.staging_area : '');

  // Stamp a box checked in (idempotent), optionally also placing it
  // (place = {kind:'staging'|'shelf', code}).
  const checkInBox = async (box, { place } = {}) => {
    const already = !!box.checked_in_at;
    const upd = {};
    if (!already) { upd.checked_in_at = new Date().toISOString(); upd.checked_in_by = whoRef.current; }
    const samePlace = place && (place.kind === 'shelf' ? box.bin === place.code : box.staging_area === place.code && !box.bin);
    if (place && !samePlace) Object.assign(upd, placePatch(place.kind, place.code));
    if (Object.keys(upd).length) {
      const prev = { checked_in_at: box.checked_in_at || null, checked_in_by: box.checked_in_by || null, bin: box.bin || null, staging_area: box.staging_area || null };
      if (!(await patchBox(box.id, upd))) return;
      setLastAction({ kind: 'update', boxId: box.id, prev, wasCheckIn: !already, label: box.id + (place ? ' → ' + place.code : '') });
    }
    if (!already) setSessionCount((n) => n + 1);
    const units = boxUnits(box.contents);
    if (place) show(already && samePlace ? 'dupe' : 'ok', box.id + ' → ' + (place.kind === 'shelf' ? 'shelf ' : 'staging ') + place.code, boxTitle(box) + (units ? ' · ' + units + ' units' : ''), box.id);
    else if (already) show('dupe', box.id + ' — already checked in', (box.checked_in_at ? fmtWhen(box.checked_in_at) : '') + (whereStr(box) ? ' · ' + whereStr(box) : ''), box.id);
    else show('ok', box.id + ' checked in ✓', boxTitle(box) + (units ? ' · ' + units + ' units' : '') + (whereStr(box) ? ' · ' + whereStr(box) : ''), box.id);
  };

  // A BX plate that isn't in the table (label printed while the table lagged,
  // or a plate hand-written on a box): create the row so the plate is real.
  const adoptPlate = async (plate, place) => {
    const now = new Date().toISOString();
    const row = { id: plate, kind: 'legacy', contents: [], source_refs: [], status: 'staged', bin: null, staging_area: null, ...(place ? placePatch(place.kind, place.code) : {}), created_by: whoRef.current, created_at: now, updated_at: now, checked_in_at: now, checked_in_by: whoRef.current };
    const { error } = await supabase.from('boxes').insert(row);
    if (error) { show('err', plate + ' — save failed', error.message); return; }
    setBoxes((prev) => [row, ...prev]); setSessionCount((n) => n + 1);
    setLastAction({ kind: 'insert', boxId: plate, wasCheckIn: true, label: plate + ' (new plate)' });
    show('ok', plate + ' checked in ✓', 'New plate — add contents later from the Boxes tab' + (place ? ' · ' + (place.kind === 'shelf' ? 'shelf ' : 'staging ') + place.code : ''));
  };

  // One-tap undo of the latest scan action: an update restores the box's prior
  // check-in/location fields; an adopted plate is deleted outright.
  const undoLast = async () => {
    const a = lastAction; if (!a) return;
    setLastAction(null);
    if (a.kind === 'insert') {
      const { error } = await supabase.from('boxes').delete().eq('id', a.boxId);
      if (error) { show('err', 'Undo failed', error.message); return; }
      setBoxes((prev) => prev.filter((b) => b.id !== a.boxId));
    } else if (!(await patchBox(a.boxId, a.prev))) return;
    if (a.wasCheckIn) setSessionCount((n) => Math.max(0, n - 1));
    show('dupe', '↩︎ Undid ' + a.label, a.kind === 'insert' ? 'The new plate was removed.' : 'Box restored to how it was before that scan.');
  };

  // Execute a carton split: mint a plate per new group, insert the new boxes
  // (inheriting the source's check-in stamp/location/assignment), shrink the
  // original to what stayed, and print one label per new box.
  const runSplit = async (srcId, assignment) => {
    if (splitBusy) return;
    const src = boxes.find((b) => b.id === srcId);
    if (!src) return;
    const { keep, newBoxes } = splitGroups(src.contents, assignment);
    if (!newBoxes.length) { show('err', 'Nothing to split', 'Tap lines to send them to New box 1, 2, …'); return; }
    setSplitBusy(true);
    try {
      const rows = [];
      for (const contents of newBoxes) {
        const plate = await mintPlate();
        rows.push(makeSplitBoxRow(src, plate, contents));
      }
      const { error } = await supabase.from('boxes').insert(rows);
      if (error) { show('err', 'Split failed', error.message); return; }
      if (!(await patchBox(src.id, { contents: keep }))) return;
      setBoxes((prev) => [...rows, ...prev]);
      setDetail(null); setSplitAssign(null);
      show('ok', src.id + ' split into ' + (rows.length + 1) + ' boxes ✓', rows.map((r) => r.id).join(' · ') + ' — labels printing');
      try { printQrLabels(rows.map((r) => buildBoxLabel(r, { program: r.assigned_to === 'inventory' ? 'INVENTORY' : '', scanBase: window.location.origin + '/' }))); } catch (e) { console.warn('[MoveCheckIn] split labels:', e); }
    } finally { setSplitBusy(false); }
  };

  // Plain function on purpose (not useCallback): ContinuousScanner reads the
  // latest via a ref, and a memoized version would freeze the first render's
  // email/checkInBox closures.
  const handleScan = async (raw) => {
    const c = classifyMoveScan(raw);
    const place = modeRef.current === 'place' ? (shelfRef.current ? { kind: placeKindRef.current, code: shelfRef.current } : null) : null;
    // A printed location label (LOC:A3) locks the Place tab onto that location
    // hands-free — from any scanning tab.
    if (c.type === 'loc') {
      setMode('place'); setShelf(c.code); setPick(null);
      show('ok', '📍 Location locked: ' + c.code, 'Now scan every box going to ' + (placeKindRef.current === 'shelf' ? 'shelf' : 'staging') + ' ' + c.code + '.');
      return;
    }
    if (modeRef.current === 'place' && !place) { show('err', 'Pick a location first', 'Type or scan the ' + (placeKindRef.current === 'shelf' ? 'shelf' : 'staging zone') + ' code above, then scan boxes.'); return; }
    if (c.type === 'empty') return;
    if (c.type === 'box') {
      const box = boxesRef.current.find((b) => b.id === c.id);
      if (!box) { await adoptPlate(c.id, place); return; }
      if (box.status === 'combined' && box.merged_into) {
        const tgt = boxesRef.current.find((b) => b.id === box.merged_into);
        if (tgt) { show('dupe', c.id + ' was combined into ' + tgt.id, 'Checked that one in instead.'); await checkInBox(tgt, { place }); return; }
      }
      await checkInBox(box, { place });
      return;
    }
    // old pre-plate label: IF# / PO# / SO#
    const matches = boxesForRef(boxesRef.current, c.id);
    if (matches.length === 1) { await checkInBox(matches[0], { place }); return; }
    if (matches.length > 1) { setPick({ ref: c.id, matches, place }); fxDupe(); return; }
    show('err', 'No box found for "' + c.id + '"', 'Use the No QR tab to enter it and print a label.');
  };

  const mintPlate = async () => {
    try {
      const { data, error } = await supabase.rpc('next_counter', { p_key: 'box_plate' });
      if (!error && data != null) return plateFromCounter(+data);
    } catch (e) { /* fall through */ }
    return 'BX-M' + Date.now().toString(36).toUpperCase(); // offline-safe unique plate
  };

  const printLegacyLabel = (row) => {
    try {
      printQrLabel(buildBoxLabel(row, {
        program: row.assigned_to === 'inventory' ? 'INVENTORY' : '',
        memo: row.bin ? 'Shelf ' + row.bin : '',
        scanBase: window.location.origin + '/',
      }));
    } catch (e) { console.warn('[MoveCheckIn] label print failed:', e); }
  };

  const submitLegacy = async () => {
    if (busy) return;
    const soId = lgSo.trim().toUpperCase() || null;
    // Inventory boxes carry SKU×size counts (they become the new stocktake);
    // job boxes can stay free text — they never touch inventory numbers.
    const items = lgAssign === 'inventory'
      ? lgLines.map((l) => ({ sku: l.sku, product_id: l.product_id, name: l.name, color: l.color || '', sizes: Object.fromEntries(Object.entries(l.sizes || {}).filter(([, v]) => (+v || 0) > 0).map(([s, v]) => [s, +v])) })).filter((l) => Object.keys(l.sizes).length)
      : parseLegacyItems(lgItems);
    if (lgAssign === 'job' && !soId) { show('err', 'SO number required', 'Assigning to a job needs its SO# — or switch to Inventory.'); return; }
    if (lgAssign === 'inventory' && !items.length) { show('err', 'Add at least one SKU with a quantity', 'Inventory boxes are counted by SKU + size so Submit can set the new numbers.'); return; }
    setBusy(true);
    try {
      const plate = await mintPlate();
      const row = makeLegacyMoveBox({ plate, assign: lgAssign, soId, items, bin: normShelf(lgShelf) || null, createdBy: whoRef.current });
      const { error } = await supabase.from('boxes').insert(row);
      if (error) { show('err', 'Save failed', error.message); return; }
      setBoxes((prev) => [row, ...prev]); setSessionCount((n) => n + 1);
      show('ok', plate + ' checked in ✓', (lgAssign === 'job' ? 'Job ' + soId : 'Inventory') + ' · ' + (boxUnits(items) || items.length) + ' units — label printing');
      printLegacyLabel(row);
      setLgSo(''); setLgItems(''); setLgShelf(''); setLgLines([]); setSkuQ(''); setSkuResults([]); setLgOpen(false);
    } finally { setBusy(false); }
  };

  // SKU lookup (products table, staff RLS) — shared by the No QR tab's line
  // editor and the box-detail contents editor.
  const productSearch = async (qStr) => {
    const s = qStr.trim().replace(/[,()]/g, ' ').trim(); // commas/parens break PostgREST .or() filters
    if (s.length < 2) return [];
    const { data, error } = await supabase.from('products').select('id,sku,name,color,available_sizes').or('sku.ilike.%' + s + '%,name.ilike.%' + s + '%').limit(8);
    return !error && data ? data : [];
  };
  const searchSku = async (qStr) => { setSkuQ(qStr); setSkuResults(await productSearch(qStr)); };
  const productToLine = (p) => ({ product_id: p.id, sku: p.sku, name: p.name, color: p.color || '', available_sizes: (p.available_sizes && p.available_sizes.length ? p.available_sizes : ['OS']), sizes: {} });
  const addSkuLine = (p) => {
    setLgLines((prev) => prev.some((l) => l.product_id === p.id) ? prev : [...prev, productToLine(p)]);
    setSkuQ(''); setSkuResults([]);
  };

  // ── Submit tab: tally counted inventory boxes vs live product_inventory ──
  const fetchInChunks = async (table, cols, col, vals) => {
    const out = [];
    for (let i = 0; i < vals.length; i += 200) {
      const { data, error } = await supabase.from(table).select(cols).in(col, vals.slice(i, i + 200));
      if (error) throw new Error(table + ': ' + error.message);
      out.push(...(data || []));
    }
    return out;
  };
  const loadPlan = async () => {
    setPlan('loading'); setSubmitDone(null);
    try {
      const { data: freshBoxes, error: bErr } = await supabase.from('boxes').select('*').limit(5000);
      if (bErr) throw new Error(bErr.message);
      setBoxes((freshBoxes || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
      const tally = inventoryTally(freshBoxes);
      const { data: invRows, error: iErr } = await supabase.from('product_inventory').select('product_id,size,quantity').limit(50000);
      if (iErr) throw new Error(iErr.message);
      const ids = [...new Set([...(invRows || []).map((r) => r.product_id), ...Object.values(tally).map((t) => t.product_id).filter(Boolean)])];
      const products = await fetchInChunks('products', 'id,sku,name,color', 'id', ids);
      // counted SKUs with no product_id still need a product match by SKU
      const skus = Object.keys(tally).filter((s) => s && !products.some((p) => String(p.sku || '').toUpperCase() === s));
      if (skus.length) products.push(...await fetchInChunks('products', 'id,sku,name,color', 'sku', skus));
      setPlan(buildSubmitPlan(tally, invRows, products));
      setZeroChecked({});
    } catch (e) { setPlan(null); show('err', 'Could not load the count', (e && e.message) || String(e)); }
  };
  // Download the submit review as CSV — the stocktake paper trail.
  const downloadCsv = () => {
    try {
      const blob = new Blob([submitPlanCsv(plan, zeroChecked)], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'move-count-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { show('err', 'Export failed', (e && e.message) || String(e)); }
  };

  const runSubmit = async () => {
    if (!plan || plan === 'loading' || submitProg) return;
    const zeros = plan.zeroCandidates.filter((z) => zeroChecked[z.product_id]);
    const writes = [...plan.counted, ...zeros];
    if (!writes.length) { show('err', 'Nothing to submit', 'No counted inventory boxes yet.'); return; }
    const sure = window.confirm('Set new inventory numbers for ' + plan.counted.length + ' counted SKUs' + (zeros.length ? ' and ZERO OUT ' + zeros.length + ' SKUs that never came over' : '') + '?\n\nThis replaces the portal inventory counts.');
    if (!sure) return;
    setSubmitProg({ done: 0, total: writes.length, fails: [] });
    const fails = [];
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i];
      // base:null = absolute set (00239 merge_product_inventory) — a stocktake
      // states what's physically on the shelf, not a delta.
      const { error } = await supabase.rpc('merge_product_inventory', { p_product_id: w.product_id, p_rows: w.rows.map((r) => ({ size: r.size, quantity: r.quantity, base: null })) });
      if (error) fails.push(w.sku + ': ' + error.message);
      setSubmitProg({ done: i + 1, total: writes.length, fails });
    }
    setSubmitProg(null);
    setSubmitDone({ counted: plan.counted.length, zeroed: zeros.length, fails });
    (fails.length ? fxErr : fxOk)();
    setPlan(null);
  };

  // ── render ──
  if (loading || access === 'checking') return <div className="mc-page" style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  if (access !== 'ok') {
    // 'no_access' means the portal knows who you are but this browser has no
    // database session — the admin-password override login is the usual cause,
    // since it picks a name without signing in to Supabase.
    const overridden = access === 'no_access';
    return (
      <div className="mc-page" style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 40 }}>📦</div>
          <h1 style={{ fontSize: 22, margin: '10px 0 6px' }}>Move Check-In</h1>
          {overridden ? <>
            <p style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 6 }}>
              {portalUser && portalUser.name ? portalUser.name + ', you\u2019re' : 'You\u2019re'} signed into the portal, but this device has no database sign-in — so the station can’t read or save boxes.
            </p>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 14 }}>
              That happens when you got in with the <b>admin password + pick-your-name</b> screen. Sign in with your own <b>email and password</b> instead, then reopen this page.
            </p>
          </> : (
            <p style={{ color: '#94a3b8', fontSize: 15, marginBottom: 14 }}>Sign in to the portal on this device first, then come back to /move-checkin.</p>
          )}
          <a href="/" style={{ display: 'inline-block', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '12px 22px', fontWeight: 800, textDecoration: 'none' }}>Go to portal sign-in</a>
          <button onClick={() => { setAccess('checking'); setProbeErr(''); setTimeout(() => window.location.reload(), 50); }} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>↻ I’ve signed in — try again</button>
          {probeErr ? <div style={{ color: '#64748b', fontSize: 11, marginTop: 14, fontFamily: 'monospace' }}>{probeErr}</div> : null}
        </div>
      </div>
    );
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const stats = moveStats(boxes, todayStart.toISOString());
  const tabs = [['checkin', '✅ Check In'], ['place', '📍 Place'], ['submit', '📊 Submit']];

  const bannerBox = banner && (
    <div style={{ borderRadius: 10, padding: '12px 14px', margin: '10px 0', background: banner.kind === 'ok' ? '#14532d' : banner.kind === 'dupe' ? '#78350f' : '#7f1d1d', border: '1px solid ' + (banner.kind === 'ok' ? '#22c55e' : banner.kind === 'dupe' ? '#f59e0b' : '#ef4444') }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{banner.title}</div>
      {banner.sub ? <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 2 }}>{banner.sub}</div> : null}
      {banner.boxId ? <button onClick={() => { const b = boxes.find((x) => x.id === banner.boxId); if (b) { setDetail({ ...b, _shelf: b.bin || b.staging_area || '' }); setEditLines(null); setSplitAssign(null); } }} style={{ marginTop: 8, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Open {banner.boxId} — split / edit ▸</button> : null}
    </div>
  );

  const manualRow = (
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input value={manualVal} onChange={(e) => setManualVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && manualVal.trim()) { handleScan(manualVal); setManualVal(''); } }} placeholder="Type BX#, IF#, PO#, SO#…" style={{ ...S.input, fontFamily: 'monospace' }} />
      <button onClick={() => { if (manualVal.trim()) { handleScan(manualVal); setManualVal(''); } }} style={{ ...S.btn('#2563eb'), width: 'auto', padding: '0 18px' }}>Go</button>
    </div>
  );

  // Newest check-ins first — the tablet's live activity column.
  const recent = boxes.filter((b) => b.checked_in_at && b.status !== 'combined')
    .sort((a, b) => String(b.checked_in_at).localeCompare(String(a.checked_in_at))).slice(0, 12);

  const filtered = boxes.filter((b) => {
    if (b.status === 'combined') return false;
    if (stageFilter !== 'all' && boxStage(b) !== stageFilter) return false;
    if (!q.trim()) return true;
    const s = q.trim().toUpperCase();
    return [b.id, b.so_id, b.if_id, b.po_id, b.bin, b.staging_area, b.assigned_to].some((x) => String(x || '').toUpperCase().includes(s))
      || (b.contents || []).some((e) => String((e && e.name) || '').toUpperCase().includes(s));
  });

  return (
    <div className="mc-page" style={S.page}>
      <style>{MC_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 className="mc-h1" style={{ fontSize: 20, margin: '2px 0 2px' }}>📦 Move Check-In</h1>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{sessionCount ? sessionCount + ' this session' : who}</div>
      </div>
      {/* per-stage progress: checked in → staging → on shelf */}
      <div className="mc-stats" style={{ display: 'flex', gap: 10, margin: '4px 0 10px', fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <span><b style={{ color: STAGE_META.checked_in.color }}>{stats.checkedIn}</b> in ({stats.today} today)</span>
        <span><b style={{ color: STAGE_META.staged.color }}>{stats.staged}</b> staging</span>
        <span><b style={{ color: STAGE_META.shelved.color }}>{stats.shelved}</b> on shelf</span>
        <span><b style={{ color: stats.checkedInOnly ? '#f59e0b' : '#22c55e' }}>{stats.checkedInOnly}</b> unplaced</span>
      </div>
      {stats.checkedIn > 0 && (
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b', marginBottom: 10 }}>
          <div style={{ width: (stats.shelved / stats.checkedIn * 100) + '%', background: STAGE_META.shelved.color }} />
          <div style={{ width: (stats.staged / stats.checkedIn * 100) + '%', background: STAGE_META.staged.color }} />
        </div>
      )}
      <div className="mc-tabs" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setMode(id); setBanner(null); setPick(null); if (id === 'submit' && plan == null) loadPlan(); }} style={{ flex: 1, padding: '10px 2px', fontSize: 12, fontWeight: 800, border: 'none', borderRadius: 8, cursor: 'pointer', background: mode === id ? '#2563eb' : '#1e293b', color: mode === id ? '#fff' : '#94a3b8' }}>{label}</button>
        ))}
      </div>

      {mode === 'place' && (
        <div style={{ ...S.card, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setPlaceKind('staging')} style={{ ...S.btn(placeKind === 'staging' ? '#7c3aed' : '#1e293b'), fontSize: 14, padding: '10px', border: placeKind === 'staging' ? 'none' : '1px solid #334155' }}>📥 Staging zone</button>
            <button onClick={() => setPlaceKind('shelf')} style={{ ...S.btn(placeKind === 'shelf' ? '#166534' : '#1e293b'), fontSize: 14, padding: '10px', border: placeKind === 'shelf' ? 'none' : '1px solid #334155' }}>🗄️ Final shelf</button>
          </div>
          <div style={S.cap}>{placeKind === 'shelf' ? 'Shelf' : 'Staging zone'} — set once, then scan every box going there</div>
          <input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={placeKind === 'shelf' ? 'e.g. A3, RACK 12…' : 'e.g. STAGE 1, DOCK…'} style={{ ...S.input, marginTop: 6, fontFamily: 'monospace', fontSize: 20, fontWeight: 800, color: shelf ? (placeKind === 'shelf' ? '#22c55e' : '#a78bfa') : '#fff' }} />
          {placeKind === 'staging' && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Staging is temporary — re-scan the box in Final shelf mode when it lands on its shelf.</div>}
          <button onClick={() => setLocOpen(!locOpen)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, marginTop: 8 }}>{locOpen ? '▾' : '▸'} 🖨️ Print location labels</button>
          {locOpen && <>
            <div style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0' }}>One code per line (or commas). Post the printed 4×6 label on each shelf/zone — scanning it locks this tab onto that location, no typing.</div>
            <textarea value={locCodes} onChange={(e) => setLocCodes(e.target.value)} placeholder={'A1\nA2\nSTAGE 1'} rows={3} style={{ ...S.input, fontFamily: 'monospace', resize: 'vertical' }} />
            <button onClick={() => { const labels = buildLocationLabels(locCodes); if (labels.length) { try { printQrLabels(labels); } catch (e) { console.warn('[MoveCheckIn] location labels:', e); } } }} disabled={!buildLocationLabels(locCodes).length} style={{ ...S.btn('#2563eb', !buildLocationLabels(locCodes).length), fontSize: 14, padding: '10px', marginTop: 6 }}>Print {buildLocationLabels(locCodes).length || ''} label{buildLocationLabels(locCodes).length === 1 ? '' : 's'}</button>
          </>}
        </div>
      )}

      {(mode === 'checkin' || mode === 'place') && <div className="mc-split"><div>
        <ContinuousScanner onRead={handleScan} paused={!!pick} />
        {bannerBox}
        {lastAction && (
          <button onClick={undoLast} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px', marginTop: banner ? 0 : 10 }}>↩︎ Undo last scan — {lastAction.label}</button>
        )}
        {manualRow}
        {/* No QR code on the box? Hand-entry lives right here rather than in its
            own tab — one screen covers camera, typing, and manual add. */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => setLgOpen(!lgOpen)} style={{ ...S.btn(lgOpen ? '#334155' : '#1e293b'), fontSize: 14, padding: '12px', border: '1px solid #334155' }}>
            {lgOpen ? '▾' : '▸'} 📝 No QR — add by hand
          </button>
          <button onClick={() => setMode('boxes')} style={{ ...S.btn('#1e293b'), fontSize: 14, padding: '12px', border: '1px solid #334155' }}>🔍 Find a box</button>
        </div>
        {lgOpen && <div style={{ ...S.card, marginTop: 8 }}>
          <div style={S.cap}>Assign this box to</div>
          <div style={{ display: 'flex', gap: 6, margin: '6px 0 12px' }}>
            <button onClick={() => setLgAssign('job')} style={{ ...S.btn(lgAssign === 'job' ? '#2563eb' : '#1e293b'), border: lgAssign === 'job' ? 'none' : '1px solid #334155', fontSize: 15 }}>Job / Order</button>
            <button onClick={() => setLgAssign('inventory')} style={{ ...S.btn(lgAssign === 'inventory' ? '#2563eb' : '#1e293b'), border: lgAssign === 'inventory' ? 'none' : '1px solid #334155', fontSize: 15 }}>Inventory</button>
          </div>
          <div style={S.cap}>SO number {lgAssign === 'inventory' ? '(optional)' : ''}</div>
          <input value={lgSo} onChange={(e) => setLgSo(e.target.value)} placeholder="SO-1234" style={{ ...S.input, margin: '6px 0 12px', fontFamily: 'monospace' }} />
          {lgAssign === 'job' ? <>
            <div style={S.cap}>What's in the box — one line per item, quantity first</div>
            <textarea value={lgItems} onChange={(e) => setLgItems(e.target.value)} placeholder={'12 x navy hoodies L\n6 white polos\ntrophy parts'} rows={4} style={{ ...S.input, margin: '6px 0 12px', fontFamily: FONT, resize: 'vertical' }} />
          </> : <>
            <div style={S.cap}>What's in the box — by SKU, counts become the new inventory</div>
            <input value={skuQ} onChange={(e) => searchSku(e.target.value)} placeholder="Type SKU or product name…" style={{ ...S.input, margin: '6px 0 4px', fontFamily: 'monospace' }} />
            {skuResults.map((p) => (
              <button key={p.id} onClick={() => addSkuLine(p)} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', marginBottom: 3, fontSize: 13, cursor: 'pointer' }}>
                <b style={{ fontFamily: 'monospace' }}>{p.sku}</b> — {p.name}{p.color ? ' · ' + p.color : ''}
              </button>
            ))}
            {lgLines.map((l, li) => (
              <div key={l.product_id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 8, margin: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span><b style={{ fontFamily: 'monospace' }}>{l.sku}</b> · {l.name}{l.color ? ' · ' + l.color : ''}</span>
                  <button onClick={() => setLgLines((prev) => prev.filter((_, i) => i !== li))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {l.available_sizes.map((sz) => (
                    <label key={sz} style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>{sz}<br />
                      <input type="number" inputMode="numeric" min="0" value={l.sizes[sz] ?? ''} onChange={(e) => setLgLines((prev) => prev.map((x, i) => i === li ? { ...x, sizes: { ...x.sizes, [sz]: e.target.value } } : x))} style={{ ...S.input, width: 54, padding: '8px 4px', textAlign: 'center', fontSize: 15 }} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ height: 8 }} />
          </>}
          <div style={S.cap}>Shelf (optional — most boxes go to staging first and get placed later)</div>
          <input value={lgShelf} onChange={(e) => setLgShelf(e.target.value)} placeholder="A3" style={{ ...S.input, margin: '6px 0 14px', fontFamily: 'monospace' }} />
          <button onClick={submitLegacy} disabled={busy} style={S.btn('#166534', busy)}>{busy ? 'Saving…' : '✓ Check In + Print QR Label'}</button>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>A 4×6 BX label prints — stick it on the box so it scans from now on.</div>
        </div>}
        {pick && (
          <div style={{ ...S.card, marginTop: 10, border: '1px solid #f59e0b' }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{pick.ref} has {pick.matches.length} boxes — which one is this?</div>
            {pick.matches.map((b) => (
              <button key={b.id} onClick={async () => { setPick(null); await checkInBox(b, { place: pick.place }); }} style={{ ...S.btn('#1e293b'), textAlign: 'left', marginBottom: 6, border: '1px solid #334155', fontSize: 14 }}>
                <b>{b.id}</b> · {boxUnits(b.contents)} units {b.checked_in_at ? '· ✓ ' + fmtWhen(b.checked_in_at) : ''}{whereStr(b) ? ' · ' + whereStr(b) : ''}
              </button>
            ))}
            <button onClick={async () => { const m = pick; setPick(null); for (const b of m.matches) await checkInBox(b, { place: m.place }); }} style={S.btn('#166534')}>Check in ALL {pick.matches.length}</button>
            <button onClick={() => setPick(null)} style={{ ...S.btn('#334155'), marginTop: 6, fontSize: 14, padding: '10px' }}>Cancel</button>
          </div>
        )}
      </div>
      {/* Tablet-only second column: the live feed of what's been scanned in.
          Hidden on phones (.mc-side), where the banner alone is the feedback. */}
      <div className="mc-side">
        <div style={{ ...S.card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <b style={{ fontSize: 15 }}>Just checked in</b>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{stats.checkedIn} total · {stats.today} today</span>
          </div>
          {!recent.length && <div style={{ fontSize: 13, color: '#94a3b8', padding: '18px 0', textAlign: 'center' }}>Scans show up here as boxes come in.</div>}
          {recent.map((b) => {
            const sm = STAGE_META[boxStage(b)];
            return (
              <button key={b.id} onClick={() => { setDetail({ ...b, _shelf: b.bin || b.staging_area || '' }); setEditLines(null); setSplitAssign(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', marginBottom: 6, color: '#f1f5f9', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <b style={{ fontFamily: 'monospace', fontSize: 14 }}>{b.id}</b>
                  <span style={{ fontSize: 12, color: sm.color, fontWeight: 700 }}>{sm.label}{b.bin ? ' · ' + b.bin : b.staging_area ? ' · ' + b.staging_area : ''}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{boxTitle(b)} · {boxUnits(b.contents)} units · {fmtWhen(b.checked_in_at)}</div>
              </button>
            );
          })}
        </div>
      </div>
      </div>}


      {mode === 'boxes' && (
        <div>
          <button onClick={() => setMode('checkin')} style={{ ...S.btn('#1e293b'), fontSize: 14, padding: '10px', marginBottom: 10, border: '1px solid #334155' }}>← Back to Check In</button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search box, SO#, shelf, staging, item…" style={{ ...S.input, marginBottom: 8 }} autoFocus />
          <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['checked_in', 'Unplaced'], ['staged', 'Staging'], ['shelved', 'On shelf'], ['not_in', 'Not in'], ['shipped', 'Shipped']].map(([id, label]) => (
              <button key={id} onClick={() => setStageFilter(id)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, border: '1px solid ' + (stageFilter === id ? (STAGE_META[id] ? STAGE_META[id].color : '#2563eb') : '#334155'), borderRadius: 999, cursor: 'pointer', background: stageFilter === id ? '#1e293b' : 'transparent', color: stageFilter === id ? (STAGE_META[id] ? STAGE_META[id].color : '#fff') : '#94a3b8' }}>{label}</button>
            ))}
          </div>
          <div className="mc-list">
          {filtered.slice(0, 200).map((b) => {
            const st = BOX_STATUS_META[b.status];
            const stage = boxStage(b);
            const sm = STAGE_META[stage];
            return (
              <button key={b.id} onClick={() => { setDetail({ ...b, _shelf: b.bin || b.staging_area || '' }); setEditLines(null); setSplitAssign(null); }} style={{ ...S.card, width: '100%', textAlign: 'left', color: '#f1f5f9', cursor: 'pointer', marginBottom: 6, display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <b style={{ fontFamily: 'monospace', fontSize: 15 }}>{b.id}</b>
                  <span style={{ fontSize: 12, color: sm.color, fontWeight: 700 }}>{stage === 'not_in' && st && b.status !== 'staged' ? st.label : sm.label}{b.bin ? ' · ' + b.bin : b.staging_area ? ' · ' + b.staging_area : ''}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{boxTitle(b)} · {boxUnits(b.contents)} units{b.checked_in_at ? ' · ' + fmtWhen(b.checked_in_at) : ''}</div>
              </button>
            );
          })}
          </div>
          {!filtered.length && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>No boxes match.</div>}
        </div>
      )}

      {mode === 'submit' && (
        <div>
          {submitDone && (
            <div style={{ ...S.card, marginBottom: 10, border: '1px solid ' + (submitDone.fails.length ? '#ef4444' : '#22c55e') }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{submitDone.fails.length ? '⚠️ Submitted with errors' : '✅ New inventory numbers are live'}</div>
              <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 4 }}>{submitDone.counted} SKUs set to their move counts{submitDone.zeroed ? ' · ' + submitDone.zeroed + ' SKUs zeroed out' : ''}.</div>
              {submitDone.fails.map((f, i) => <div key={i} style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>{f}</div>)}
            </div>
          )}
          {plan === 'loading' && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>Tallying counted boxes…</div>}
          {plan == null && !submitDone && <button onClick={loadPlan} style={S.btn('#2563eb')}>Load the count</button>}
          {plan && plan !== 'loading' && <>
            <div style={{ ...S.card, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>The move count is the new inventory</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Counts come from checked-in boxes assigned to <b style={{ color: '#e2e8f0' }}>Inventory</b> ({boxes.filter(isCountedInventoryBox).length} boxes). Sales-order boxes are never counted. Review, confirm the zero-outs, then submit.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={loadPlan} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px' }}>↻ Refresh count</button>
                <button onClick={downloadCsv} style={{ ...S.btn('#2563eb'), fontSize: 14, padding: '10px' }}>⬇ Download CSV</button>
              </div>
            </div>
            {plan.unmatched.length > 0 && (
              <div style={{ ...S.card, marginBottom: 10, border: '1px solid #ef4444' }}>
                <div style={{ fontWeight: 800, color: '#f87171' }}>⚠️ {plan.unmatched.length} counted item{plan.unmatched.length > 1 ? 's' : ''} don't match a product SKU</div>
                <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 6px' }}>These are NOT included in the submit. Fix the SKU on the box (Boxes tab) or leave them out on purpose.</div>
                {plan.unmatched.map((t, i) => <div key={i} style={{ fontSize: 13, fontFamily: 'monospace' }}>{t.sku || '(no SKU)'} {t.name ? '· ' + t.name : ''} — {Object.entries(t.sizes).map(([s, v]) => s + ':' + v).join(' ')}</div>)}
              </div>
            )}
            <div style={{ ...S.card, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>✅ Counted — {plan.counted.length} SKUs get these numbers</div>
              {!plan.counted.length && <div style={{ fontSize: 13, color: '#94a3b8' }}>Nothing counted yet — check in inventory boxes first.</div>}
              {plan.counted.map((c) => (
                <div key={c.product_id} style={{ borderTop: '1px solid #334155', padding: '6px 0', fontSize: 13 }}>
                  <b style={{ fontFamily: 'monospace' }}>{c.sku}</b> · {c.name}{c.color ? ' · ' + c.color : ''} — <b style={{ color: '#22c55e' }}>{c.units} units</b>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{c.rows.map((r) => r.size + ': ' + r.oldQty + '→' + r.quantity).join('  ')}</div>
                </div>
              ))}
            </div>
            <div style={{ ...S.card, marginBottom: 10, border: '1px solid #f59e0b' }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>🚫 Never came over — {plan.zeroCandidates.length} SKUs</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>These have portal stock today but zero boxes checked in. Tick the ones to ZERO OUT; unticked SKUs keep their current numbers.</div>
              {plan.zeroCandidates.length > 1 && (
                <button onClick={() => { const all = plan.zeroCandidates.every((z) => zeroChecked[z.product_id]); setZeroChecked(all ? {} : Object.fromEntries(plan.zeroCandidates.map((z) => [z.product_id, true]))); }} style={{ ...S.btn('#334155'), fontSize: 13, padding: '8px', marginBottom: 8 }}>
                  {plan.zeroCandidates.every((z) => zeroChecked[z.product_id]) ? 'Untick all' : 'Tick all ' + plan.zeroCandidates.length}
                </button>
              )}
              {plan.zeroCandidates.map((z) => (
                <label key={z.product_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', borderTop: '1px solid #334155', padding: '6px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!zeroChecked[z.product_id]} onChange={(e) => setZeroChecked((prev) => ({ ...prev, [z.product_id]: e.target.checked }))} style={{ width: 18, height: 18 }} />
                  <span><b style={{ fontFamily: 'monospace' }}>{z.sku}</b> · {z.name} — <b style={{ color: '#f59e0b' }}>{z.oldUnits} units today</b> → {zeroChecked[z.product_id] ? <b style={{ color: '#f87171' }}>0</b> : 'kept'}</span>
                </label>
              ))}
            </div>
            {submitProg
              ? <div style={{ ...S.card, textAlign: 'center', fontWeight: 800 }}>Writing {submitProg.done}/{submitProg.total}…</div>
              : <button onClick={runSubmit} disabled={!plan.counted.length && !plan.zeroCandidates.some((z) => zeroChecked[z.product_id])} style={S.btn('#166534', !plan.counted.length && !plan.zeroCandidates.some((z) => zeroChecked[z.product_id]))}>
                  📊 Submit — set new inventory numbers
                </button>}
          </>}
        </div>
      )}

      {detail && (
        <div className="mc-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }} onClick={() => { setDetail(null); setEditLines(null); setSplitAssign(null); }}>
          <div className="mc-sheet" style={{ ...S.card, width: '100%', maxWidth: 560, margin: '0 auto', borderRadius: '14px 14px 0 0', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b style={{ fontFamily: 'monospace', fontSize: 18 }}>{detail.id}</b>
              <button onClick={() => { setDetail(null); setEditLines(null); setSplitAssign(null); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 10px' }}>{boxTitle(detail)} · {boxUnits(detail.contents)} units{detail.checked_in_at ? ' · checked in ' + fmtWhen(detail.checked_in_at) + (detail.checked_in_by ? ' by ' + detail.checked_in_by : '') : ' · NOT checked in'}</div>
            {editLines == null && splitAssign != null ? (() => {
              const contents = detail.contents || [];
              const targets = splitAssign;
              const maxT = targets.reduce((a, t) => Math.max(a, t), 0);
              const groups = splitGroups(contents, targets);
              const cycle = (i) => setSplitAssign(targets.map((t, j) => j === i ? (t >= Math.min(maxT + 1, contents.length - 1) ? 0 : t + 1) : t));
              const tColor = (t) => ['#334155', '#166534', '#7c3aed', '#b45309', '#0e7490', '#9d174d'][t % 6];
              return <>
                <div style={{ ...S.cap, marginTop: 4 }}>Split — tap a line to move it to the next box</div>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                  <button onClick={() => setSplitAssign(assignBySo(contents))} style={{ ...S.btn('#1e293b'), fontSize: 13, padding: '9px', border: '1px solid #334155' }}>By job / SO</button>
                  <button onClick={() => setSplitAssign(assignEachLine(contents))} style={{ ...S.btn('#1e293b'), fontSize: 13, padding: '9px', border: '1px solid #334155' }}>Each line</button>
                  <button onClick={() => setSplitAssign(contents.map(() => 0))} style={{ ...S.btn('#1e293b'), fontSize: 13, padding: '9px', border: '1px solid #334155' }}>Reset</button>
                </div>
                {contents.map((e, i) => (
                  <button key={i} onClick={() => cycle(i)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: '#0f172a', border: '1px solid ' + tColor(targets[i]), borderRadius: 8, padding: '9px 10px', marginBottom: 5, color: '#f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                    <span>{[(e.sku || '').trim(), e.name].filter(Boolean).join(' ')}{e.so_id ? ' · ' + e.so_id : ''} — {Object.entries(e.sizes || {}).map(([sz, v]) => sz + ':' + v).join(' ')}</span>
                    <b style={{ color: '#fff', background: tColor(targets[i]), borderRadius: 999, padding: '3px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>{targets[i] === 0 ? 'Keeps' : 'New ' + targets[i]}</b>
                  </button>
                ))}
                <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 8px' }}>{groups.keep.length} line{groups.keep.length === 1 ? '' : 's'} stay in {detail.id} · {groups.newBoxes.length} new box{groups.newBoxes.length === 1 ? '' : 'es'} (labels print automatically)</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <button onClick={() => runSplit(detail.id, targets)} disabled={splitBusy || !groups.newBoxes.length} style={{ ...S.btn('#166534', splitBusy || !groups.newBoxes.length), fontSize: 14, padding: '10px' }}>{splitBusy ? 'Splitting…' : '✂️ Split + print labels'}</button>
                  <button onClick={() => setSplitAssign(null)} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px' }}>Cancel</button>
                </div>
              </>;
            })() : editLines == null ? <>
              {(detail.contents || []).map((e, i) => (
                <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid #334155' }}>{[(e.sku || '').trim(), e.name].filter(Boolean).join(' ')} — {Object.entries(e.sizes || {}).map(([s, v]) => s + ':' + v).join(' ')}</div>
              ))}
              <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }}>
                <button onClick={() => { setEditLines(contentsToLines(detail.contents)); setEdQ(''); setEdResults([]); }} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px' }}>✏️ Edit contents</button>
                {(detail.contents || []).length > 1 && <button onClick={() => setSplitAssign(assignBySo(detail.contents))} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px' }}>✂️ Split box</button>}
              </div>
            </> : <>
              <div style={{ ...S.cap, marginTop: 4 }}>Edit contents — fix quantities, remove wrong lines, add missed SKUs</div>
              {editLines.map((l, li) => (
                <div key={li} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 8, margin: '6px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span><b style={{ fontFamily: 'monospace' }}>{l.sku || '(no SKU)'}</b>{l.name ? ' · ' + l.name : ''}{l.color ? ' · ' + l.color : ''}</span>
                    <button onClick={() => setEditLines((prev) => prev.filter((_, i) => i !== li))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 15 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {l.available_sizes.map((sz) => (
                      <label key={sz} style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>{sz}<br />
                        <input type="number" inputMode="numeric" min="0" value={l.sizes[sz] ?? ''} onChange={(e) => setEditLines((prev) => prev.map((x, i) => i === li ? { ...x, sizes: { ...x.sizes, [sz]: e.target.value } } : x))} style={{ ...S.input, width: 54, padding: '8px 4px', textAlign: 'center', fontSize: 15 }} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <input value={edQ} onChange={async (e) => { setEdQ(e.target.value); setEdResults(await productSearch(e.target.value)); }} placeholder="Add a SKU — type SKU or product name…" style={{ ...S.input, margin: '6px 0 4px', fontFamily: 'monospace' }} />
              {edResults.map((p) => (
                <button key={p.id} onClick={() => { setEditLines((prev) => prev.some((l) => l.product_id === p.id) ? prev : [...prev, productToLine(p)]); setEdQ(''); setEdResults([]); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', marginBottom: 3, fontSize: 13, cursor: 'pointer' }}>
                  <b style={{ fontFamily: 'monospace' }}>{p.sku}</b> — {p.name}{p.color ? ' · ' + p.color : ''}
                </button>
              ))}
              <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }}>
                <button onClick={async () => { const contents = linesToContents(editLines); if (await patchBox(detail.id, { contents })) { setDetail({ ...detail, contents }); setEditLines(null); fxOk(); } }} style={{ ...S.btn('#166534'), fontSize: 14, padding: '10px' }}>✓ Save contents</button>
                <button onClick={() => setEditLines(null)} style={{ ...S.btn('#334155'), fontSize: 14, padding: '10px' }}>Cancel</button>
              </div>
            </>}
            <div style={{ ...S.cap, marginTop: 12 }}>Location — now: <b style={{ color: STAGE_META[boxStage(detail)].color }}>{STAGE_META[boxStage(detail)].label}</b>{detail.bin ? ' ' + detail.bin : detail.staging_area ? ' ' + detail.staging_area : ''}</div>
            <input value={detail._shelf} onChange={(e) => setDetail({ ...detail, _shelf: e.target.value })} placeholder="A3 / STAGE 1" style={{ ...S.input, margin: '6px 0 8px', fontFamily: 'monospace' }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={async () => { const code = normShelf(detail._shelf); if (!code) return; if (await patchBox(detail.id, placePatch('staging', code))) { setDetail(null); fxOk(); } }} style={{ ...S.btn('#7c3aed'), fontSize: 14, padding: '10px' }}>📥 To staging</button>
              <button onClick={async () => { const code = normShelf(detail._shelf); if (!code) return; if (await patchBox(detail.id, placePatch('shelf', code))) { setDetail(null); fxOk(); } }} style={{ ...S.btn('#166534'), fontSize: 14, padding: '10px' }}>🗄️ To shelf</button>
              {(detail.bin || detail.staging_area) && <button onClick={async () => { if (await patchBox(detail.id, { bin: null, staging_area: null })) { setDetail(null); fxOk(); } }} style={{ ...S.btn('#334155'), width: 'auto', fontSize: 14, padding: '10px 12px' }}>Clear</button>}
            </div>
            <div style={{ ...S.cap, marginBottom: 6 }}>Counts toward new inventory?</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={async () => { if (await patchBox(detail.id, { assigned_to: 'inventory' })) setDetail({ ...detail, assigned_to: 'inventory' }); }} style={{ ...S.btn(detail.assigned_to === 'inventory' ? '#166534' : '#1e293b'), fontSize: 14, padding: '10px', border: detail.assigned_to === 'inventory' ? 'none' : '1px solid #334155' }}>Inventory — yes</button>
              <button onClick={async () => { if (await patchBox(detail.id, { assigned_to: null })) setDetail({ ...detail, assigned_to: null }); }} style={{ ...S.btn(detail.assigned_to !== 'inventory' ? '#334155' : '#1e293b'), fontSize: 14, padding: '10px', border: detail.assigned_to !== 'inventory' ? 'none' : '1px solid #334155' }}>{detail.so_id ? 'No — order goods' : 'No'}</button>
            </div>
            {!detail.checked_in_at && <button onClick={async () => { const b = boxes.find((x) => x.id === detail.id); if (b) await checkInBox(b); setDetail(null); }} style={{ ...S.btn('#166534'), marginBottom: 8 }}>✓ Check In Now</button>}
            <button onClick={() => printLegacyLabel(detail)} style={{ ...S.btn('#334155'), marginBottom: 8 }}>🖨️ Print 4×6 Label</button>
            {detail.checked_in_at && <button onClick={async () => { if (await patchBox(detail.id, { checked_in_at: null, checked_in_by: null })) setDetail(null); }} style={{ ...S.btn('#7f1d1d') }}>Undo check-in</button>}
          </div>
        </div>
      )}
    </div>
  );
}
