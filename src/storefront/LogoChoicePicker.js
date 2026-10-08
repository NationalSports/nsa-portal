import React from 'react';
import { DecoOverlay, decoUrlForColor } from '../lib/decoOverlay';

const designKey = (row) => row.variant_group_id || row.webstore_product_id;
const colorKey = (row) => String(row.color || '').trim().toLowerCase();

// Keep the first configured color, rather than replacing it with the last color.
export function logoDesignRows(rows) {
  const designs = new Map();
  rows.forEach((row) => { if (!designs.has(designKey(row))) designs.set(designKey(row), row); });
  return [...designs.values()];
}

export default function LogoChoicePicker({ rows, selected, onSelect, color, labelStyle, compact = false }) {
  const designs = logoDesignRows(rows);
  if (!designs.length) return null;
  return <div className={compact ? 'sf-logo-picker-compact' : ''} style={{ margin: compact ? '12px 0' : '4px 0 22px', color, '--logo-choice-color': color || '#17213b' }}>
    <div style={labelStyle}>{compact ? `${designs.length} designs` : designs.length > 1 ? 'Choose your logo' : 'Included logo'}</div>
    <div className="sf-design-choices" role="group" aria-label="Logo options">
      {designs.map((first, index) => {
        const key = designKey(first);
        const row = rows.find((candidate) => designKey(candidate) === key && colorKey(candidate) === colorKey(selected)) || first;
        const active = key === designKey(selected);
        const name = row.school_design_label || `Logo ${index + 1}`;
        const art = (Array.isArray(row.decorations) ? row.decorations : []).filter((d) => d && !d.perso && decoUrlForColor(d, row.color));
        const logo = art.find((d) => (d.side || 'front') === 'front') || art[0];
        return <button key={key} type="button" aria-label={name} aria-pressed={active}
          className={`sf-design-choice${active ? ' sf-design-choice-active' : ''}`}
          onClick={() => { if (!active) onSelect(row); }}>
          {active && <span className="sf-design-choice-check" aria-hidden="true">✓</span>}
          <span className="sf-design-choice-image">
            {logo ? <img className="sf-logo-cutout" src={decoUrlForColor(logo, row.color)} alt="" />
              : row.image_front_url ? <><img src={row.image_front_url} alt="" /><DecoOverlay decorations={row.decorations} colorName={row.color} /></>
                : <span aria-hidden="true">{name}</span>}
          </span>
          <span className="sf-design-choice-name">{name}</span>
        </button>;
      })}
    </div>
  </div>;
}
