/* eslint-disable */
// ── Tajima DST stitch-file reader ──
// A DST holds the needle path only: a 512-byte text header, then 3-byte
// records of (dx, dy, command) in 0.1 mm units. It carries NO thread colors —
// just the stops between them — so the art folder's color way supplies the
// color for each block (block N = thread line N). That is what lets the portal
// recolor the stitch preview live as a rep edits the thread list.
//
// Pure and dependency-free so it unit-tests in node and runs in the browser.
// Bit layout follows the published Tajima spec (same as pyembroidery's reader).

const bit = (b, n) => (b >> n) & 1;
function _dx(b0, b1, b2) {
  return 81 * (bit(b2, 2) - bit(b2, 3)) + 27 * (bit(b1, 2) - bit(b1, 3)) + 9 * (bit(b0, 2) - bit(b0, 3))
    + 3 * (bit(b1, 0) - bit(b1, 1)) + (bit(b0, 0) - bit(b0, 1));
}
function _dy(b0, b1, b2) {
  // DST's +y points up; negate so it matches screen/canvas coordinates.
  return -(81 * (bit(b2, 5) - bit(b2, 4)) + 27 * (bit(b1, 5) - bit(b1, 4)) + 9 * (bit(b0, 5) - bit(b0, 4))
    + 3 * (bit(b1, 7) - bit(b1, 6)) + (bit(b0, 7) - bit(b0, 6)));
}

// Returns { blocks, bounds, stitches } or null for a file that isn't a DST.
//   blocks: one entry per thread stop, each a list of runs; a run is a flat
//           [x0,y0,x1,y1,…] polyline of consecutive stitches (jumps/trims split runs).
function parseDst(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (b.length < 512 + 3) return null;
  let head = '';
  for (let i = 0; i < 20; i++) head += String.fromCharCode(b[i]);
  if (!/^LA:/.test(head)) return null;
  const blocks = [[]];
  let x = 0, y = 0, run = null, stitches = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 512; i + 2 < b.length; i += 3) {
    const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2];
    if ((b2 & 0xF3) === 0xF3) break; // end of design
    const px = x, py = y;
    x += _dx(b0, b1, b2); y += _dy(b0, b1, b2);
    if ((b2 & 0xC3) === 0xC3) { blocks.push([]); run = null; continue; } // color change / stop
    if ((b2 & 0x83) === 0x83) { run = null; continue; } // jump (trims are runs of jumps)
    if (!run) { run = [px, py]; blocks[blocks.length - 1].push(run); }
    run.push(x, y);
    stitches++;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  while (blocks.length > 1 && !blocks[blocks.length - 1].length) blocks.pop();
  if (!stitches) return null;
  return { blocks, stitches, bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } };
}

export { parseDst };
export default parseDst;
