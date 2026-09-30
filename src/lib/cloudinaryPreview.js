// Request a display-sized derivative for Cloudinary uploads. The stored URL and
// full-size action remain untouched. Skip URLs whose transformation chain is
// unknown so the preview cannot silently change an existing crop/effect.
export function cloudinaryPreviewUrl(url, width = 1600) {
  if (typeof url !== 'string') return url;
  const match = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+\.(?:png|jpe?g|webp|gif|bmp))(\?.*)?$/i);
  if (!match) return url;
  const bounded = Math.max(80, Math.min(2400, Math.round(width)));
  return match[1] + 'c_limit,w_' + bounded + '/q_auto/f_auto/' + match[2] + (match[3] || '');
}
