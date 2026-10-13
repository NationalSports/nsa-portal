// ─── Three-way merge for stale job / artwork rows ───
//
// so_jobs and so_art_files rows each carry their own _version (bumped by the DB on every write).
// A save whose copy of a row is behind the database ("stale") used to write the client's copy over
// the newer one, protected only by a few column-specific guards (coach decisions, art-status
// regression, receipts, append-only history, file unions). Any other column — a job's
// assigned_artist, art_requests, notes, an artwork's name or color ways — went back to whatever
// the stale copy held.
//
// That used to be rare: every artist save also bumped the order's own _version, so a stale editor
// was rejected outright. Once Art Dashboard saves stop moving the order's version (so they no
// longer block a rep's unrelated edit — SO-2444, 2026-10-12), stale rows reach the save path
// routinely, and they must be merged properly.
//
// The merge needs the row as this client last knew it (its "base"): a field the client left as it
// was in the base takes the database's (newer) value; a field the client changed keeps the
// client's value. The base is recorded per (row key, _version) whenever this client loads or
// writes a row. Bases are stored as per-field fingerprints, not objects — immune to later in-place
// mutation of the client's nested arrays, and tiny. File collections additionally keep their url
// keys so additions/removals can be told apart.
//
// No base (row never seen at that version by this client) → callers keep their previous behavior.

// Key-order-independent JSON; undefined object properties are skipped.
export function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => (v === undefined ? 'null' : stableStringify(v))).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// cyrb53: fast, well-distributed 53-bit string hash (public domain).
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// null and undefined are the same "no value" for merge purposes.
export const fingerprint = value => cyrb53(stableStringify(value === undefined ? null : value));

export const fileKey = f => (typeof f === 'string' ? f : (f && (f.url || f.name)) || '');

export function createRowBaseStore({ keepVersions = 4 } = {}) {
  const rows = new Map(); // rowKey -> Map(version -> snapshot)
  return {
    record(rowKey, version, snapshot) {
      if (!rowKey || version == null || !snapshot) return;
      const v = Number(version);
      if (!Number.isFinite(v)) return;
      let m = rows.get(rowKey);
      if (!m) { m = new Map(); rows.set(rowKey, m); }
      m.set(v, snapshot);
      while (m.size > keepVersions) m.delete(Math.min(...m.keys()));
    },
    has(rowKey, version) { return !!rows.get(rowKey)?.has(Number(version)); },
    get(rowKey, version) { return rows.get(rowKey)?.get(Number(version)) || null; },
    clear() { rows.clear(); },
    get size() { return rows.size; },
  };
}

// Snapshot of a row: a fingerprint per field, plus file url keys for listed collections and,
// for listed map collections, per-key file url keys (arrays) or fingerprints (scalars).
export function snapshotRow(row, { fields, fileCollections = [], mapCollections = [] } = {}) {
  const f = {};
  (fields || []).forEach(k => { f[k] = fingerprint(row ? row[k] : undefined); });
  const files = {};
  fileCollections.forEach(k => { files[k] = Array.isArray(row?.[k]) ? row[k].map(fileKey).filter(Boolean) : null; });
  const maps = {};
  mapCollections.forEach(k => {
    const o = row?.[k] && typeof row[k] === 'object' && !Array.isArray(row[k]) ? row[k] : {};
    maps[k] = {};
    Object.keys(o).forEach(kk => { maps[k][kk] = Array.isArray(o[kk]) ? o[kk].map(fileKey).filter(Boolean) : fingerprint(o[kk]); });
  });
  return { f, files, maps };
}

// Did the client change `field` since its base? With no base (or a field the base didn't cover),
// assume it did — callers then behave exactly as they did before bases existed.
export const changedSinceBase = (base, field, value) => !base || !Object.prototype.hasOwnProperty.call(base.f, field) || base.f[field] !== fingerprint(value);

// Items of `list` the client added since its base (by file key). Keyless items are kept.
export function addedSinceBase(list, baseKeys) {
  if (!Array.isArray(list)) return list;
  if (!Array.isArray(baseKeys)) return list;
  const known = new Set(baseKeys);
  return list.filter(x => { const k = fileKey(x); return !k || !known.has(k); });
}

// Job rows: start from the database copy and keep the client's value only for fields it changed.
// `id` and `so_id` are identity, never merged. Returns the row to write and the fields kept.
export function mergeStaleJobRow(clientRow, dbRow, base) {
  if (!base || !dbRow) return { row: clientRow, kept: null };
  const row = { ...clientRow };
  const kept = [];
  Object.keys(clientRow).forEach(k => {
    if (k === 'id' || k === 'so_id') return;
    if (!Object.prototype.hasOwnProperty.call(dbRow, k)) return;
    if (changedSinceBase(base, k, clientRow[k])) { kept.push(k); return; }
    row[k] = dbRow[k];
  });
  return { row, kept };
}
