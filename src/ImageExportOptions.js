import React, {useEffect, useMemo, useState} from 'react';
import {editPixels, paletteOf, hex} from './lib/imageEdits';
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
  return <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>PNG export (optional)</summary>
    <p style={{fontSize:12}}>Transparent areas stay transparent. An existing background stays unless you remove it.</p>
    <label>Width (px) <input aria-label="PNG width" type="number" min="1" max="8192" value={width} onChange={e=>setWidth(e.target.value)} style={{width:90}}/></label>{' '}
    <button className="btn btn-secondary" disabled={disabled || busy} onClick={async()=>{setBusy(true);setError('');try{downloadBlob(await pngBlob(url,width),name.replace(/\.[^.]+$/,'')+'.png');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Exporting…':'Download PNG'}</button>
    {error&&<p role="alert">{error}</p>}
  </details>;
}
export default function ImageExportOptions({file, onApply, disabled}) {
  const [pixels,setPixels]=useState(null), [palette,setPalette]=useState([]), [colors,setColors]=useState({});
  const [remove,setRemove]=useState(false), [background,setBackground]=useState('#ffffff'), [tolerance,setTolerance]=useState(24), [error,setError]=useState('');
  const sourceUrl=file.originalUrl || file.url;
  useEffect(()=>{let cancelled=false;setPixels(null);setError('');setColors({});setRemove(false);
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
  return <details style={{marginTop:16}}><summary style={{cursor:'pointer',fontWeight:600}}>Edit background / colors or export PNG (optional)</summary>
    <fieldset disabled={disabled || !pixels} style={{border:0,padding:'12px 0'}}>
      <label><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/> Remove outside background</label>
      {remove&&<label style={{display:'block',marginTop:8}}>Background color <input aria-label="Background color" type="color" value={background} onChange={e=>setBackground(e.target.value)}/></label>}
      <p style={{fontSize:12,color:'#64748b'}}>Removes matching areas connected to the image edges. Enclosed artwork stays intact. To remove a color everywhere, use Remove below.</p>
      <label>Color matching tolerance: {tolerance} <input aria-label="Color matching tolerance" type="range" min="0" max="100" value={tolerance} onChange={e=>setTolerance(Number(e.target.value))}/></label>
      <p style={{fontSize:12}}>Detected colors (up to 24). Choose a replacement or remove a color. Adjust tolerance for similar shades and edge pixels.</p>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{palette.map(color=><div key={color} style={{border:'1px solid #cbd5e1',padding:6,borderRadius:6}}>
        <span style={{display:'inline-block',width:16,height:16,background:color,border:'1px solid #94a3b8'}}/> <span style={{fontSize:12}}>{color}</span>{' '}
        <input aria-label={'Replace '+color} type="color" value={colors[color] || color} onChange={e=>setColors({...colors,[color]:e.target.value})}/>
        <label style={{display:'block',fontSize:12}}><input type="checkbox" checked={colors[color]===null} onChange={e=>{const next={...colors};if(e.target.checked)next[color]=null;else delete next[color];setColors(next);}}/> Remove</label>
      </div>)}</div>
      {preview&&<div style={{...checker,marginTop:12,textAlign:'center'}}><img src={preview} alt="Edited artwork preview on transparency grid" style={{maxWidth:'100%',maxHeight:280}}/></div>}
      <div style={{display:'flex',gap:8,marginTop:12}}><button className="btn btn-primary" onClick={()=>onApply(preview)}>Use this image for vectorization</button>
        <button className="btn btn-secondary" onClick={()=>{setColors({});setRemove(false);setTolerance(24);onApply(file.originalUrl || file.url);}}>Reset to original</button></div>
      <p style={{fontSize:12}}>Applying edits clears any previous vector result. Vectorize again to export those edits as SVG or PDF.</p>
      {preview&&<PngExport url={preview} name={file.name} disabled={disabled}/>}
    </fieldset>{error&&<p role="alert">{error}</p>}
  </details>;
}
