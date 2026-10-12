// ─── Clean-editor server adoption (stranded-version heal) ───
//
// The order editors keep their own working copy (`o`) and only field-merge external
// updates into it (job art status, art files, pick lines, PO lines). That merge never
// carried the server's `_version`, so once another session saved the order, an open
// editor kept claiming the OLD base version forever. save_sales_order_atomic rejects any
// write whose base is behind (STALE_SO_WRITE), so the very next edit in that tab failed —
// every time, even when the other session's change had nothing to do with it.
//
// SO-2444, 2026-10-12: tab open overnight at v126; an artist's seps upload re-saved the
// order to v132; the rep's "Move unfulfilled to another SKU" was rejected three times and
// the new line never reached the database.
//
// When the editor holds NO unsaved work there is nothing local to protect, so it should
// simply take the server copy — content and `_version` together. Anything unsaved (a dirty
// flag, a size cell still buffering keystrokes, a save in flight) keeps the existing field
// merge and leaves the save path's stale-content guards in charge.

const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

export function shouldAdoptServerCopy(local, server, { dirty, pendingSizing, saving } = {}) {
  if (!local || !server || dirty || pendingSizing || saving) return false;
  if (local.id !== server.id) return false;
  const sv = num(server._version);
  if (!Number.isFinite(sv)) return false;
  const lv = num(local._version);
  // A local copy that never read a version back (brand-new, unsaved) is not "behind".
  if (!Number.isFinite(lv)) return false;
  return sv > lv;
}

// Session-only bookkeeping that must survive the swap: deletion tombstones (so a stale
// read can't resurrect something this tab deliberately removed and already saved) and the
// hydrated-id sets the save path uses as its deletion guard (union, never shrink).
const UNION_KEYS = ['_hydratedPoIds', '_hydratedPickIds', '_hydratedArtIds'];

export function adoptServerCopy(local, server) {
  const next = { ...server };
  Object.keys(local || {}).forEach(k => {
    if (k.startsWith('_deleted') || k === '_decoDeleteIntents') next[k] = local[k];
  });
  UNION_KEYS.forEach(k => {
    const a = Array.isArray(local?.[k]) ? local[k] : [];
    const b = Array.isArray(server?.[k]) ? server[k] : [];
    if (a.length || b.length) next[k] = [...new Set([...a, ...b])];
  });
  return next;
}
