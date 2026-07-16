// Art identity + library pooling helpers.
//
// Cross-team contamination (e.g. football art landing on a volleyball SO / in that
// team's art folder) has repeatedly come from name-only matching that lets a
// parent-library or sibling-sport record replace the team's own art. Keep the
// rules here so Webstores / OrderEditor / CustDetail / OMG can't drift.

/** Stable logo key: name + deco_type. Empty name falls back to id so blanks don't collapse. */
export function artLogoKey(a) {
  if (!a) return '';
  const nm = String(a.name || '').trim().toLowerCase();
  if (nm) return nm + '||' + (a.deco_type || '');
  return '__id__' + (a.id || '');
}

/** Name-only key used by legacy webstore dedupe — prefer artLogoKey for new code. */
export function artNameKey(a) {
  if (!a) return '';
  return String(a.name || a.id || '').trim().toLowerCase();
}

/**
 * Dedup key for the Previous Artwork picker (OrderEditor).
 *
 * Keys on the stable logo identity — name + deco_type — plus art_size and
 * color-way count as picker-level discriminators between real variants. It must
 * NOT include the id: promoteArtToLibrary mints a fresh `caf…` id for the library
 * copy, so a design's library record and its source-order record carry different
 * ids. Keying on id split one design into two cards ("Library — …" and "SO-… — …")
 * and the picker's own cross-source file merge could never fire. Blank-named rows
 * fall back to id so distinct untitled art doesn't collapse (mirrors artLogoKey).
 */
export function prevArtDedupKey(a) {
  if (!a) return '';
  const nm = String(a.name || '').trim().toLowerCase();
  const base = (a.deco_type || '') + '|' + (a.art_size || '') + '|' + ((a.color_ways || []).length);
  return (nm ? nm : '__id__' + (a.id || '')) + '|' + base;
}

/**
 * Build a team's usable art library from team + parent + order/estimate sources.
 *
 * Invariant: a parent-library record must NEVER replace a team-owned record that
 * shares the same name. Name collisions keep the team copy; the parent copy is
 * only added when the team has no entry under that name (and still only when the
 * ids differ — two distinct designs with the same label stay separate by id).
 *
 * `parentOrderArt` (art off the PARENT program's own orders/estimates, shaped like
 * `orderArt`) cascades down to the child the same way `parentArt` does — parent-level,
 * gap-fill only — so a logo the program set up on its own order is reusable by its teams.
 *
 * Returns records tagged with `_srcLabel` / `_srcCustId`.
 */
export function buildTeamArtLibrary({ teamArt = [], parentArt = [], parentOrderArt = [], orderArt = [], teamId, parentId, parentLabel } = {}) {
  const byId = new Map();
  const byName = new Map(); // nameKey -> id of preferred record
  const acc = [];

  const add = (a, label, srcCustId, { isParent = false } = {}) => {
    if (!a || !a.id || a.archived) return;
    const rec = { ...a, _srcLabel: label, _srcCustId: srcCustId };
    if (byId.has(a.id)) {
      // Same id seen again (order copy of a library row) — keep the first, but
      // prefer a copy that actually has a preview image.
      const idx = byId.get(a.id);
      if (_hasImg(a) && !_hasImg(acc[idx])) acc[idx] = rec;
      return;
    }
    const nk = artNameKey(a);
    if (nk && byName.has(nk)) {
      const existingId = byName.get(nk);
      const existingIdx = byId.get(existingId);
      const existing = existingIdx != null ? acc[existingIdx] : null;
      // Parent must not clobber a team-owned row of the same name.
      if (isParent && existing && existing._srcCustId && existing._srcCustId !== parentId) return;
      // Prefer the copy with a real image; never swap a team id for a parent id.
      if (existing && isParent) return;
      if (existing && _hasImg(a) && !_hasImg(existing)) {
        acc[existingIdx] = rec;
        byId.delete(existingId);
        byId.set(a.id, existingIdx);
        byName.set(nk, a.id);
        return;
      }
      // Same name AND same method under a different id is the SAME design reached
      // twice: a library copy promoted via promoteArtToLibrary gets a fresh `caf…`
      // id, so its source-order copy would otherwise list twice (the reported
      // duplication). Collapse it into the existing card, preferring whichever copy
      // has a real image. Scan acc directly (not just the name-keyed record) so a
      // same-name / different-method design already kept apart can't hide the match.
      // A record with a DIFFERENT deco_type is a distinct design and still kept.
      if (!isParent) {
        const lk = artLogoKey(a);
        const twinIdx = acc.findIndex((r) => artLogoKey(r) === lk);
        if (twinIdx !== -1) {
          if (_hasImg(a) && !_hasImg(acc[twinIdx])) {
            byId.delete(acc[twinIdx].id);
            acc[twinIdx] = rec;
            byId.set(a.id, twinIdx);
          }
          return;
        }
      }
      // Distinct design (same name, different method) — keep both (id-keyed).
    }
    byId.set(a.id, acc.length);
    if (nk && !byName.has(nk)) byName.set(nk, a.id);
    acc.push(rec);
  };

  (teamArt || []).forEach((a) => add(a, 'Team library', teamId));
  (orderArt || []).forEach(({ art, label, srcCustId }) => add(art, label, srcCustId || teamId));
  // Parent sources last so name collisions cannot overwrite team rows. Curated parent
  // library entries before the parent's own order art, so a promoted parent copy wins
  // over its raw order copy of the same logo. Both fill gaps only (isParent).
  (parentArt || []).forEach((a) => add(a, parentLabel || 'Parent library', parentId, { isParent: true }));
  (parentOrderArt || []).forEach(({ art, label, srcCustId }) => add(art, label || parentLabel || 'Parent library', srcCustId || parentId, { isParent: true }));

  return acc;
}

function _hasImg(a) {
  if (!a) return false;
  const u = a.preview_url || a.web_logo_url
    || (Array.isArray(a.web_logos) && a.web_logos.find((w) => w && w.url)?.url)
    || (Array.isArray(a.mockup_files) && (typeof a.mockup_files[0] === 'string' ? a.mockup_files[0] : a.mockup_files[0]?.url))
    || (Array.isArray(a.files) && (typeof a.files[0] === 'string' ? a.files[0] : a.files[0]?.url));
  return !!(u && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(String(u)));
}

/**
 * Resolve a prior-order art row onto the CURRENT order's name||deco_type key.
 * M10: name fallback REQUIRES deco_type equality — bare name must not cross methods.
 * design_id match still wins when present on both sides.
 */
export function resolvePriorMockKey(row, { keyByDesign = {}, keyByNameDeco = {} } = {}) {
  if (!row) return null;
  if (row.design_id && keyByDesign[row.design_id]) return keyByDesign[row.design_id];
  const nm = String(row.name || '').trim().toLowerCase();
  if (!nm) return null;
  const k = nm + '||' + (row.deco_type || '');
  return keyByNameDeco[k] || null;
}

/**
 * M14 auto-wire targets for a reused art clone.
 *
 * Conservative: never point EVERY empty art decoration at the reused design.
 * Empty slots only match when the decoration's deco_type/type agrees with the
 * clone (or the deco has no type AND it's the sole empty art deco on the order).
 * ART TBD / empty-placeholder matches keep the existing design_id / name+deco rules.
 *
 * `items` is [{ decorations: [...] }, ...]; `existingArt` is the order's art_files
 * BEFORE the clone was appended; `clone` is the reused art record.
 * Returns [{ ii, di }].
 */
export function prevArtAutoWireTargets(items, existingArt, clone) {
  const _cd = (clone && clone.deco_type) || '';
  const _nmKey = String((clone && clone.name) || '').trim().toLowerCase();
  const af = Array.isArray(existingArt) ? existingArt : [];
  const emptySlots = [];
  const typed = [];

  (items || []).forEach((it, ii) => {
    (it?.decorations || []).forEach((d, di) => {
      if (!d || d.kind !== 'art') return;
      if (!d.art_file_id) {
        emptySlots.push({ ii, di, decoType: d.deco_type || d.type || '' });
        return;
      }
      if (d.art_file_id === '__tbd') {
        if ((d.art_tbd_type || '') === _cd) typed.push({ ii, di });
        return;
      }
      const cur = af.find((a) => a.id === d.art_file_id);
      const match = !!cur && (cur.deco_type || '') === _cd
        && ((clone?.design_id && cur.design_id === clone.design_id)
          || (!!_nmKey && String(cur.name || '').trim().toLowerCase() === _nmKey))
        && (!cur.status || cur.status === 'waiting_for_art');
      if (match) typed.push({ ii, di });
    });
  });

  const fromEmpty = emptySlots.filter((s) => {
    if (s.decoType) return s.decoType === _cd;
    // Untyped empty slot: only auto-wire when it's unambiguous (exactly one empty
    // art deco on the whole order). Multi-logo orders must be wired by hand.
    return emptySlots.length === 1;
  }).map(({ ii, di }) => ({ ii, di }));

  return [...fromEmpty, ...typed];
}

/**
 * Should a CustDetail name-scoped write touch this SO art row?
 * Same art id always matches; name+deco only when the SO belongs to the art's
 * source customer (or the art has no source — legacy). Prevents a parent-view
 * edit of "Front Logo" from rewriting a sibling sport's identically-named art.
 */
export function artWriteMatches(artRow, { artId, name, decoType, soCustomerId, srcCustId } = {}) {
  if (!artRow) return false;
  if (artId && artRow.id === artId) return true;
  const nm = String(name || '').trim().toLowerCase();
  if (!nm) return false;
  if (String(artRow.name || '').trim().toLowerCase() !== nm) return false;
  if ((artRow.deco_type || '') !== (decoType || '')) return false;
  if (srcCustId && soCustomerId && srcCustId !== soCustomerId) return false;
  return true;
}
