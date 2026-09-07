const normalizeOmgStoreCode = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const validateOmgStoreAssignment = ({ code, storeName, customerId, repId }) => {
  const normalizedCode = normalizeOmgStoreCode(code);
  if (!/^[A-Z0-9]{5}$/.test(normalizedCode)) return 'OMG store code must be exactly 5 letters or numbers.';
  if (!String(storeName || '').trim()) return 'Store name is required.';
  if (!customerId) return 'Customer is required.';
  if (!repId) return 'Sales rep is required.';
  return '';
};

const buildOmgStoreAssignment = ({ code, storeName, customerId, repId, existing = null, today }) => {
  const normalizedCode = normalizeOmgStoreCode(code);
  return {
    ...(existing || {}),
    id: existing?.id || `OMG-sale_${normalizedCode}`,
    _omg_sale_code: normalizedCode,
    store_name: String(storeName || '').trim(),
    customer_id: customerId,
    rep_id: repId,
    channel_type: '24/7',
    status: existing?.status || 'open',
    open_date: existing?.open_date || today || new Date().toISOString().slice(0, 10),
  };
};

export {
  normalizeOmgStoreCode,
  validateOmgStoreAssignment,
  buildOmgStoreAssignment,
};
