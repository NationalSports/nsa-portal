// Keep the placeholder's id when a rep chooses existing art. Every decoration already
// assigned to the TBD group then continues to point at the replacement design.
export function replaceTbdArt(order, tbdId, source) {
  const current = (order.art_files || []).find(a => a.id === tbdId);
  if (!current || !source || !/^ART TBD\b/i.test(current.name || '')) return order;
  const replacement = JSON.parse(JSON.stringify(source));
  delete replacement._so_id;
  delete replacement._so_memo;
  delete replacement.so_id;
  delete replacement.estimate_id;
  delete replacement.customer_id;
  delete replacement._artEditedFields;
  delete replacement._artDeletes;
  replacement.id = tbdId;
  if (current._version != null) replacement._version = current._version;
  else delete replacement._version;
  replacement.uploaded = new Date().toLocaleDateString();
  replacement.mock_links = {};
  replacement.item_mockups = {};
  replacement.prod_files_attached = false;
  // The source order's garment mockups and approvals are not this order's mockups.
  replacement.mockup_files = [];
  replacement.files = (replacement.files || []).filter(f => {
    const url = typeof f === 'string' ? f : f?.url || '';
    return !/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(url);
  });
  const validCws = new Set((replacement.color_ways || []).map(cw => cw.id));
  return {
    ...order,
    art_files: order.art_files.map(a => a.id === tbdId ? replacement : a),
    items: (order.items || []).map(item => ({
      ...item,
      decorations: (item.decorations || []).map(d => d.art_file_id === tbdId ? {
        ...d,
        color_way_id: validCws.has(d.color_way_id) ? d.color_way_id : null,
        color_way_id_b: validCws.has(d.color_way_id_b) ? d.color_way_id_b : null,
        sell_override: null,
      } : d),
    })),
    jobs: (order.jobs || []).map(job => {
      const usesArt = job.art_file_id === tbdId || (job._art_ids || []).includes(tbdId);
      if (!usesArt) return job;
      return {
        ...job,
        art_name: replacement.name,
        art_status: ['approved', 'art_complete'].includes(replacement.status) ? 'waiting_approval' : 'needs_art',
        assigned_artist: '',
        sent_to_coach_at: null,
        follow_up_at: null,
        coach_approved_at: null,
        coach_rejected: false,
        _coach_cleared: true,
        art_requests: (job.art_requests || []).map(r =>
          ['requested', 'in_progress', 'completed', 'waiting_approval'].includes(r.status)
            ? { ...r, status: 'recalled' } : r),
      };
    }),
    updated_at: new Date().toLocaleString(),
  };
}

export function tbdArtName(currentName, label) {
  const base = (/^(ART TBD(?: \d+)?)/i.exec(currentName || '') || [,'ART TBD'])[1];
  const clean = String(label || '').trim();
  return clean ? base + ' — ' + clean : base;
}

export function tbdArtLabel(currentName) {
  return String(currentName || '').replace(/^ART TBD(?: \d+)?(?:\s*[—–-]\s*)?/i, '').trim();
}
