// Uniform Builder — fabric guide content.
//
// Each fabric option gets a generated close-up swatch (drawn once per session
// on a canvas — no image assets to ship) plus buyer-facing copy for the
// fabric-detail popup on the Team step.

export const FABRIC_DETAILS = [
  {
    id: 'sublimated', label: 'Sublimated Poly',
    blurb: 'Smooth, high-count performance polyester engineered for full sublimation printing.',
    detail: 'Truest color reproduction of any fabric — patterns, fades, and prints are dyed into the fiber, so they never crack or peel. Our standard game-day fabric.',
  },
  {
    id: 'matte', label: 'Matte Knit',
    blurb: 'Soft interlock knit with a fine vertical rib and a low-sheen, broken-in feel.',
    detail: 'A classic jersey hand-feel with zero shine. Great for teams that want a traditional cotton-like look with modern performance fiber.',
  },
  {
    id: 'mesh', label: 'Mesh',
    blurb: 'Micro-perforated polyester that maximizes airflow.',
    detail: 'Visible breathable perforations across the fabric. The hot-weather choice — football practice, lacrosse, and summer tournaments.',
  },
  {
    id: 'heather', label: 'Heather',
    blurb: 'Two-tone melange yarns for a premium, retail-inspired look.',
    detail: 'A subtle fleck runs through every color you pick, softening solids into an athleisure feel. Pairs well with bold solid trim.',
  },
  {
    id: 'gloss', label: 'Gloss',
    blurb: 'High-sheen dazzle finish that pops under gym lights.',
    detail: 'The traditional basketball and track finish — a light-catching surface that makes saturated colors look wet and vivid.',
  },
];

const _swatches = {};

// Close-up swatch: a neutral fabric chip showing the weave/finish, not a color
// (color is the coach's choice — the guide sells the *surface*).
export function fabricSwatchDataURL(id) {
  if (_swatches[id]) return _swatches[id];
  const W = 280, H = 170;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');

  // soft top-lit base
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e8eaef'); g.addColorStop(1, '#c9cdd6');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  if (id === 'matte') {
    for (let px = 0; px < W; px += 3) {
      x.fillStyle = px % 6 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(30,40,60,0.10)';
      x.fillRect(px, 0, 1.6, H);
    }
  } else if (id === 'mesh') {
    x.fillStyle = 'rgba(25,32,48,0.30)';
    for (let ry = 0; ry * 13 < H + 13; ry++) {
      const oy = ry * 13, ox = (ry % 2) * 7.5;
      for (let px = -8; px < W + 8; px += 15) {
        x.beginPath(); x.arc(px + ox, oy, 3.1, 0, Math.PI * 2); x.fill();
      }
    }
  } else if (id === 'heather') {
    for (let i = 0; i < 2400; i++) {
      const gLum = 90 + Math.floor(rand() * 120);
      x.fillStyle = `rgba(${gLum},${gLum},${gLum + 6},${(0.18 + rand() * 0.4).toFixed(2)})`;
      const w = 1 + rand() * 2.6;
      x.fillRect(rand() * W, rand() * H, w, w * (0.4 + rand()));
    }
  } else if (id === 'gloss') {
    x.save();
    x.translate(W * 0.55, 0); x.rotate(0.5);
    const hg = x.createLinearGradient(-40, 0, 60, 0);
    hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,0.65)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hg; x.fillRect(-60, -20, 130, H + 40);
    x.restore();
  } else { // sublimated — fine diagonal weave
    x.strokeStyle = 'rgba(30,40,60,0.07)'; x.lineWidth = 1;
    for (let d = -H; d < W + H; d += 4) {
      x.beginPath(); x.moveTo(d, 0); x.lineTo(d + H, H); x.stroke();
    }
  }

  // universal fine grain so every chip reads as textile
  for (let i = 0; i < 1300; i++) {
    x.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(20,26,40,0.05)';
    x.fillRect(rand() * W, rand() * H, 1, 1);
  }

  const url = c.toDataURL('image/png');
  _swatches[id] = url;
  return url;
}
