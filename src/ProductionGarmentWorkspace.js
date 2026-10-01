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

function Roster({ item, numbersDone, onToggleNumber }) {
  const sizes = orderedSizeKeys(Object.keys(item.sizes));
  const { numbers, names, hasNumbers, hasNames } = item.personalization;
  // Parallel number/name arrays must stay in source order, including blank entries.
  const roster = pairRoster(numbers || {}, names || {}, sizes);
  const rows = roster.groups.flatMap(group => group.players.map((player, index) => ({ ...player, size: group.size, index })));
  const count = rows.filter(row => row.num && numbersDone[`${item.sku}|${row.size}|${row.num}`]).length;
  const numbered = rows.filter(row => row.num).length;
  return <section className="pgw-panel pgw-roster" aria-label="Sizes and assignments">
    <div className="pgw-panel-heading"><h3>Sizes & assignments</h3><strong>{item.units} units</strong></div>
    <dl className="pgw-sizes">{sizes.map(size => <div key={size}><dt>{size}</dt><dd>{item.sizes[size]}</dd></div>)}</dl>
    {!sizes.length && <p className="pgw-empty">Size quantities not supplied.</p>}
    {rows.length > 0 ? <>
      <div className="pgw-roster-caption">{numbered > 0 ? `${count} / ${numbered} numbers marked done` : `${rows.length} name assignments`}</div>
      <div className="pgw-table-wrap"><table><thead><tr><th>Size</th>{hasNumbers && <th>Number</th>}{hasNames && <th>Name</th>}{numbered > 0 && <th>Done</th>}</tr></thead>
        <tbody>{rows.map(row => { const done = !!numbersDone[`${item.sku}|${row.size}|${row.num}`];
          return <tr key={`${row.size}-${row.index}`}><th scope="row">{row.size}</th>{hasNumbers && <td>{row.num || 'Not supplied'}</td>}{hasNames && <td>{row.name || 'Not supplied'}</td>}
            {numbered > 0 && <td>{row.num ? <button type="button" className="pgw-number-check" aria-pressed={done}
              aria-label={`${done ? 'Unmark' : 'Mark'} number ${row.num}, size ${row.size}, ${item.sku} done`}
              onClick={() => onToggleNumber(item.sku, row.size, row.num)}>{done ? '✓' : '○'}</button> : '—'}</td>}</tr>;
        })}</tbody></table></div>
      {(hasNumbers || hasNames) && sizes.some(size => (hasNumbers && (numbers?.[size] || []).filter(n => n != null && n !== '').length !== Number(item.sizes[size])) ||
        (hasNames && (names?.[size] || []).filter(n => n != null && n !== '').length !== Number(item.sizes[size]))) &&
        <p className="pgw-notice">Some assignments are missing or do not match the size quantities. Review the roster before decorating.</p>}
    </> : <p className="pgw-empty">{hasNumbers || hasNames ? 'Number / name assignments not supplied for this job item.' : 'No number or name decoration assigned to this job item.'}</p>}
  </section>;
}

/** Display-only layout; existing number check-off callback remains owned by the job view. */
export default function ProductionGarmentWorkspace({ items, jobUnits, numbersDone = {}, onToggleNumber, onOpenFile }) {
  const [selectedId, setSelectedId] = useState(items[0]?.id);
  const [preview, setPreview] = useState(null);
  const selected = items.find(item => item.id === selectedId) || items[0];
  if (!selected) return <div className="pgw-empty">No garment details available for this job.</div>;
  return <div className="pgw">
    <div className="pgw-toolbar"><label>Garment / color
      <select aria-label="Garment / color" value={selected.id} onChange={e => { setSelectedId(e.target.value); setPreview(null); }}>
        {items.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.sku} · {item.name} · {item.color || 'Color not supplied'} · {item.units} units</option>)}
      </select></label><span>Job total: <strong>{jobUnits}</strong> units</span></div>
    <div className="pgw-item-heading"><div><h3>{selected.sku} · {selected.name}</h3><span>{selected.color || 'Garment color not supplied'}</span></div><strong>{selected.units} units</strong></div>
    <div className="pgw-columns">
      <section className="pgw-panel" aria-label="Artwork and decoration specs">
        <div className="pgw-panel-heading"><h3>Artwork & decoration specs</h3></div>
        {selected.referenceLabel && <p className="pgw-notice">{selected.referenceLabel}</p>}
        <div className="pgw-visuals">
          <section aria-label="Garment mockups"><h4>Garment mockup</h4>{selected.mockups.length ? selected.mockups.map(image =>
            <ReferenceImage key={`${selected.id}|${image.src}|${image.label}`} image={image} onPreview={setPreview} onOpenFile={onOpenFile} />) :
            <p className="pgw-empty">Garment mockup not supplied.</p>}</section>
          <section aria-label="Logo details"><h4>Logo detail</h4>{selected.logos.length ? selected.logos.map(image =>
            <ReferenceImage key={`${selected.id}|${image.src}|${image.label}`} image={image} onPreview={setPreview} onOpenFile={onOpenFile} />) :
            <p className="pgw-empty">Logo detail not supplied for this job item.</p>}</section>
        </div>
        <div className="pgw-specs">{selected.specs || <p className="pgw-empty">Decoration specs not supplied.</p>}</div>
        {selected.files.length > 0 && <div className="pgw-files"><h4>Production files</h4>{selected.files.map((file, index) =>
          <button type="button" key={index} onClick={() => onOpenFile(file.file)}>{file.label}</button>)}</div>}
      </section>
      <Roster item={selected} numbersDone={numbersDone} onToggleNumber={onToggleNumber} />
    </div>
    {preview && <ImagePreview image={preview} onClose={() => setPreview(null)} onOpenFile={onOpenFile} />}
  </div>;
}
