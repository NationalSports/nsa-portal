// Gang-sheet shelf packer for DTF transfer batches — pure, unit-tested directly
// (src/__tests__/dtfOrders.test.js). Used by dtf-orders.js to lay a batch's
// prints onto a fixed-width roll so the manifest can quote total sheet length
// and the vendor portal can render a printable layout.
//
// Algorithm: first-fit-decreasing shelf packing. Each request expands to `qty`
// copies of (width_in × height_in) plus a per-print bleed (spacing). Copies are
// sorted tallest-first and placed left-to-right on horizontal shelves inside the
// usable width (sheet width minus margins); a copy that doesn't fit the current
// shelf opens a new shelf below. A copy is auto-rotated 90° when it only fits
// the usable width rotated, or when rotating makes it shorter (less shelf
// height) and it still fits. Anything that fits in NEITHER orientation is
// returned in `unplaced` — never silently dropped (same never-drop posture as
// the auto-PO engine's no_vendor_mapping list).
//
// All units are inches; outputs are rounded to 2 decimals.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// requests: [{ id, width_in, height_in, qty }]
// opts: { sheetWidthIn, marginIn, spacingIn }
function packGangSheet(requests, opts) {
  const sheetW = Number(opts && opts.sheetWidthIn) > 0 ? Number(opts.sheetWidthIn) : 22;
  const margin = Number(opts && opts.marginIn) >= 0 ? Number(opts.marginIn) : 0.25;
  const spacing = Number(opts && opts.spacingIn) >= 0 ? Number(opts.spacingIn) : 0.5;
  const usableW = sheetW - margin * 2;

  // Expand copies; decide orientation per DESIGN once (all copies of a design
  // rotate together — simpler for the press operator to read).
  const copies = [];
  const unplaced = [];
  for (const req of requests || []) {
    const w = Number(req.width_in) || 0;
    const h = Number(req.height_in) || 0;
    const qty = Math.max(0, Math.round(Number(req.qty) || 0));
    if (w <= 0 || h <= 0 || qty <= 0) continue;
    const fitsUpright = w + spacing <= usableW + 1e-9;
    const fitsRotated = h + spacing <= usableW + 1e-9;
    let rotated;
    if (!fitsUpright && !fitsRotated) {
      unplaced.push({ request_id: req.id, width_in: r2(w), height_in: r2(h), qty, reason: 'wider_than_sheet' });
      continue;
    }
    if (!fitsUpright) rotated = true;
    else if (!fitsRotated) rotated = false;
    // Fits both ways: prefer the orientation with the smaller vertical span
    // (shorter shelves → shorter sheet), i.e. rotate tall-and-narrow prints
    // to lie down.
    else rotated = h > w;
    const pw = rotated ? h : w;
    const ph = rotated ? w : h;
    for (let c = 0; c < qty; c++) {
      copies.push({ request_id: req.id, copy: c + 1, w: pw, h: ph, rotated });
    }
  }

  copies.sort((a, b) => b.h - a.h || b.w - a.w);

  const placements = [];
  const shelves = []; // { y, height, cursorX }
  for (const cp of copies) {
    let shelf = null;
    for (const s of shelves) {
      // First fit: same-or-taller shelf with horizontal room. Copies are sorted
      // tallest-first, so cp.h never exceeds an existing shelf's height.
      if (cp.w + spacing <= usableW - s.cursorX + 1e-9) { shelf = s; break; }
    }
    if (!shelf) {
      const y = shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].height + spacing : margin;
      shelf = { y, height: cp.h, cursorX: 0 };
      shelves.push(shelf);
    }
    placements.push({
      request_id: cp.request_id,
      copy: cp.copy,
      x: r2(margin + shelf.cursorX),
      y: r2(shelf.y),
      w: r2(cp.w),
      h: r2(cp.h),
      rotated: cp.rotated,
    });
    shelf.cursorX += cp.w + spacing;
  }

  const last = shelves[shelves.length - 1];
  const sheetLengthIn = last ? r2(last.y + last.height + margin) : 0;
  const totalAreaSqin = r2(placements.reduce((a, p) => a + p.w * p.h, 0));
  return {
    sheet_width_in: r2(sheetW),
    sheet_length_in: sheetLengthIn,
    total_prints: placements.length,
    total_area_sqin: totalAreaSqin,
    placements,
    unplaced,
  };
}

module.exports = { packGangSheet };
