import React from 'react';

// The same placement reference used by the public product page and frozen packet.
// This previews the bought text; the attached production template supplies print glyphs.
const defaults = { name: { x: 50, y: 22, w: 64 }, number: { x: 50, y: 51, w: 34 } };
export default function PersonalizationOverlay({ takesNumber, takesName, decorations = [], sampleName = 'PLAYER', sampleNumber = '00', preserveCase = false }) {
  const place = (kind, fallback) => { const d = decorations.find(x => x && x.kind === kind); return d ? { x: d.x ?? fallback.x, y: d.y ?? fallback.y, w: d.w ?? fallback.w } : fallback; };
  const token = (p, height, baseline, fontSize, value) => <div style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 1 }}><svg viewBox={`0 0 100 ${height}`} style={{ display: 'block', width: '100%', overflow: 'visible' }}><text x="50" y={baseline} textAnchor="middle" fontFamily="'Barlow Condensed',Oswald,Impact,sans-serif" fontWeight="800" fontSize={fontSize} fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="1.3" paintOrder="stroke" letterSpacing="1">{value}</text></svg></div>;
  return <>{takesName && token(place('perso_name', defaults.name), 26, 20, 20, preserveCase ? String(sampleName) : String(sampleName).toUpperCase())}{takesNumber && token(place('perso_number', defaults.number), 64, 52, 58, sampleNumber)}</>;
}
