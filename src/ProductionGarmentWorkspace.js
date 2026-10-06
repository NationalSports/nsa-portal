import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { orderedSizeKeys } from './constants';
import { pairRoster } from './lib/workOrderSheet';
import './productionGarmentWorkspace.css';

function ImagePreview({ image, onClose, onOpenFile }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node.showModal();
    return () => { node.close(); previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="pgw-preview" aria-label={image.label} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="pgw-preview-header"><strong>{image.label}</strong><div>
      <button type="button" onClick={() => onOpenFile(image.file)}>Open original</button>
      <button type="button" onClick={onClose}>Close preview</button>
    </div></div>
    <div className="pgw-preview-image" style={{ background: image.background || '#fff' }}><img src={image.src} alt={image.label} /></div>
  </dialog>, document.body);
}

function ReferenceImage({ image, onPreview, onOpenFile }) {
  const [failed, setFailed] = useState(false);
  return <figure className="pgw-reference">
    {image.src && !failed ? <button type="button" className="pgw-image" style={{ background: image.background || '#fff' }}
      aria-label={`Enlarge ${image.label}`} onClick={() => onPreview(image)}>
      <img src={image.src} alt={image.label} onError={() => setFailed(true)} />
      <span>Tap to enlarge</span>
    </button> : <div className="pgw-empty"><p>{failed ? 'Image preview unavailable.' : 'No image preview for this file.'}</p>
      <button type="button" onClick={() => onOpenFile(image.file)}>Open {image.label}</button></div>}
    <figcaption>{image.label}</figcaption>
  </figure>;
}

function Roster({ item, numbersDone, onToggleNumber, showHeading }) {
  const sizes = orderedSizeKeys(Object.keys(item.sizes));
  const { numbers, names, hasNumbers, hasNames } = item.personalization;
  // Parallel number/name arrays must stay in source order, including blank entries.
  const roster = pairRoster(numbers || {}, names || {}, sizes);
  const rows = roster.groups.flatMap(group => group.players.map((player, index) => ({ ...player, size: group.size, index })));
  const count = rows.filter(row => row.num && numbersDone[`${item.sku}|${row.size}|${row.num}`]).length;
  const numbered = rows.filter(row => row.num).length;
  return <div className="pgw-roster-block" aria-label={`Numbers and names for ${item.sku} ${item.color || ''}`.trim()}>
    {showHeading && <div className="pgw-roster-title"><strong>{item.sku}</strong> · {item.color || 'Color not supplied'} <span>{item.units} units</span></div>}
    {rows.length > 0 ? <>
      <div className="pgw-roster-caption">{numbered > 0 ? `${count} / ${numbered} numbers marked done` : `${rows.length} name assignments`}</div>
      <div className="pgw-table-wrap"><table><thead><tr><th>Size</th>{hasNumbers && <th>Number</th>}{hasNames && <th>Name</th>}{numbered > 0 && <th>Done</th>}</tr></thead>
        <tbody>{rows.map(row => { const done = !!numbersDone[`${item.sku}|${row.size}|${row.num}`];
          return <tr key={`${row.size}-${row.index}`}><th scope="row">{row.size}</th>{hasNumbers && <td>{row.num || 'Not supplied'}</td>}{hasNames && <td>{row.name || 'Not supplied'}</td>}
            {numbered > 0 && <td>{row.num ? <button type="button" className="pgw-number-check" aria-pressed={done}
              aria-label={`${done ? 'Unmark' : 'Mark'} number ${row.num}, size ${row.size}, ${item.sku} done`}
              onClick={() => onToggleNumber(item.sku, row.size, row.num)}>{done ? '✓' : '○'}</button> : '—'}</td>}</tr>;
        })}</tbody></table></div>
      {sizes.some(size => (hasNumbers && (numbers?.[size] || []).filter(n => n != null && n !== '').length !== Number(item.sizes[size])) ||
        (hasNames && (names?.[size] || []).filter(n => n != null && n !== '').length !== Number(item.sizes[size]))) &&
        <p className="pgw-notice">Some assignments are missing or do not match the size quantities. Review the roster before decorating.</p>}
    </> : <p className="pgw-empty">Number / name assignments not supplied for this job item.</p>}
  </div>;
}

// One entry per distinct image across the group's garments, remembering which garments use it,
// so a mockup shared by several SKUs shows once with all of them named under it.
const collectImages = (items, field, keyOf) => {
  const out = []; const byKey = new Map();
  items.forEach(item => (item[field] || []).forEach(image => {
    const key = keyOf(image);
    let entry = byKey.get(key);
    if (!entry) { entry = { image, usedBy: [] }; byKey.set(key, entry); out.push(entry); }
    if (!entry.usedBy.includes(item)) entry.usedBy.push(item);
  }));
  return out;
};
const garmentLabel = item => `${item.sku} (${item.color || 'color not supplied'})`;

function GroupImages({ entries, showUsedBy, onPreview, onOpenFile }) {
  return entries.map(({ image, usedBy }) => <div key={`${image.src}|${image.label}|${image.background || ''}`}>
    <ReferenceImage image={image} onPreview={onPreview} onOpenFile={onOpenFile} />
    {showUsedBy && <p className="pgw-used-by">For: {usedBy.map(garmentLabel).join(', ')}</p>}
  </div>);
}

function DecorationGroup({ group, index, total, numbersDone, onToggleNumber, onOpenFile, onPreview }) {
  const { items } = group;
  const multi = items.length > 1;
  const units = items.reduce((a, item) => a + item.units, 0);
  const sizes = orderedSizeKeys(items.flatMap(item => Object.keys(item.sizes)));
  const mockups = collectImages(items, 'mockups', image => image.src || image.label);
  const logos = collectImages(items, 'logos', image => `${image.src}|${image.background || ''}`);
  const notices = [...new Set(items.map(item => item.referenceLabel).filter(Boolean))];
  const files = [];
  items.forEach(item => (item.files || []).forEach(file => { if (!files.some(f => f.label === file.label)) files.push(file); }));
  const personalized = items.filter(item => item.personalization.hasNumbers || item.personalization.hasNames);
  return <section className="pgw-group" id={`pgw-group-${index}`} aria-label={`Decoration group ${index + 1}`}>
    <div className="pgw-group-heading">
      <div>{total > 1 && <span className="pgw-group-chip">Group {index + 1} of {total}</span>}
        <h3>{group.summary || 'Decoration'}</h3>
        <span>{items.length} {items.length === 1 ? 'garment' : 'garments'} · same logo & colors</span></div>
      <strong>{units} units</strong>
    </div>
    <div className="pgw-panel">
      <div className="pgw-table-wrap"><table className="pgw-size-table"><thead><tr><th>Garment</th><th>Color</th>
        {sizes.map(size => <th key={size} className="pgw-num">{size}</th>)}<th className="pgw-num">Total</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}><th scope="row"><strong>{item.sku}</strong><div className="pgw-sub">{item.name}</div></th>
          <td>{item.color || 'Not supplied'}</td>
          {sizes.map(size => <td key={size} className="pgw-num">{item.sizes[size] || ''}</td>)}<td className="pgw-num"><strong>{item.units}</strong></td></tr>)}
          {!sizes.length && <tr><td colSpan={3} className="pgw-empty">Size quantities not supplied.</td></tr>}
        </tbody>
        {multi && sizes.length > 0 && <tfoot><tr><th scope="row" colSpan={2}>Group total</th>
          {sizes.map(size => <td key={size} className="pgw-num">{items.reduce((a, item) => a + (Number(item.sizes[size]) || 0), 0) || ''}</td>)}
          <td className="pgw-num"><strong>{units}</strong></td></tr></tfoot>}
      </table></div>
    </div>
    <div className={personalized.length ? 'pgw-columns' : 'pgw-columns pgw-columns-single'}>
      <section className="pgw-panel" aria-label="Artwork and decoration specs">
        <div className="pgw-panel-heading"><h3>Artwork & decoration specs</h3></div>
        {notices.map(text => <p key={text} className="pgw-notice">{text}</p>)}
        <div className="pgw-visuals">
          <section aria-label="Garment mockups"><h4>Garment mockup</h4>{mockups.length ?
            <GroupImages entries={mockups} showUsedBy={multi} onPreview={onPreview} onOpenFile={onOpenFile} /> :
            <p className="pgw-empty">Garment mockup not supplied.</p>}</section>
          <section aria-label="Logo details"><h4>Logo detail</h4>{logos.length ?
            <GroupImages entries={logos} showUsedBy={multi} onPreview={onPreview} onOpenFile={onOpenFile} /> :
            <p className="pgw-empty">Logo detail not supplied for this job item.</p>}</section>
        </div>
        <div className="pgw-specs">{items[0].specs || <p className="pgw-empty">Decoration specs not supplied.</p>}</div>
        {files.length > 0 && <div className="pgw-files"><h4>Production files</h4>{files.map((file, i) =>
          <button type="button" key={i} onClick={() => onOpenFile(file.file)}>{file.label}</button>)}</div>}
      </section>
      {personalized.length > 0 && <section className="pgw-panel pgw-roster" aria-label="Numbers and names">
        <div className="pgw-panel-heading"><h3>Numbers & names</h3></div>
        {personalized.map(item => <Roster key={item.id} item={item} numbersDone={numbersDone} onToggleNumber={onToggleNumber} showHeading={multi} />)}
      </section>}
    </div>
  </section>;
}

/**
 * Display-only layout; existing number check-off callback remains owned by the job view.
 * Garments sharing a `groupKey` (same logo, ink colors and placement) render as one card,
 * and every card is on the page at once so the floor can scroll the whole job.
 */
export default function ProductionGarmentWorkspace({ items, jobUnits, numbersDone = {}, onToggleNumber, onOpenFile }) {
  const [preview, setPreview] = useState(null);
  if (!items.length) return <div className="pgw-empty">No garment details available for this job.</div>;
  const groups = [];
  items.forEach(item => {
    const key = item.groupKey ?? item.id;
    let group = groups.find(g => g.key === key);
    if (!group) { group = { key, summary: item.decoSummary, items: [] }; groups.push(group); }
    group.items.push(item);
  });
  const jump = index => document.getElementById(`pgw-group-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <div className="pgw">
    <div className="pgw-toolbar">
      <span>{items.length} {items.length === 1 ? 'garment' : 'garments'} · {groups.length} {groups.length === 1 ? 'decoration' : 'decorations'} · Job total: <strong>{jobUnits}</strong> units</span>
      {groups.length > 1 && <nav className="pgw-jump" aria-label="Jump to decoration group">{groups.map((group, index) =>
        <button type="button" key={group.key} onClick={() => jump(index)}>{index + 1}. {group.summary || 'Decoration'} · {group.items.length} SKU{group.items.length === 1 ? '' : 's'}</button>)}</nav>}
    </div>
    {groups.map((group, index) => <DecorationGroup key={group.key} group={group} index={index} total={groups.length}
      numbersDone={numbersDone} onToggleNumber={onToggleNumber} onOpenFile={onOpenFile} onPreview={setPreview} />)}
    {preview && <ImagePreview image={preview} onClose={() => setPreview(null)} onOpenFile={onOpenFile} />}
  </div>;
}
