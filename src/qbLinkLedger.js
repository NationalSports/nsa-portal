// Verified links must outlive replacement of the shared qb_config blob.
// One row per realm/map/source, with compare-and-set updates and tombstones.
export const QB_LINK_MAPS = ['vendorQBMap', 'custQBMap', 'prodQBMap', 'qbSOMap', 'qbPOMap', 'qbPOBillMap', 'qbTaxRateMap', 'qbPaymentMap', 'qbInventoryValuationMap'];
const PREFIX = '_qb_link_v1_';
const clean = value => String(value == null ? '' : value).trim();
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

const realmKeyPrefix = realmId => PREFIX + encodeURIComponent(JSON.stringify([clean(realmId)]).slice(0, -1) + ',');

export function qbLinkKey(realmId, mapKey, sourceId) {
  if (!clean(realmId) || !QB_LINK_MAPS.includes(mapKey) || !clean(sourceId)) {
    throw new Error('QuickBooks link requires a realm, supported map, and source ID.');
  }
  return PREFIX + encodeURIComponent(JSON.stringify([clean(realmId), mapKey, clean(sourceId)]));
}

// Legacy callers may append the original log after its receipt added an ID.
// Collapse that pair while retaining separate, explicitly identified events.
export function mergeQBSyncLogs(entries = []) {
  const fingerprint = ({id, verified_at, ...event}) => {
    // A successful one-item legacy summary repeats the receipt's exact details.
    if (event.type === 'item_canary' && event.status === 'success'
      && /^1\/1 item canary(?: ·|$)/.test(event.details?.[0] || '')) {
      event = {...event, details:event.details.slice(1)};
    }
    return JSON.stringify(event);
  };
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
  // The customer batch requires proof that a term-update canary succeeded. That proof
  // used to be read from syncLog, which keeps only the newest 100 entries, so a control
  // that had genuinely been satisfied silently expired as unrelated activity pushed it
  // out. Receipts are permanent and one-per-link, so derive it from them instead.
  let termCanaryAt = clean(config.custTermCanaryVerifiedAt);
  // Same story for the product batch, which requires one proven link canary and one
  // proven creation canary. Reading those from syncLog alone means the control expires
  // on its own as unrelated events push them past the 100-entry limit.
  let itemLinkAt = clean(config.prodLinkCanaryVerifiedAt);
  let itemCreateAt = clean(config.prodCreateCanaryVerifiedAt);
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
    if (row.map_key === 'custQBMap' && row.active !== false && row.evidence?.result === 'updated'
      && clean(row.verified_at) > termCanaryAt) termCanaryAt = clean(row.verified_at);
    if (row.map_key === 'prodQBMap' && row.active !== false) {
      if (row.evidence?.result === 'linked' && clean(row.verified_at) > itemLinkAt) itemLinkAt = clean(row.verified_at);
      if (row.evidence?.result === 'created' && clean(row.verified_at) > itemCreateAt) itemCreateAt = clean(row.verified_at);
    }
  });
  result.syncLog = mergeQBSyncLogs([...logs.values()]);
  if (termCanaryAt) result.custTermCanaryVerifiedAt = termCanaryAt;
  if (itemLinkAt) result.prodLinkCanaryVerifiedAt = itemLinkAt;
  if (itemCreateAt) result.prodCreateCanaryVerifiedAt = itemCreateAt;
  return result;
}

// app_state also contains large operational blobs and thousands of product-image
// fallbacks. Loading every row in one request made the durable QBO receipts miss
// the generic query's deadline once the customer migration passed ~2,500 links.
// Read just this company's receipts in deterministic pages instead.
export async function loadDurableQBLinkReceipts(client, realmId, {sourceIds=[],pageSize=200, hardLimit=20000}={}) {
  const realm=clean(realmId);
  if(!client||!realm)throw new Error('Durable QuickBooks link load requires a database and realm.');
  const exactIds=[...new Set((sourceIds||[]).map(clean).filter(Boolean))]
    .map(sourceId=>qbLinkKey(realm,'custQBMap',sourceId));
  if(exactIds.length){
    if(exactIds.length>hardLimit)throw new Error('Durable QBO link load exceeded the safety limit.');
    const output={};
    for(let start=0;start<exactIds.length;start+=pageSize){
      const ids=exactIds.slice(start,start+pageSize);
      const page=await Promise.race([
        client.from('app_state').select('id,value').in('id',ids),
        new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'receipt page timed out'}}),20000)),
      ]);
      if(page.error)throw new Error('Durable QBO link load failed: '+page.error.message);
      (page.data||[]).forEach(row=>{if(ids.includes(row?.id)&&row.value!=null)output[row.id]=row.value});
    }
    return output;
  }
  const prefix=realmKeyPrefix(realm);
  const rows=[];
  for(let start=0;start<hardLimit;start+=pageSize){
    // The keys are URL-encoded and therefore contain literal "%" characters.
    // A LIKE filter interprets those as wildcards; a lexical prefix range does
    // not, and remains indexable on app_state.id.
    const query=client.from('app_state').select('id,value').gte('id',prefix).lt('id',prefix+'\uffff').order('id',{ascending:true}).range(start,start+pageSize-1);
    const page=await Promise.race([
      query,
      new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'receipt page timed out'}}),20000)),
    ]);
    if(page.error)throw new Error('Durable QBO link load failed: '+page.error.message);
    const batch=page.data||[];rows.push(...batch);
    if(batch.length<pageSize)break;
    if(start+pageSize>=hardLimit)throw new Error('Durable QBO link load exceeded the safety limit.');
  }
  const output={};
  rows.forEach(row=>{if(row?.id?.startsWith(prefix)&&row.value!=null)output[row.id]=row.value});
  return output;
}

// Call only after QBO read-back. A rejected/uncertain save never earns success.
// The final SELECT also detects RLS writes that silently affected zero rows.
export async function persistVerifiedQBLink(client, {realmId, mapKey, sourceIds, qboId, log, evidence = {}, active = true, expectedPreviousQboId = ''}) {
  if (!client) throw new Error('Durable QuickBooks link storage is unavailable.');
  if (!clean(qboId) || !Array.isArray(sourceIds) || !sourceIds.length) throw new Error('Verified QuickBooks and source IDs are required.');
  const repairing=!!clean(expectedPreviousQboId);
  if(repairing&&(mapKey!=='custQBMap'||sourceIds.length!==1||!active||clean(qboId)===clean(expectedPreviousQboId)||evidence.result!=='customer_link_repaired'||evidence.api_readback!==true||evidence.reviewer_approved!==true||clean(evidence.previous_qbo_id)!==clean(expectedPreviousQboId)))throw new Error('Invalid reviewed customer link repair.');
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
      if(repairing){
        if(existing.active===false||clean(existing.qbo_id)!==clean(expectedPreviousQboId))throw new Error('Reviewed customer link changed; reload and review again.');
        row.value=JSON.stringify({...parse(row.value),previous_link:existing});
      }
      if (!repairing && existing.active !== false && clean(existing.qbo_id) !== clean(qboId)) throw new Error('Conflicting durable QBO link; review the existing ID before changing it.');
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

// Recover a legacy customer map after the shared qb_config blob was replaced.
// This is deliberately narrower than persistVerifiedQBLink: callers must have
// just read every active QBO customer and proved a one-to-one exact match. The
// recovery writes Portal link receipts only; it never calls the QBO write API.
export async function persistVerifiedQBCustomerLinkRecovery(client, {realmId, reviewedAt, records}) {
  const realm = clean(realmId);
  const age = Date.now() - Date.parse(reviewedAt || '');
  if (!client) throw new Error('Durable QuickBooks link storage is unavailable.');
  if (!realm || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) {
    throw new Error('Customer-link recovery requires a fresh QBO review.');
  }
  if (!Array.isArray(records) || !records.length || records.length > 5000) {
    throw new Error('Customer-link recovery requires 1–5000 reviewed matches.');
  }
  const normalized = records.map(record => ({
    sourceId: clean(record?.sourceId),
    qboId: clean(record?.qboId),
    displayName: clean(record?.displayName),
    termId: clean(record?.termId),
  }));
  if (normalized.some(record => !record.sourceId || !/^\d+$/.test(record.qboId) || !record.displayName)) {
    throw new Error('Customer-link recovery contains an invalid reviewed match.');
  }
  if (new Set(normalized.map(record => record.sourceId)).size !== normalized.length
    || new Set(normalized.map(record => record.qboId)).size !== normalized.length) {
    throw new Error('Customer-link recovery is not one-to-one.');
  }

  const verifiedAt = new Date().toISOString();
  const rows = normalized.map(record => {
    const log = {
      id: 'qb-link-recovery-cust-' + encodeURIComponent(record.sourceId) + '-' + verifiedAt,
      verified_at: verifiedAt,
      ts: verifiedAt,
      type: 'customer_link_recovery',
      status: 'success',
      details: ['LINK RECOVERY ONLY — no QBO customer was changed', record.displayName + ' → QB #' + record.qboId],
    };
    return {
      id: qbLinkKey(realm, 'custQBMap', record.sourceId),
      value: JSON.stringify({
        realm_id: realm,
        map_key: 'custQBMap',
        source_id: record.sourceId,
        qbo_id: record.qboId,
        active: true,
        verified_at: verifiedAt,
        evidence: {
          result: 'linked',
          api_readback: true,
          duplicate_preflight: 'unique_exact_active_customer_match',
          reviewed_at: reviewedAt,
          display_name: record.displayName,
          term_id: record.termId || null,
        },
        log,
      }),
      updated_at: verifiedAt,
    };
  });
  const chunks = [];
  for (let index = 0; index < rows.length; index += 200) chunks.push(rows.slice(index, index + 200));

  // Inspect every existing receipt before writing any chunk, so one conflict
  // cannot leave a half-recovered map.
  for (const chunk of chunks) {
    const before = await client.from('app_state').select('id,value').in('id', chunk.map(row => row.id));
    if (before.error) throw new Error('Cannot read durable QBO links: ' + before.error.message);
    const byId = new Map((before.data || []).map(row => [row.id, row]));
    for (const row of chunk) {
      const existingRow = byId.get(row.id);
      if (!existingRow) continue;
      const existing = parse(existingRow.value);
      const proposed = parse(row.value);
      if (existing.active === false || clean(existing.qbo_id) !== clean(proposed.qbo_id)) {
        throw new Error('Conflicting durable QBO customer link; review ' + proposed.source_id + ' before recovery.');
      }
      // Preserve the earlier verified receipt when it already proves the same
      // active link; there is no reason to rewrite its evidence or timestamp.
      row.value = existingRow.value;
      row.updated_at = existingRow.updated_at || row.updated_at;
    }
  }

  for (const chunk of chunks) {
    const saved = await client.from('app_state').upsert(chunk, {onConflict:'id'});
    if (saved.error) throw new Error('Durable QBO link recovery failed: ' + saved.error.message);
  }

  const output = {};
  for (const chunk of chunks) {
    const after = await client.from('app_state').select('id,value').in('id', chunk.map(row => row.id));
    if (after.error) throw new Error('Cannot verify durable QBO link recovery: ' + after.error.message);
    const byId = new Map((after.data || []).map(row => [row.id, row]));
    for (const row of chunk) {
      const actual = byId.get(row.id);
      if (!actual || actual.value !== row.value) throw new Error('Durable QBO link recovery failed database read-back.');
      const verified = parse(actual.value);
      if (verified.active !== true || verified.realm_id !== realm || verified.map_key !== 'custQBMap') {
        throw new Error('Durable QBO customer link changed during recovery.');
      }
      output[row.id] = verified;
    }
  }
  return output;
}
