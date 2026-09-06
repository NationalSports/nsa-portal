import { loadAllQBEntities } from './qbAccountMappings';

const clean = value => String(value || '').trim();
const nameKey = value => clean(value).replace(/\s+/g, ' ').toLowerCase();
// Broad comparison is used only to HOLD potential duplicates, never to link them.
const DECORATION_STOPWORDS = ['and','inc','incorporated','llc','ltd','int','international','printing','embroidery','screenprinting'];
const decorationNameKey = value => {
  const words = nameKey(value)
    .replace(/screenprinting/g, 'screen printing')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  const stripped = words.filter(word => !DECORATION_STOPWORDS.includes(word));
  // Stripping the trade words is what lets "Silver Screen" hold "Silver Screen
  // Printing, Inc.". But when it leaves a single word, that word is usually a place
  // or a family name -- "Pacific Embroidery" collapses to "pacific" -- and a bare
  // token like that prefix-matches every unrelated vendor starting with it. Keep the
  // full name in that case: it still matches its own longer forms, and it no longer
  // claims a different business. A name that was already one word is unaffected, so
  // "BYOG" still holds "BYOG Screenprinting".
  return (stripped.length > 1 ? stripped : words).join(' ');
};
export const VENDOR_SYNC_COLUMNS = 'id,name,vendor_type,is_active,contact_email,contact_phone';

// Preserve local purchasing settings and contacts. Only missing contacts are filled.
export function buildQBVendorReview(vendors, qboVendors, links = {}, realmId, decorationVendors = []) {
  if (!clean(realmId)) throw new Error('A connected QBO company is required.');
  const rows = qboVendors.map(q => {
    const qboId = clean(q.Id), name = clean(q.DisplayName || q.CompanyName);
    const row = { qboId, name, action: 'blocked', reason: '', patch: {} };
    if (!qboId || !name) return {...row, reason: 'Missing QBO ID or name'};
    if (q.Active === false) return {...row, action: 'skip', reason: 'Inactive in QBO'};
    const names = [q.DisplayName, q.CompanyName].map(nameKey).filter(Boolean);
    const linked = vendors.filter(v => clean(links[v.id]) === qboId);
    const matches = linked.length ? linked : vendors.filter(v => names.includes(nameKey(v.name)));
    if (matches.length > 1) return {...row, reason: 'Multiple Portal vendors match'};
    if (!linked.length && qboVendors.some(other => other !== q && other.Active !== false &&
      [other.DisplayName,other.CompanyName].map(nameKey).filter(Boolean).some(n => names.includes(n)))) {
      return {...row, reason:'Multiple QBO vendors share this name'};
    }
    const vendor = matches[0];
    const possibleDecorators = decorationVendors.filter(d => {
      const key = decorationNameKey(d.name);
      return key && [q.DisplayName,q.CompanyName].some(n => {
        const candidate = decorationNameKey(n);
        return candidate && (candidate === key || candidate.startsWith(key+' ') || key.startsWith(candidate+' '));
      });
    });
    if (possibleDecorators.length && !(possibleDecorators.length === 1 && vendor &&
      possibleDecorators[0].vendor_id === vendor.id && possibleDecorators[0].is_active !== false)) {
      return {...row, portalName:possibleDecorators.map(d=>d.name).join('; '),
        reason:'Possible decoration-vendor match: '+possibleDecorators.map(d=>d.name).join('; ')+'. Review the existing decoration vendor link before importing.'};
    }

    if (vendor && links[vendor.id] && clean(links[vendor.id]) !== qboId) return {...row, reason: 'Portal vendor is linked to another QBO vendor'};
    if (vendor?.is_active === false) return {...row, reason: 'Portal vendor is inactive'};
    const portalId = vendor?.id || 'qbo-' + encodeURIComponent(realmId) + '-' + encodeURIComponent(qboId);
    if (!vendor && vendors.some(v => v.id === portalId)) return {...row, reason: 'Imported vendor ID already exists with a different name'};
    const patch = {};
    if (!clean(vendor?.contact_email) && clean(q.PrimaryEmailAddr?.Address)) patch.contact_email = clean(q.PrimaryEmailAddr.Address);
    if (!clean(vendor?.contact_phone) && clean(q.PrimaryPhone?.FreeFormNumber)) patch.contact_phone = clean(q.PrimaryPhone.FreeFormNumber);
    return {...row, portalId, portalName: vendor?.name || name, before: vendor || null, patch,
      action: !vendor ? 'create' : !links[portalId] ? 'link' : Object.keys(patch).length ? 'update' : 'unchanged'};
  });
  // Two QBO identities must never claim the same Portal record in one review.
  for (const row of rows) {
    if (row.portalId && rows.filter(r => r.portalId === row.portalId).length > 1) {
      row.action = 'blocked'; row.reason = 'Multiple QBO vendors match this Portal vendor';
    }
  }
  return rows;
}

export async function loadQBVendorReview({client, qbApi, links, realmId}) {
  if (!client) throw new Error('Portal database unavailable.');
  const vendors = [];
  for (let start = 0; ; start += 500) {
    const res = await client.from('vendors').select(VENDOR_SYNC_COLUMNS).order('id').range(start, start + 499);
    if (res.error) throw new Error(res.error.message);
    vendors.push(...(res.data || []));
    if ((res.data || []).length < 500) break;
  }
  const decorators = [];
  for (let start = 0; ; start += 500) {
    const res = await client.from('deco_vendors').select('id,name,vendor_id,is_active').order('id').range(start,start+499);
    if (res.error) throw new Error('Decoration vendor review failed: '+res.error.message);
    decorators.push(...(res.data || []));
    if ((res.data || []).length < 500) break;
  }
  const qbo = await loadAllQBEntities(qbApi, 'Vendor', '*', 500);
  return buildQBVendorReview(vendors, qbo, links, realmId, decorators);
}

export async function applyQBVendorReview({client, qbApi, links, realmId, reviewed, persistQbLink, onSaved}) {
  const current = await loadQBVendorReview({client, qbApi, links, realmId});
  if (JSON.stringify(current) !== JSON.stringify(reviewed)) throw new Error('Vendors changed since review. Review again before importing.');
  const results = [];
  for (const row of current.filter(r => ['create','link','update'].includes(r.action))) {
    try {
      let write;
      if (row.action === 'create') {
        write = await client.from('vendors').upsert({id:row.portalId,name:row.name,vendor_type:'upload',is_active:true,...row.patch}, {onConflict:'id',ignoreDuplicates:true});
      } else if (Object.keys(row.patch).length) {
        let query = client.from('vendors').update(row.patch).eq('id',row.portalId).eq('name',row.before.name);
        for (const key of Object.keys(row.patch)) query = row.before[key] == null ? query.is(key,null) : query.eq(key,row.before[key]);
        write = await query;
      }
      if (write?.error) throw new Error(write.error.message);
      const saved = await client.from('vendors').select(VENDOR_SYNC_COLUMNS).eq('id',row.portalId).single();
      if (saved.error || !saved.data || saved.data.name !== row.portalName || saved.data.is_active === false
        || Object.entries(row.patch).some(([k,v]) => saved.data[k] !== v)) throw new Error('Portal vendor read-back did not match; reload and review.');
      await persistQbLink({mapKey:'vendorQBMap',sourceIds:[row.portalId],qboId:row.qboId,
        log:{type:'vendor_import',status:'success',ts:new Date().toISOString(),details:[row.name+' → Portal vendor '+row.portalId]},
        evidence:{direction:'qbo_to_portal',portal_readback:true,qbo_readback:true,name:row.name}});
      onSaved?.(saved.data);
      results.push({...row,status:'saved'});
    } catch (error) { results.push({...row,status:'error',reason:error.message}); }
  }
  return results;
}
