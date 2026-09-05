// Verified links must outlive replacement of the shared qb_config blob.
// One row per realm/map/source, with compare-and-set updates and tombstones.
export const QB_LINK_MAPS = ['custQBMap', 'prodQBMap', 'qbSOMap', 'qbPOMap'];
const PREFIX = '_qb_link_v1_';
const clean = value => String(value == null ? '' : value).trim();
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

export function qbLinkKey(realmId, mapKey, sourceId) {
  if (!clean(realmId) || !QB_LINK_MAPS.includes(mapKey) || !clean(sourceId)) {
    throw new Error('QuickBooks link requires a realm, supported map, and source ID.');
  }
  return PREFIX + encodeURIComponent(JSON.stringify([clean(realmId), mapKey, clean(sourceId)]));
}

// Legacy callers may append the original log after its receipt added an ID.
// Collapse that pair while retaining separate, explicitly identified events.
export function mergeQBSyncLogs(entries = []) {
  const fingerprint = ({id, verified_at, ...event}) => JSON.stringify(event);
  const identified = new Map();
  entries.filter(log => log.id).forEach(log => identified.set(log.id, log));
  const fingerprints = new Set([...identified.values()].map(fingerprint));
  const legacy = new Map();
  entries.filter(log => !log.id).forEach(log => {
    const key = fingerprint(log);
    if (!fingerprints.has(key)) legacy.set(key, log);
  });
  return [...identified.values(), ...legacy.values()].sort((a,b) =>
    (Date.parse(b.verified_at || b.ts) || 0) - (Date.parse(a.verified_at || a.ts) || 0)
  ).slice(0,100);
}

export function mergeDurableQBLinks(config = {}, appState = {}) {
  const result = {...config};
  QB_LINK_MAPS.forEach(key => { result[key] = {...(config[key] || {})}; });
  const logs = new Map();
  (config.syncLog || []).forEach(log => logs.set(log.id || JSON.stringify(log), log));
  Object.entries(appState).forEach(([key, raw]) => {
    if (!key.startsWith(PREFIX)) return;
    let row;
    try { row = parse(raw); } catch { return; }
    if (!row || clean(row.realm_id) !== clean(config.realm_id) || !QB_LINK_MAPS.includes(row.map_key)
      || !row.source_id || !row.qbo_id || !row.verified_at) return;
    if (key !== qbLinkKey(row.realm_id, row.map_key, row.source_id)) return;
    if (row.active === false) delete result[row.map_key][row.source_id];
    else result[row.map_key][row.source_id] = row.qbo_id;
    if (row.log?.id) logs.set(row.log.id, row.log);
  });
  result.syncLog = mergeQBSyncLogs([...logs.values()]);
  return result;
}

// Call only after QBO read-back. A rejected/uncertain save never earns success.
// The final SELECT also detects RLS writes that silently affected zero rows.
export async function persistVerifiedQBLink(client, {realmId, mapKey, sourceIds, qboId, log, evidence = {}, active = true}) {
  if (!client) throw new Error('Durable QuickBooks link storage is unavailable.');
  if (!clean(qboId) || !Array.isArray(sourceIds) || !sourceIds.length) throw new Error('Verified QuickBooks and source IDs are required.');
  const verifiedAt = new Date().toISOString();
  const savedLog = {...log, id: log?.id || 'qb-link-' + mapKey + '-' + clean(qboId) + '-' + verifiedAt,
    verified_at: verifiedAt};
  const rows = [...new Set(sourceIds.map(clean))].map(sourceId => ({
    id: qbLinkKey(realmId, mapKey, sourceId),
    value: JSON.stringify({realm_id:clean(realmId), map_key:mapKey, source_id:sourceId,
      qbo_id:clean(qboId), active, verified_at:verifiedAt, evidence, log:savedLog}),
    updated_at: verifiedAt,
  }));
  const output = {};
  for (const row of rows) {
    const before = await client.from('app_state').select('id,value').eq('id',row.id).maybeSingle();
    if (before.error) throw new Error('Cannot read durable QBO link: ' + before.error.message);
    if (before.data) {
      const existing = parse(before.data.value);
      if (existing.active !== false && clean(existing.qbo_id) !== clean(qboId)) throw new Error('Conflicting durable QBO link; review the existing ID before changing it.');
      if (existing.active === false && active && clean(existing.qbo_id) === clean(qboId)) throw new Error('This QBO link was explicitly removed; it cannot be restored by a stale retry.');
      const update = await client.from('app_state').update(row).eq('id',row.id).eq('value',before.data.value);
      if (update.error) throw new Error('Durable QBO link save failed: ' + update.error.message);
    } else {
      // A read-back-verified cleanup can tombstone a legacy in-blob link too.
      const insert = await client.from('app_state').upsert(row,{onConflict:'id',ignoreDuplicates:true});
      if (insert.error) throw new Error('Durable QBO link save failed: ' + insert.error.message);
    }
    const after = await client.from('app_state').select('id,value').eq('id',row.id).maybeSingle();
    if (after.error || !after.data) throw new Error('Durable QBO link was not returned by database read-back.');
    if (after.data.value !== row.value) throw new Error('Durable QBO link save lost a concurrent update; reload and review.');
    const verified = parse(after.data.value);
    if (clean(verified.qbo_id) !== clean(qboId) || verified.active !== active
      || verified.realm_id !== clean(realmId) || verified.map_key !== mapKey) {
      throw new Error('Durable QBO link changed concurrently; reload and review before continuing.');
    }
    output[row.id] = verified;
  }
  return output;
}
