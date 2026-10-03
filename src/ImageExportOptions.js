import React, {useEffect, useMemo, useState} from 'react';
import './ImageExportOptions.css';
import {editPixels, paletteOf, hex, rgb} from './lib/imageEdits';
const checker = {backgroundColor:'#fff',backgroundImage:'conic-gradient(#e2e8f0 25%, transparent 0 50%, #e2e8f0 0 75%, transparent 0)',backgroundSize:'20px 20px',border:'1px solid #cbd5e1',borderRadius:6};
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function loadImage(url) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Unable to load image')); img.src = url; });
}
export async function pngBlob(url, width) {
  const img = await loadImage(url);
  const w = Number(width), h = Math.round(w * img.naturalHeight / img.naturalWidth);
  if (!Number.isInteger(w) || w < 1 || w > 8192 || h < 1 || h > 8192 || w * h > 24000000) throw new Error('Choose a size up to 8192 pixels per side and 24 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'));
}
export function PngExport({url, name, disabled = false}) {
  const [width, setWidth] = useState(1500), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="image-png-export">
    <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={async()=>{setBusy(true);setError('');try{downloadBlob(await pngBlob(url,width),name.replace(/\.[^.]+$/,'')+'.png');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Exporting…':'Download PNG'}</button>
    <details><summary>Size</summary><label>Width (px) <input aria-label="PNG width" type="number" min="1" max="8192" value={width} onChange={e=>setWidth(e.target.value)}/></label></details>
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export default function ImageExportOptions({file, onApply, disabled}) {
  const [pixels,setPixels]=useState(null), [palette,setPalette]=useState([]), [colors,setColors]=useState({});
  const [remove,setRemove]=useState(false), [background,setBackground]=useState('#ffffff'), [tolerance,setTolerance]=useState(24), [error,setError]=useState('');
  const [selected,setSelected]=useState(null), [showAll,setShowAll]=useState(false), [applied,setApplied]=useState(false);
  const sourceUrl=file.originalUrl || file.url;
  useEffect(()=>{let cancelled=false;setPixels(null);setError('');setColors({});setRemove(false);setSelected(null);setShowAll(false);setApplied(false);
    loadImage(sourceUrl).then(img=>{
      if(cancelled)return;
      if(img.width*img.height>24000000)throw new Error('Editing supports images up to 24 megapixels. Resize this image first.');
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const p=ctx.getImageData(0,0,c.width,c.height);setPixels(p);setPalette(paletteOf(p.data));setBackground(hex(Array.from(p.data.slice(0,3))));
    }).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};
  },[sourceUrl]);
  const preview=useMemo(()=>{
    if(!pixels)return null;
    const c=document.createElement('canvas');c.width=pixels.width;c.height=pixels.height;const ctx=c.getContext('2d');
    const p=ctx.createImageData(c.width,c.height);p.data.set(editPixels(pixels.data,c.width,c.height,{background:remove?background:null,tolerance,colors}));ctx.putImageData(p,0,0);return c.toDataURL('image/png');
  },[pixels,remove,background,tolerance,colors]);
  const mainColors=palette.reduce((out,color)=>{
    const values=rgb(color);
    if(out.length<6&&!out.some(other=>rgb(other).every((v,i)=>Math.abs(v-values[i])<48)))out.push(color);
    return out;
  },[]);
  function changeColor(value){setColors({...colors,[selected]:value});setApplied(false);}
  function restoreColor(){const next={...colors};delete next[selected];setColors(next);setApplied(false);}
  return <details className="image-editor"><summary>Edit image <span>Optional</span></summary>
    <fieldset disabled={disabled || !pixels}>
      {preview&&<div className="image-editor-preview" style={checker}><img src={preview} alt="Edited artwork preview on transparency grid"/></div>}
      <div className="image-editor-tools">
        <label className="image-editor-background"><input type="checkbox" checked={remove} onChange={e=>{setRemove(e.target.checked);setApplied(false);}}/> Transparent background</label>
        <button type="button" className="image-editor-link" onClick={()=>{setColors({});setRemove(false);setTolerance(24);setSelected(null);setApplied(false);onApply(sourceUrl);}}>Reset</button>
      </div>
      <div className="image-editor-colors">
        <div className="image-editor-section-label">Change a color <span>Select a swatch</span></div>
        <div className="image-editor-swatches">{(showAll?palette:mainColors).map(color=><button type="button" key={color} aria-label={'Select color '+color} aria-pressed={selected===color} title={color} onClick={()=>setSelected(selected===color?null:color)} className="image-editor-swatch" style={{background:colors[color]===null?checker.backgroundImage:(colors[color]||color)}}>{colors[color]===null?'×':selected===color?'✓':''}</button>)}
          <button type="button" className="image-editor-link" onClick={()=>setShowAll(!showAll)}>{showAll?'Fewer colors':'More shades'}</button>
        </div>
        {selected&&<div className="image-editor-selected">
          <label>Replace with <input aria-label={'Replace '+selected} type="color" value={colors[selected]||selected} onChange={e=>changeColor(e.target.value)}/></label>
          <button type="button" className="btn btn-secondary" onClick={()=>changeColor(null)} disabled={colors[selected]===null}>{colors[selected]===null?'Removed':'Remove color'}</button>
          {Object.prototype.hasOwnProperty.call(colors,selected)&&<button type="button" className="image-editor-link" onClick={restoreColor}>Restore</button>}
          <small>Changes this color throughout the image.</small>
        </div>}
      </div>
      <details className="image-editor-fine"><summary>Fine-tune edges</summary>
        <label>Background color <input aria-label="Background color" type="color" value={background} onChange={e=>{setBackground(e.target.value);setApplied(false);}}/></label>
        <label>Similar shades <input aria-label="Color matching tolerance" type="range" min="0" max="100" value={tolerance} onChange={e=>{setTolerance(Number(e.target.value));setApplied(false);}}/> {tolerance}</label>
        <p>Increase to include more shades. Background removal keeps enclosed white details.</p>
      </details>
      <div className="image-editor-actions">
        <button type="button" className="btn btn-primary" onClick={()=>{onApply(preview);setApplied(true);}}>{applied?'Edits applied':'Apply edits'}</button>
        {preview&&<PngExport url={preview} name={file.name} disabled={disabled}/>}
      </div>
      <p className="image-editor-hint">PNG is ready to download. For SVG, apply edits, then choose Vectorize Image below.</p>
    </fieldset>{error&&<p role="alert">{error}</p>}
  </details>;
}
