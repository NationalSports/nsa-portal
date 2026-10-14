// Permanent Art IDs (ART-000123 / ART-000123-V01-R01) are assigned by the database
// (supabase/migrations/20261014160000_permanent_art_ids.sql). This file only reads
// and formats them; it never invents a number.
import { useEffect, useState } from 'react';

export function formatArtCode(number, variant, revision) {
  if (!Number.isFinite(Number(number))) return '';
  const pad = (n, w) => String(n).padStart(w, '0');
  return 'ART-' + pad(number, 6) + (variant ? '-V' + pad(variant, 2) : '') + (revision ? '-R' + pad(revision, 2) : '');
}

const EMPTY = { master: () => '', version: () => '' };

// Lookups for one or more art folders. Failure (e.g. migration not yet applied)
// returns empty lookups so screens simply show no ID.
export async function loadArtCodes(supabase, customerIds) {
  const ids = [...new Set((customerIds || []).filter(Boolean))];
  if (!supabase || !ids.length) return EMPTY;
  const masters = await supabase.from('art_ids').select('art_number,customer_id,art_id').in('customer_id', ids);
  if (masters.error || !Array.isArray(masters.data)) return EMPTY;
  const byArt = new Map(masters.data.map(r => [r.customer_id + '|' + r.art_id, Number(r.art_number)]));
  const numbers = [...new Set(masters.data.map(r => r.art_number))];
  const versions = numbers.length ? await supabase.from('art_id_versions').select('art_number,variant_no,revision_no,revision_key').in('art_number', numbers) : { data: [] };
  const byRevision = new Map((versions.error ? [] : versions.data || []).map(r => [r.art_number + '|' + r.revision_key, formatArtCode(r.art_number, r.variant_no, r.revision_no)]));
  return {
    master: (customerId, artId) => formatArtCode(byArt.get(customerId + '|' + artId)),
    version: (customerId, artId, revisionKey) => {
      const n = byArt.get(customerId + '|' + artId);
      return n == null ? '' : byRevision.get(n + '|' + revisionKey) || '';
    },
  };
}

export function useArtCodes(supabase, customerIds, reloadKey) {
  const [codes, setCodes] = useState(EMPTY);
  const key = [...new Set((customerIds || []).filter(Boolean))].sort().join(',');
  useEffect(() => {
    let live = true;
    loadArtCodes(supabase, key ? key.split(',') : []).then(c => { if (live) setCodes(c); }).catch(() => { if (live) setCodes(EMPTY); });
    return () => { live = false; };
  }, [supabase, key, reloadKey]);
  return codes;
}
