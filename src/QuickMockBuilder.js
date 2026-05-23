/* eslint-disable */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as fabric from 'fabric';
import { Icon } from './components';
import { fileUpload, _cloudinaryPdfThumb } from './utils';

// Quick Mock Builder
// Lets a rep build mockups themselves (skipping the artist on the mockup phase) by
// dropping art onto a garment image and dragging/resizing it. Supports multiple art
// locations per garment (one layer per artwork) and one mockup per garment color.
// Pre-fills each location from the art already on the artwork so the rep doesn't
// re-upload. Source files persist on each artwork; the artist still does separations.
//
// Props:
//   garments  : [{key, sku, color, name, frontUrl, backUrl}]
//   locations : [{artFileId, name, position, existingFiles:[...], preview:{url}|null}]
//   initialMocks : {key:[{url,name}]}
//   onSave({mocksByGarment, filesByLocation})
//   onClose()
//   nf
export default function QuickMockBuilder({garments, locations, initialMocks, onSave, onClose, nf}){
  const [gi, setGi] = useState(0);
  const [side, setSide] = useState('front');
  const [canvas, setCanvas] = useState(null);
  const wrapRef = useRef(null);
  // Each location is a layer. preview = renderable art to place on the canvas (may come
  // from the artwork already on file). source = a NEW file to append to the artwork on save.
  const [layers, setLayers] = useState(() => locations.map(l => ({
    artFileId: l.artFileId, name: l.name, position: l.position,
    existingFiles: l.existingFiles || [],
    preview: l.preview || null,
    source: null,
    hasExisting: (l.existingFiles || []).length > 0 || !!l.preview,
  })));
  const [mocks, setMocks] = useState(() => ({...(initialMocks || {})}));
  const [imgOverride, setImgOverride] = useState({});
  const [busy, setBusy] = useState(false);

  const garment = garments[gi] || {};
  const baseUrl = side === 'back' ? garment.backUrl : garment.frontUrl;
  const garmentUrl = imgOverride[garment.key] || baseUrl;

  // Build the fabric canvas imperatively inside a wrapper div React owns. Fabric wraps
  // the <canvas> in its own container, so we never let React manage the canvas element
  // directly — that avoids the removeChild crash when switching garment color / side.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let disposed = false;
    const el = document.createElement('canvas');
    wrap.appendChild(el);
    const c = new fabric.Canvas(el, {width: 460, height: 560, backgroundColor: '#ffffff'});
    setCanvas(c);
    const delHandler = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
        const sel = c.getActiveObject();
        if (sel && sel._isArt) { c.remove(sel); c.discardActiveObject(); c.renderAll(); }
      }
    };
    document.addEventListener('keydown', delHandler);

    if (!garmentUrl) {
      c.add(new fabric.FabricText('No garment image — upload one below', {left: 230, top: 280, fontSize: 14, fill: '#94a3b8', originX: 'center', originY: 'center', selectable: false}));
      c.renderAll();
    } else {
      const place = imgEl => {
        if (disposed) return;
        const garImg = new fabric.FabricImage(imgEl, {selectable: false, evented: false});
        const scale = Math.min(460 / garImg.width, 560 / garImg.height);
        garImg.set({scaleX: scale, scaleY: scale, left: (460 - garImg.width * scale) / 2, top: (560 - garImg.height * scale) / 2});
        c.add(garImg); c.sendObjectToBack(garImg); c.renderAll();
      };
      const proxyUrl = '/.netlify/functions/image-proxy?url=' + encodeURIComponent(garmentUrl);
      const imgEl = new Image(); imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => place(imgEl);
      imgEl.onerror = () => {
        const direct = new Image(); direct.crossOrigin = 'anonymous';
        direct.onload = () => place(direct);
        direct.onerror = () => { if (!disposed) { c.add(new fabric.FabricText('Could not load garment image', {left: 230, top: 280, fontSize: 13, fill: '#ef4444', originX: 'center', originY: 'center', selectable: false})); c.renderAll(); } };
        direct.src = garmentUrl;
      };
      imgEl.src = proxyUrl;
    }
    return () => {
      disposed = true;
      document.removeEventListener('keydown', delHandler);
      try { c.dispose(); } catch (e) {}
      try { wrap.innerHTML = ''; } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, side, garmentUrl]);

  const styleArt = obj => {
    obj.set({originX: 'center', originY: 'center', cornerColor: '#3b82f6', cornerStyle: 'circle', cornerSize: 10, transparentCorners: false, borderColor: '#3b82f6'});
    obj._isArt = true;
  };

  const placeStandIn = layer => {
    if (!canvas) return;
    const label = (layer.name || layer.position || 'ART').toUpperCase();
    const txt = new fabric.FabricText(label, {left: 230, top: 250, fontSize: 24, fontWeight: 'bold', fill: 'rgba(0,0,0,0.65)', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.7)'});
    styleArt(txt); txt._layerId = layer.artFileId;
    canvas.add(txt); canvas.setActiveObject(txt); canvas.renderAll();
  };

  const placeLayer = layer => {
    if (!canvas) return;
    const preview = layer.preview;
    if (!preview) { placeStandIn(layer); return; }
    if (preview.svgString) {
      fabric.loadSVGFromString(preview.svgString).then(result => {
        if (!result || !result.objects || !result.objects.length) return;
        const group = fabric.util.groupSVGElements(result.objects, result.options);
        const scale = 170 / group.width;
        group.set({left: 230, top: 250, scaleX: scale, scaleY: scale});
        styleArt(group); group._layerId = layer.artFileId;
        canvas.add(group); canvas.setActiveObject(group); canvas.renderAll();
      }).catch(() => addImg(preview.url, layer));
      return;
    }
    addImg(preview.url, layer);
  };

  const addImg = (url, layer) => {
    // Proxy through image-proxy so cross-origin art can be drawn to (and exported from) the canvas.
    const tryLoad = () => {
      const el = new Image(); el.crossOrigin = 'anonymous';
      el.onload = () => {
        const img = new fabric.FabricImage(el);
        const scale = 150 / img.width;
        img.set({left: 230, top: 250, scaleX: scale, scaleY: scale});
        styleArt(img); img._layerId = layer.artFileId;
        canvas.add(img); canvas.setActiveObject(img); canvas.renderAll();
      };
      return el;
    };
    const proxied = tryLoad();
    proxied.onerror = () => { const direct = tryLoad(); direct.onerror = () => { nf && nf('Could not render that art — placed a stand-in you can position', 'error'); placeStandIn(layer); }; direct.src = url; };
    proxied.src = /^data:/.test(url) ? url : ('/.netlify/functions/image-proxy?url=' + encodeURIComponent(url));
  };

  const uploadLayerFile = useCallback(async (idx, file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
    const isSvg = ext === 'svg';
    const isVectorDoc = ['ai', 'eps', 'pdf'].includes(ext);
    setBusy(true);
    try {
      nf && nf('Uploading ' + file.name + '...');
      const url = await fileUpload(file, 'nsa-art-requests');
      const source = {name: file.name, url, size: file.size, type: file.type};
      let preview = null;
      if (isSvg) { const svgString = await file.text(); preview = {url, svgString}; }
      else if (isImg) { preview = {url}; }
      else if (isVectorDoc) { const png = _cloudinaryPdfThumb(url); if (png) preview = {url: png}; }
      setLayers(prev => prev.map((l, i) => i === idx ? {...l, source, preview, hasExisting: l.hasExisting} : l));
      nf && nf(file.name + ' attached' + (preview ? (isVectorDoc ? ' — generating a preview to place' : '') : ' (a stand-in will be placed on the mock)'));
    } catch (e) {
      nf && nf('Upload failed: ' + e.message, 'error');
    } finally { setBusy(false); }
  }, [nf]);

  const uploadGarmentImg = useCallback(async file => {
    setBusy(true);
    try {
      nf && nf('Uploading product image...');
      const url = await fileUpload(file, 'nsa-products');
      setImgOverride(prev => ({...prev, [garment.key]: url}));
    } catch (e) { nf && nf('Upload failed: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }, [garment.key, nf]);

  const saveColorMock = useCallback(async () => {
    if (!canvas) return;
    if (!canvas.getObjects().some(o => o._isArt)) { nf && nf('Place at least one art layer before saving', 'error'); return; }
    setBusy(true);
    try {
      const dataUrl = canvas.toDataURL({format: 'png', multiplier: 2});
      const blob = await (await fetch(dataUrl)).blob();
      const fname = 'mock-' + (garment.sku || 'item') + '-' + (garment.color || 'default') + '-' + side + '.png';
      const fileObj = new File([blob], fname, {type: 'image/png'});
      const url = await fileUpload(fileObj, 'nsa-mockups');
      const entry = {url, name: fname, sku: garment.sku};
      setMocks(prev => {
        const cur = (prev[garment.key] || []).filter(m => m.name !== fname);
        return {...prev, [garment.key]: [...cur, entry]};
      });
      nf && nf('Mockup saved for ' + (garment.color || garment.sku));
    } catch (e) { nf && nf('Could not save mockup: ' + e.message, 'error'); }
    finally { setBusy(false); }
  }, [canvas, garment, side, nf]);

  const handleDone = () => {
    const filesByLocation = {};
    // Only newly uploaded files get appended — art already on the artwork stays as-is.
    layers.forEach(l => { if (l.source && l.artFileId) filesByLocation[l.artFileId] = [...(filesByLocation[l.artFileId] || []), l.source]; });
    onSave({mocksByGarment: mocks, filesByLocation});
  };

  const savedCount = Object.values(mocks).filter(a => (a || []).length > 0).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth: 940, width: '95%'}} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', color: 'white'}}>
          <h2 style={{color: 'white', margin: 0}}>Quick Mock Builder</h2>
          <button className="modal-close" style={{color: 'white'}} onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{maxHeight: '78vh', overflowY: 'auto'}}>
          <div style={{fontSize: 12, color: '#64748b', marginBottom: 12}}>
            Drop your vector/art onto the garment and drag the handles to size and position it. Build a mockup for each garment color — the coach reviews these, skipping the artist on the mockup phase. Your source files stay attached to each artwork for the artist's separation work later.
          </div>

          {garments.length > 1 && <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12}}>
            {garments.map((g, i) => <button key={g.key} className={`btn btn-sm ${i === gi ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 11}}
              onClick={() => setGi(i)}>{g.color || g.sku}{(mocks[g.key] || []).length > 0 && <span style={{marginLeft: 4}}>✓</span>}</button>)}
          </div>}

          <div style={{display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16}}>
            <div>
              <div style={{fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6}}>Art Locations</div>
              {layers.map((l, idx) => <div key={l.artFileId || idx} style={{padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 8, background: '#fff'}}>
                <div style={{fontSize: 12, fontWeight: 700, color: '#1e293b'}}>{l.name || 'Artwork'}</div>
                {l.position && <div style={{fontSize: 10, color: '#94a3b8', marginBottom: 4}}>{l.position}</div>}
                {l.source ? <div style={{fontSize: 10, color: '#166534', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6}}>
                  <Icon name="check" size={12} /> {l.source.name}{!l.preview && <span style={{color: '#d97706'}}>(stand-in)</span>}
                </div> : l.hasExisting ? <div style={{fontSize: 10, color: '#166534', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6}}>
                  <Icon name="check" size={12} /> Using art on file{l.existingFiles[0] ? ': ' + l.existingFiles[0].name : ''}{!l.preview && <span style={{color: '#d97706'}}> (stand-in)</span>}
                </div> : <div style={{fontSize: 10, color: '#94a3b8', marginBottom: 6}}>No file yet</div>}
                <div style={{display: 'flex', gap: 4}}>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} disabled={busy}
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.png,.jpg,.jpeg,.svg,.ai,.eps,.pdf'; inp.onchange = () => { if (inp.files[0]) uploadLayerFile(idx, inp.files[0]); }; inp.click(); }}>
                    <Icon name="upload" size={11} /> {(l.source || l.hasExisting) ? 'Replace' : 'Upload'}
                  </button>
                  <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} disabled={busy} onClick={() => placeLayer(l)}>
                    <Icon name="plus" size={11} /> Place
                  </button>
                </div>
              </div>)}
              {layers.length === 0 && <div style={{fontSize: 11, color: '#94a3b8'}}>No art locations on this job.</div>}

              <div style={{marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0'}}>
                <div style={{fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4}}>Product Image</div>
                {garmentUrl ? <div style={{fontSize: 10, color: '#166534'}}>Using catalog image</div>
                  : <div style={{fontSize: 10, color: '#d97706', marginBottom: 4}}>Not in system — upload one</div>}
                <button className="btn btn-sm btn-secondary" style={{fontSize: 10, marginTop: 4}} disabled={busy}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { if (inp.files[0]) uploadGarmentImg(inp.files[0]); }; inp.click(); }}>
                  <Icon name="upload" size={11} /> Upload Product Image
                </button>
              </div>
            </div>

            <div>
              <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap'}}>
                <span style={{fontSize: 12, fontWeight: 700, color: '#1e293b'}}>{garment.name || garment.sku} — {garment.color || 'Default'}</span>
                {garment.backUrl && <div style={{display: 'flex', gap: 2}}>
                  <button className={`btn btn-sm ${side === 'front' ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 10}} onClick={() => setSide('front')}>Front</button>
                  <button className={`btn btn-sm ${side === 'back' ? 'btn-primary' : 'btn-secondary'}`} style={{fontSize: 10}} onClick={() => setSide('back')}>Back</button>
                </div>}
                <button className="btn btn-sm btn-secondary" style={{fontSize: 10}} title="Delete selected" onClick={() => { if (!canvas) return; const sel = canvas.getActiveObject(); if (sel && sel._isArt) { canvas.remove(sel); canvas.discardActiveObject(); canvas.renderAll(); } else nf && nf('Select an art element to delete', 'error'); }}>
                  <Icon name="trash" size={11} /> Delete
                </button>
                <button className="btn btn-sm btn-primary" style={{fontSize: 10, marginLeft: 'auto'}} disabled={busy} onClick={saveColorMock}>
                  <Icon name="save" size={11} /> Save Mock for {garment.color || garment.sku}
                </button>
              </div>
              <div style={{display: 'flex', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, padding: 12}}>
                <div ref={wrapRef} />
              </div>
              <div style={{fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'center'}}>Click art to select. Drag to move, corners to resize. Press Delete to remove.</div>
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <span style={{fontSize: 11, color: savedCount > 0 ? '#166534' : '#94a3b8', fontWeight: 600}}>
            {savedCount} of {garments.length} color{garments.length === 1 ? '' : 's'} mocked
          </span>
          <button className="btn btn-primary" style={{marginLeft: 'auto', background: '#166534', borderColor: '#166534'}} disabled={savedCount === 0 || busy} onClick={handleDone}>Done — Attach Mockups</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
