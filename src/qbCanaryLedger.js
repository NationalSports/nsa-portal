const clean = value => String(value == null ? '' : value).trim();

export function qbCanaryLedgerKey(realmId, qboBillId) {
  const realm = clean(realmId).replace(/[^A-Za-z0-9_-]/g, '_');
  const bill = clean(qboBillId).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!realm || !bill) throw new Error('QuickBooks realm and bill ID are required for canary verification.');
  return `_qb_canary_bill_${realm}_${bill}`;
}

export function qbCanaryLedgerRecord({ realmId, qboBillId, sourceId, docNumber, verifiedAt }) {
  const realm = clean(realmId);
  const bill = clean(qboBillId);
  return {
    id: qbCanaryLedgerKey(realm, bill),
    value: JSON.stringify({
      realm_id: realm,
      qbo_bill_id: bill,
      source_id: clean(sourceId),
      doc_number: clean(docNumber),
      verified_at: verifiedAt || new Date().toISOString(),
    }),
    updated_at: verifiedAt || new Date().toISOString(),
  };
}

export function durableQbCanaryBillIds(appState, realmId) {
  const realm = clean(realmId);
  const ids = [];
  Object.entries(appState || {}).forEach(([key, value]) => {
    if (!key.startsWith('_qb_canary_bill_') || !value || clean(value.realm_id) !== realm) return;
    const id = clean(value.qbo_bill_id);
    if (id && value.verified_at) ids.push(id);
  });
  return [...new Set(ids)];
}

export function mergeDurableQbCanaries(qbConfig, appState) {
  const config = qbConfig || {};
  const ids = new Set((config._qbCanaryBillIds || []).map(clean).filter(Boolean));
  durableQbCanaryBillIds(appState, config.realm_id).forEach(id => ids.add(id));
  return { ...config, _qbCanaryBillIds: [...ids] };
}
