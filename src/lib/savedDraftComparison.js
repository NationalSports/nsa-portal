// Compare content, not JSON serialization or optimistic-lock bookkeeping.
// Never ignore arbitrary underscore-prefixed fields: shipping, costs and job
// progress also use those names and must remain part of the comparison.
const rootMetadata = new Set(['_editLease', '_version', '_obBaseVersion', '_retry', '_draftRecovery',
  'updated_at', 'created_at', '_itemsHydrated', '_decosHydrated', '_artHydrated',
  '_recoveryHydrated', '_jobsHydrated', '_posHydrated', '_picksHydrated', '_hydratedArtIds',
  '_hydratedPoIds', '_hydratedPickIds', '_reviewedSaveToken']);

// Only these known, nonpersisted item fields are omitted. Unknown fields and
// nested costs, shipping, quantities and decoration intent remain significant.
const itemDisplayFields = new Set(['_sizeCosts', '_sizeSells', '_colorImage', '_colorBackImage', '_ss_live']);
export function recoveryContent(payload) {
  if (!payload) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !rootMetadata.has(key)).map(([key, value]) => [key,
    key === 'items' && Array.isArray(value)
      ? value.map(item => Object.fromEntries(Object.entries(item).filter(([field]) => !itemDisplayFields.has(field))))
      : value]));
}

function equal(a, b, entityVersion = false) {
  if (a === b || (a == null && b == null)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, i) => equal(value, b[i]));
  }
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key =>
    (entityVersion && key === '_version') || equal(a[key], b[key]));
}

function sameEntities(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const byId = new Map(b.map(row => [row?.id, row]));
  if (byId.size !== b.length || byId.has(undefined) || new Set(a.map(row => row?.id)).size !== a.length) return false;
  return a.every(row => row?.id && byId.has(row.id) && equal(row, byId.get(row.id), true));
}

export function savedDocumentMatchesDraft(payload, row) {
  if (!payload?.id || payload.id !== row?.id) return false;
  // Incomplete child loads cannot establish that an edit is already saved.
  if (Object.keys(row).some(key => key.endsWith('Hydrated') && row[key] === false)) return false;
  payload = recoveryContent(payload);
  row = recoveryContent(row);
  return Object.keys(payload).every(key => {
    if (rootMetadata.has(key)) return true;
    if (key === 'jobs' || key === 'art_files') return sameEntities(payload[key], row[key]);
    return equal(payload[key], row[key]);
  });
}

// Called only with freshly loaded, complete cloud data. Compare every candidate
// synchronously before awaiting storage, so later UI mutations cannot become
// evidence of a successful cloud save. Acknowledge exact revisions only.
export async function reconcileSavedDocumentDrafts({owner, drafts, documents, table, journal, currentOwner}) {
  const required = {
    sales_orders: ['_recoveryHydrated', '_itemsHydrated', '_decosHydrated', '_artHydrated', '_jobsHydrated', '_posHydrated', '_picksHydrated'],
    estimates: ['_recoveryHydrated', '_itemsHydrated', '_decosHydrated', '_artHydrated'],
  }[table];
  if (!required || !owner || currentOwner() !== owner) return;
  const byId = new Map(documents.map(row => [row.id, row]));
  const receipts = drafts.filter(draft => {
    const row = byId.get(draft.id);
    return draft.owner === owner && draft.table === table && required.every(key => row?.[key] === true) && savedDocumentMatchesDraft(draft.payload, row);
  }).map(({key, owner: draftOwner, revision}) => ({key, owner: draftOwner, revision}));
  await Promise.all(receipts.map(receipt => currentOwner() === owner ? journal.acknowledge(receipt) : false));
}
