import React from 'react';
import { DecoOverlay } from '../lib/decoOverlay';

// Saved placements use a raw, contain-fitted photo in a 4:5 frame, just like
// the placement editor. Keep that frame even inside square comparison panels.
export default function ShowcaseProductImage({ item, url, alt, height }) {
  return <span style={{ position: 'relative', display: 'block', aspectRatio: '4 / 5',
    width: height ? height * 4 / 5 : '100%', height: height || 'auto', margin: '0 auto', overflow: 'hidden', background: '#fff' }}>
    <img src={url} alt={alt} loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
    <DecoOverlay decorations={item.decorations} colorName={item.color} />
  </span>;
}
