// Route SanMar garment photos through a Cloudinary transform that trims to the
// garment (on its white studio background) and pads to a uniform 4:5 frame, so
// every product is framed identically and an applied team logo lands at the same
// spot instead of drifting with each photo's crop. Only SanMar-hosted images are
// wrapped (the Cloudinary account's fetch allowlist covers those hosts); a store's
// own uploaded mockup or another vendor's image passes through untouched. f_jpg
// keeps the output decodable everywhere. Cloud name matches utils' CLOUDINARY_CLOUD.
const _CLD_GARMENT = 'https://res.cloudinary.com/dwlyljyuz/image/fetch/e_trim:10/c_pad,w_800,h_1000,b_white,f_jpg,q_auto/';
export function normGarment(url) {
  if (!url || typeof url !== 'string') return url;
  let host; try { host = new URL(url).hostname; } catch (e) { return url; }
  if (!/(?:^|\.)cdn[pm]\.sanmar\.com$/i.test(host)) return url;
  return _CLD_GARMENT + encodeURIComponent(url);
}
// How to frame a garment photo that carries a placed logo. A DECORATED item must render
// exactly like the placement editor — RAW photo, object-fit:contain, 4:5 box — so the logo
// lands where the rep dragged it (normGarment's trim+pad reframes the photo and pushes the
// logo off). An UNDECORATED item has nothing to align, so it keeps the uniform normGarment+
// cover look (avoids letterboxing plain catalog garments). `baked` mocks already have the art
// in the photo, so they count as undecorated here. Returns { src, fit } for the <img>.
const _hasLiveDeco = (decos) => Array.isArray(decos) && decos.some((d) => d && !d.baked);
export const garmentFrame = (url, decos) => _hasLiveDeco(decos)
  ? { src: url, fit: 'contain' }
  : { src: normGarment(url), fit: 'cover' };
