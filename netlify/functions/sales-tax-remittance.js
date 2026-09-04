// Staff-readable, finance-writable append-only sales-tax filing ledger.
// All database access stays server-side because the public-schema table is
// service-role-only. Corrections insert reversals; no action updates or deletes.

const { corsHeaders, getSupabaseAdmin, verifyQBOUser, verifyUser } = require('./_shared');

const response = (statusCode, origin, payload) => ({
  statusCode,
  headers: corsHeaders(origin),
  body: JSON.stringify(payload),
});

const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const validDate = (value) => {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
};

async function financeUser(event) {
  const verified = await verifyQBOUser(event);
  return verified;
}

async function listAllEntries(admin) {
  const entries = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from('sales_tax_remittance_ledger')
      .select('*').order('recorded_at', { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    entries.push(...(data || []));
    if (!data || data.length < pageSize) return entries;
  }
}

const sameRecordRequest = (entry, row) => !!entry
  && entry.entry_type === 'remittance'
  && entry.source_type === row.source_type
  && entry.source_key === row.source_key
  && entry.store_name === row.store_name
  && entry.jurisdiction === row.jurisdiction
  && entry.filing_period_start === row.filing_period_start
  && entry.filing_period_end === row.filing_period_end
  && new Date(entry.cutoff_at).toISOString() === row.cutoff_at
  && Number(entry.amount_cents) === row.amount_cents
  && entry.payment_reference === row.payment_reference
  && (entry.notes || null) === row.notes;

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  if (event.httpMethod === 'OPTIONS') return response(200, origin, {});
  if (event.httpMethod !== 'POST') return response(405, origin, { error: 'POST only' });

  const verified = await verifyUser(event);
  if (!verified.ok) return response(verified.status, origin, { error: verified.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, origin, { error: 'Invalid JSON' }); }

  const action = body.action || 'list';
  const admin = getSupabaseAdmin();
  try {
    if (action === 'list') {
      const entries = await listAllEntries(admin);
      return response(200, origin, { entries });
    }

    const finance = await financeUser(event);
    if (!finance.ok) return response(finance.status, origin, { error: finance.error });

    if (action === 'record') {
      const sourceType = String(body.source_type || '');
      const sourceKey = String(body.source_key || '').trim();
      const storeName = String(body.store_name || '').trim();
      const jurisdiction = String(body.jurisdiction || '').trim().toUpperCase();
      const periodStart = String(body.filing_period_start || '');
      const periodEnd = String(body.filing_period_end || '');
      const cutoffAt = new Date(body.cutoff_at || '');
      const amountCents = Number(body.amount_cents);
      const paymentReference = String(body.payment_reference || '').trim();
      const notes = String(body.notes || '').trim();
      const idempotencyKey = String(body.idempotency_key || '');

      if (!['omg', 'webstore'].includes(sourceType)) return response(400, origin, { error: 'Valid source_type required' });
      if (!sourceKey || sourceKey.length > 200) return response(400, origin, { error: 'Valid source_key required' });
      if (!storeName || storeName.length > 200) return response(400, origin, { error: 'Valid store_name required' });
      if (!/^[A-Z]{2}$/.test(jurisdiction)) return response(400, origin, { error: 'Two-letter tax jurisdiction required' });
      if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) return response(400, origin, { error: 'Valid filing period required' });
      if (Number.isNaN(cutoffAt.getTime()) || cutoffAt.toISOString().slice(0, 10) < periodEnd) return response(400, origin, { error: 'Cutoff must include the filing period end' });
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return response(400, origin, { error: 'Positive integer amount_cents required' });
      if (!paymentReference || paymentReference.length > 160) return response(400, origin, { error: 'Payment or filing reference required' });
      if (notes.length > 1000) return response(400, origin, { error: 'Notes must be 1000 characters or fewer' });
      if (!validUuid(idempotencyKey)) return response(400, origin, { error: 'Valid idempotency_key required' });

      const row = {
        entry_type: 'remittance', source_type: sourceType, source_key: sourceKey,
        store_name: storeName, jurisdiction, filing_period_start: periodStart,
        filing_period_end: periodEnd, cutoff_at: cutoffAt.toISOString(),
        amount_cents: amountCents, payment_reference: paymentReference,
        notes: notes || null, recorded_by: finance.teamMemberId,
        idempotency_key: idempotencyKey,
      };
      const { data, error } = await admin.from('sales_tax_remittance_ledger').insert(row).select('*').single();
      if (error) {
        if (error.code === '23505') {
          const existing = await admin.from('sales_tax_remittance_ledger').select('*')
            .eq('idempotency_key', idempotencyKey).maybeSingle();
          if (existing.error) throw existing.error;
          if (sameRecordRequest(existing.data, row)) return response(200, origin, { entry: existing.data, replayed: true });
          return response(409, origin, { error: 'Idempotency key already belongs to a different filing request' });
        }
        throw error;
      }
      return response(200, origin, { entry: data, replayed: false });
    }

    if (action === 'reverse') {
      if (!validUuid(body.entry_id) || !validUuid(body.idempotency_key)) return response(400, origin, { error: 'Valid entry and idempotency IDs required' });
      const reason = String(body.reason || '').trim();
      if (!reason || reason.length > 1000) return response(400, origin, { error: 'Reversal reason required' });
      const originalResult = await admin.from('sales_tax_remittance_ledger').select('*').eq('id', body.entry_id).maybeSingle();
      if (originalResult.error) throw originalResult.error;
      const original = originalResult.data;
      if (!original || original.entry_type !== 'remittance') return response(404, origin, { error: 'Remittance entry not found' });
      const reversal = {
        entry_type: 'reversal', reversal_of: original.id,
        source_type: original.source_type, source_key: original.source_key,
        store_name: original.store_name, jurisdiction: original.jurisdiction,
        filing_period_start: original.filing_period_start,
        filing_period_end: original.filing_period_end, cutoff_at: original.cutoff_at,
        amount_cents: original.amount_cents,
        payment_reference: original.payment_reference,
        notes: reason, recorded_by: finance.teamMemberId,
        idempotency_key: String(body.idempotency_key),
        legacy_import: !!original.legacy_import,
      };
      const { data, error } = await admin.from('sales_tax_remittance_ledger').insert(reversal).select('*').single();
      if (error) {
        if (error.code === '23505') {
          const replay = await admin.from('sales_tax_remittance_ledger').select('*')
            .eq('idempotency_key', String(body.idempotency_key)).maybeSingle();
          if (replay.error) throw replay.error;
          if (replay.data?.entry_type === 'reversal' && replay.data.reversal_of === original.id) {
            return response(200, origin, { entry: replay.data, replayed: true });
          }
          return response(409, origin, { error: 'This remittance has already been reversed' });
        }
        throw error;
      }
      return response(200, origin, { entry: data, replayed: false });
    }

    return response(400, origin, { error: 'Unknown action: ' + action });
  } catch (error) {
    console.error('[sales-tax-remittance]', action, error.message);
    return response(500, origin, { error: 'Sales-tax ledger failed: ' + error.message });
  }
};

module.exports.validDate = validDate;
module.exports.validUuid = validUuid;
module.exports.listAllEntries = listAllEntries;
