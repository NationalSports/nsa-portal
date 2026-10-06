export const ART_REQUEST_TYPES = { web_logo: 'CW web logo', vectorize: 'Vectorize logo', create_logo: 'Create logo' };
export const isOpenArtRequest = r => ['requested', 'in_progress'].includes(r.status);

export function filterArtRequests(rows, { cu, filter = 'all', search = '', reps = [], customers = [], orders = [] } = {}) {
  const artists = reps.filter(r => ['art', 'artist'].includes(r.role) && r.is_active !== false);
  return rows.map(r => ({ ...r,
    assigned_artist_name: reps.find(a => a.id === r.assigned_artist)?.name || r.assigned_artist,
    customer_name: customers.find(c => c.id === r.customer_id)?.name || r.customer_id,
    linked_so_id: r.so_id || orders.find(s => r.estimate_id && s.estimate_id === r.estimate_id)?.id,
  })).filter(r => {
    if (['art', 'artist'].includes(cu?.role)) {
      if (r.assigned_artist !== cu.id && artists.some(a => a.id === r.assigned_artist)) return false;
    } else if (filter !== 'all') {
      if (filter.startsWith('artist:')) { if (r.assigned_artist !== filter.slice(7)) return false; }
      else if (['rep', 'admin', 'super_admin'].includes(cu?.role)) { if (r.requested_by !== filter) return false; }
      else if ((r.assigned_artist || '') !== filter) return false;
    }
    return !search || [r.customer_name, r.art_name, r.estimate_id, r.linked_so_id, r.requested_by_name, ART_REQUEST_TYPES[r.request_type]]
      .filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase());
  });
}

export function validateArtRequest(r) {
  if (!r.customer_id) throw new Error('Choose a customer before requesting art.');
  if (!ART_REQUEST_TYPES[r.request_type]) throw new Error('Choose an art request type.');
  if (!String(r.art_name || '').trim()) throw new Error('Enter a logo name.');
  if (!String(r.instructions || '').trim()) throw new Error('Add instructions for the artist.');
  if (r.request_type !== 'create_logo' && !r.art_id) throw new Error('Choose an existing art folder for this request.');
  if (r.request_type === 'web_logo' && (r.source_art?.color_ways || []).length && !r.color_way_id) throw new Error('Choose the color way for this web logo.');
}

export function createArtService(supabase) {
  const ready = () => { if (!supabase) throw new Error('Connect to the portal before requesting art.'); };
  const result = async promise => {
    const { data, error } = await promise;
    if (error) throw new Error(error.message || 'Could not save art request.');
    if (data == null) throw new Error('The art request was not saved. Please retry.');
    return data;
  };
  const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('standalone-art-updated')); };
  return {
    async list({ customerId, estimateId, soId, artId } = {}) {
      ready();
      const rows = [];
      // Page through the queue; the PostgREST default row cap must not hide older work.
      const quoted = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      for (let offset = 0; ; offset += 500) {
        let query = supabase.from('standalone_art_requests').select('*').order('created_at', { ascending: false }).order('id');
        if (customerId) query = query.eq('customer_id', customerId);
        if (soId && estimateId) query = query.or(`so_id.eq.${quoted(soId)},estimate_id.eq.${quoted(estimateId)}`);
        else if (soId) query = query.eq('so_id', soId);
        else if (estimateId) query = query.eq('estimate_id', estimateId);
        if (artId) query = query.eq('art_id', artId);
        const page = await result(query.range(offset, offset + 499));
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
    async shareProof(id) {
      ready();
      const data = await result(supabase.rpc('share_standalone_art_proof', { p_id: id }));
      changed(); return data;
    },
    async syncConversion(estimateId, soId) {
      ready();
      return result(supabase.rpc('sync_standalone_art_conversion', { p_estimate_id: estimateId, p_so_id: soId }));
    },
    async create(payload) {
      ready(); validateArtRequest(payload);
      const data = await result(supabase.rpc('create_standalone_art_request', { p_request: payload }));
      changed(); return data;
    },
    async transition(id, status, files = []) {
      ready();
      const data = await result(supabase.rpc('transition_standalone_art_request', { p_id: id, p_status: status, p_files: files }));
      changed(); return data;
    },
  };
}
