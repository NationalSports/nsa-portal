// Transfer the editor's coordinates through corresponding garment landmarks.
// Hood height and image padding are deliberately not part of this transform.
const { validateQuad } = require('./_showcaseFamilyRender');
function usesTorsoAnchors(product, decoration) {
  return decoration.placement === 'full_front' &&
    /\b(hoodie|hood|sweatshirt|crew|pullover|polo|t-shirt|tee)\b/i.test(product.name || '');
}
function basis(anchors) {
  const names = ['neck', 'hem', 'left', 'right'];
  if (!anchors || names.some(k => !Array.isArray(anchors[k]) || anchors[k].length !== 2 ||
      anchors[k].some(v => !Number.isFinite(v) || v < 0 || v > 1))) {
    throw new Error('Missing or invalid neckline, hem, or torso-side landmarks');
  }
  const { neck, hem, left, right } = anchors;
  const across = right.map((v, i) => v - left[i]);
  const down = hem.map((v, i) => v - neck[i]);
  const det = across[0] * down[1] - across[1] * down[0];
  if (across[0] < .1 || down[1] < .15 || det < .02) throw new Error('Garment landmarks have an invalid orientation or span');
  return { neck, across, down, det };
}
function anchoredPlacement(placement, anchors) {
  const s = basis(anchors?.source), t = basis(anchors?.target);
  const { x, y, w } = placement;
  if (![x,y,w].every(Number.isFinite) || w <= 0 || w > 100 || x < 0 || x > 100 || y < 0 || y > 100) throw new Error('Invalid saved logo placement');
  const transform = ([px,py]) => {
    const dx = px-s.neck[0], dy = py-s.neck[1];
    const u = (dx*s.down[1]-dy*s.down[0])/s.det;
    const v = (s.across[0]*dy-s.across[1]*dx)/s.det;
    return { u, v, point: t.neck.map((n,i)=>n+u*t.across[i]+v*t.down[i]) };
  };
  const center = transform([x/100,y/100]);
  if (Math.abs(center.u) > .5 || center.v < 0 || center.v > 1) throw new Error('Saved full-front placement is outside the torso landmarks');
  // Source frame is 1000 x 1250; a square of width w has height .8w.
  const quad = [[x-w/2,y-w*.4],[x+w/2,y-w*.4],[x+w/2,y+w*.4],[x-w/2,y+w*.4]]
    .map(p=>transform(p.map(v=>v/100)).point);
  validateQuad(quad);
  return quad;
}
module.exports = { anchoredPlacement, usesTorsoAnchors };
