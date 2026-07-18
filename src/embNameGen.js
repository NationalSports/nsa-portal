/* eslint-disable */
// Embroidery name/number auto-generation — the deterministic core.
//
// Turns a job's names/numbers decorations into an ORDERED list of per-piece
// stitch files to generate (one DST per name, one per number), named in sew
// order and grouped by size, plus a fingerprint for change detection. This is
// the pure brain that the (CI-side) Ink/Stitch generator consumes and that the
// manifest/Pi pipeline then delivers to the machine.
//
// It does NOT run Ink/Stitch or touch the network — it only decides WHAT to
// make and WHAT to call each file. Kept pure so it's fully unit-testable.
//
// Data shapes (from OrderEditor addNameDeco / addNumDeco):
//   names deco:   { kind:'names',   name_method, names:{ [size]: ["First Last", ...] } }
//   numbers deco: { kind:'numbers', num_method,  num_size:'1"', num_font:'block'|'serif',
//                                    roster:{ [size]: ["12", ...] } }
// Only *embroidery*-method decos are generated here (heat-press / screen-print
// names & numbers are produced differently and are out of scope).
//
// KNOWN MODEL GAP: numbers carry an explicit size (num_size) and font (num_font),
// but NAMES carry neither today. Until a name_size/name_font is added to the deco,
// name pieces fall back to the configurable defaults below. Numbers use their own
// stored size; font falls back to 'block' (the number-font field is only exposed
// for screen-print in the editor, so embroidery numbers usually leave it unset).

import { SZ_ORD } from './constants';

const _isEmbName = (d) => d && d.kind === 'names' && (d.name_method || '') === 'embroidery';
const _isEmbNum = (d) => d && d.kind === 'numbers' && (d.num_method || '') === 'embroidery';

// Canonical sew order = SZ_ORD; unknown sizes sort last but stay deterministic (by name).
const _szRank = (sz) => { const i = SZ_ORD.indexOf(sz); return i === -1 ? 1e6 : i; };
const _szSort = (a, b) => (_szRank(a) - _szRank(b)) || (a < b ? -1 : a > b ? 1 : 0);

// CODE39-safe identity token: accents stripped (José → JOSE, not JOS), uppercased; A–Z 0–9
// kept, every run of anything else becomes a single dash; trimmed; length-capped. (Barudan
// barcodes are CODE39 — uppercase/digits/dash only, no underscore — so these stay scannable
// if barcoded.)
const _tok = (s, cap = 16) =>
  String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, cap);

// First numeric value in a size string like '1.5"' → 1.5 (inches); null if none.
const _inches = (v) => { const m = String(v == null ? '' : v).match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; };

// Stable non-crypto hash (djb2) — only used to detect roster/font/size changes.
const _hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };

// filename: 3-digit sew sequence + size + kind + identity, e.g. 001-L-NAME-SMITH,
// 002-L-NUM-12. The leading sequence IS the sew order, so an alphabetical file
// list on the machine equals the run order.
const _fname = (seq, sz, kindTag, ident) =>
  `${String(seq).padStart(3, '0')}-${_tok(sz, 8)}-${kindTag}-${ident}`;

// Are there any embroidery name/number pieces to generate on these decos?
// (Cheap gate for the sweep that decides which jobs need generation. Uses the same
// _KINDS table as buildEmbNameGen so "needed" can never disagree with what generates.)
const _hasFilled = (rosterMap) =>
  Object.values(rosterMap || {}).some((a) => (a || []).some((v) => String(v == null ? '' : v).trim()));
export const embNameGenNeeded = (decos) =>
  (decos || []).some((d) => _KINDS.some((cfg) => cfg.isMine(d) && _hasFilled(cfg.rosterOf(d))));

// The two roster-bearing deco kinds, table-driven so names and numbers can never
// drift apart in traversal/validation behavior (they differ only in these fields).
const _KINDS = [
  { kind: 'name', tag: 'NAME', isMine: _isEmbName, rosterOf: (d) => d.names, fontOf: (d) => d.name_font, sizeOf: (d) => d.name_size },
  { kind: 'number', tag: 'NUM', isMine: _isEmbNum, rosterOf: (d) => d.roster, fontOf: (d) => d.num_font, sizeOf: (d) => d.num_size },
];

// Build the ordered per-piece generation plan for ONE job's decorations.
//
// Ordering: by size (SZ_ORD), then within a size all NAMES (in deco+slot order)
// followed by all NUMBERS — one machine setup per kind, roster sheet already lists
// per size. Empty roster slots are skipped (a slot with no name/number = no piece).
//
// Returns { pieces, fingerprint, warnings }:
//   pieces[]:    { seq, size, slot, kind:'name'|'number', text, font, heightIn,
//                  filename, fontDefaulted?, heightDefaulted? }
//                (slot = roster array index — provenance for re-matching a piece to its
//                roster row later; not consumed by the generator)
//   fingerprint: stable hash of the plan; regenerate when it changes
//   warnings[]:  human-readable notes (unknown size, defaulted font/height, …).
//                Defaulted font/height are ALSO flagged per-piece so the distinction
//                between "chosen" and "fell back" survives into the CI manifest —
//                otherwise adding a second font later would silently leave names on
//                the old default with no signal until finished garments come back.
export const buildEmbNameGen = (decos, opts = {}) => {
  const defaultFont = opts.defaultFont || 'block';
  const defaultHeightIn = opts.defaultHeightIn != null ? opts.defaultHeightIn : 1;

  const kindDecos = _KINDS.map((cfg) => ({ cfg, decos: (decos || []).filter(cfg.isMine) }));
  const sizes = [...new Set(
    kindDecos.flatMap(({ cfg, decos: ds }) => ds.flatMap((d) => Object.keys(cfg.rosterOf(d) || {}))),
  )].sort(_szSort);

  const pieces = [];
  const warnings = [];
  let seq = 0;

  for (const sz of sizes) {
    if (_szRank(sz) === 1e6) warnings.push(`Unknown size "${sz}" — sewn last`);
    for (const { cfg, decos: ds } of kindDecos) {
      for (const d of ds) {
        ((cfg.rosterOf(d) || {})[sz] || []).forEach((raw, slot) => {
          const text = String(raw == null ? '' : raw).trim();
          if (!text) return;
          seq += 1;
          const fontDefaulted = !cfg.fontOf(d);
          const heightDefaulted = !_inches(cfg.sizeOf(d));
          const piece = {
            seq, size: sz, slot, kind: cfg.kind, text,
            font: cfg.fontOf(d) || defaultFont,
            heightIn: _inches(cfg.sizeOf(d)) || defaultHeightIn,
            filename: _fname(seq, sz, cfg.tag, _tok(text)),
          };
          if (fontDefaulted) piece.fontDefaulted = true;
          if (heightDefaulted) piece.heightDefaulted = true;
          pieces.push(piece);
        });
      }
    }
  }

  const defFont = pieces.filter((p) => p.fontDefaulted).length;
  const defHeight = pieces.filter((p) => p.heightDefaulted).length;
  if (defFont) warnings.push(`${defFont} piece(s) have no font on the deco — defaulted to "${defaultFont}"`);
  if (defHeight) warnings.push(`${defHeight} piece(s) have no size on the deco — defaulted to ${defaultHeightIn}"`);

  const fingerprint = _hash(pieces.map((p) => `${p.seq}|${p.size}|${p.kind}|${p.text}|${p.font}|${p.heightIn}`).join('\n'));
  return { pieces, fingerprint, warnings };
};
