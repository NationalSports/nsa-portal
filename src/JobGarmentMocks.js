import React, { useRef, useState } from 'react';
import GarmentMockCard, { MockCoversTable } from './GarmentMockCard';
import JobGarmentProgress, { garmentProgress, GarmentDecorationSpecs } from './JobGarmentProgress';
import { jobMockCardGroups } from './lib/jobMockCards';
import { logoDetailUrl, logoDetailBackground, cwGarmentColor, setLogoDetail, removeLogoDetail } from './lib/logoDetail';
import { safeArt, safeNum, safeSizes, garmentMockKey, mockSkuOf, slotMockFiles, adoptArtProofAsGarmentMock, removeGarmentSlotMock, resolveMockLink, mockLinkSourceFiles, applyMockLink } from './safeHelpers';
import { fileUpload, openFile, _isImgUrl } from './utils';

const sizesOf = (gi, item) => gi?.sizes ? { ...gi.sizes }
  : Object.fromEntries(Object.entries(safeSizes(item)).filter(([, v]) => safeNum(v) > 0).map(([sz, v]) => [sz, safeNum(v)]));
const garmentLabel = item => [mockSkuOf(item), item.color].filter(Boolean).join(' · ');

// Garment mocks for a job: one block per garment with its mock (+ logo detail) and its quantity /
// received / shipped row. Garments linked to one shared mock collapse into ONE block — the source
// garment's mock, then a single table listing every covered garment's SKU and sizes.
export default function JobGarmentMocks({ job, order, priorMocks, getOrder, onSave, itemDetails = [], onViewItem }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const groups = jobMockCardGroups(job, order, priorMocks);
  const progress = garmentProgress(job, order, itemDetails);
  progress.forEach(g => { if (!groups.some(group => garmentMockKey(group.item) === g.key)) groups.push({ item: g.item, slots: [], allSlots: [] }); });
  if (!groups.length) return null;
  const summaryOf = g => progress.find(p => p.key === garmentMockKey(g.item));
  const jobArts = [...new Set(groups.flatMap(g => g.slots.map(s => s.artFile)).filter(Boolean))];
  const linkOf = g => resolveMockLink(jobArts, mockSkuOf(g.item), g.item.color || '');
  const inJob = key => groups.some(g => garmentMockKey(g.item) === key);
  const dependentsOf = g => groups.filter(o => o !== g && linkOf(o) === garmentMockKey(g.item));
  const run = async action => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { const ok = await action(); if (!ok) setError('Mock changes are not saved yet. Please retry or save the order.'); return ok; }
    catch (e) { setError(e.message || 'Could not save this mock. Please try again.'); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const liveArts = artId => {
    const arts = safeArt(getOrder());
    if (!arts.some(a => a.id === artId)) throw new Error('This artwork was removed. Reopen the job to continue.');
    return arts;
  };
  const useFiles = (slot, files) => onSave(files.reduce((arts, file) => adoptArtProofAsGarmentMock(arts, slot.artId, slot.key,
    { ...(typeof file === 'string' ? { url: file } : file), art_file_id: slot.artId }), liveArts(slot.artId)), 'Garment mock');
  const logoFor = (slot, item) => { if (slot.kind !== 'art') return null; const b = logoDetailBackground(item.color, cwGarmentColor(slot.artFile, slot.cwId)); return {
    url: logoDetailUrl(slot.artFile, slot.cwId), bg: b.bg, bgKnown: b.known, colorName: b.label,
    onUpload: files => run(async () => {
      const url = await fileUpload(files[0], 'nsa-web-logos');
      return onSave(setLogoDetail(liveArts(slot.artId), slot.artId, slot.cwId, { url, name: files[0].name }), 'Logo detail');
    }),
    onRemove: url => run(() => onSave(removeLogoDetail(liveArts(slot.artId), slot.artId, url), 'Logo detail removed')),
  }; };
  const coverRow = x => {
    const s = summaryOf(x);
    return { key: garmentMockKey(x.item), label: garmentLabel(x.item), sizes: s ? s.sizes : sizesOf(x.gi, x.item),
      ...(s ? { received: s.received, shipped: s.shipped } : {}),
      ...(s && onViewItem ? { onView: () => onViewItem([...s.lines][0]) } : {}) };
  };
  return <section aria-label="Job garment mocks" style={{ margin: '16px 20px', padding: 16, border: '1px solid #dbe2ea', borderRadius: 12, background: '#f8fafc' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Garment mocks</h3>
    <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>Each garment needs its mock and a logo detail (transparent PNG). Approval stays a separate step.</p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {groups.map(g => {
      const { item, slots, allSlots } = g;
      const linked = linkOf(g);
      // A garment sharing another job garment's mock is listed inside that garment's block.
      if (linked && inJob(linked)) return null;
      const deps = linked ? [] : dependentsOf(g);
      const summary = summaryOf(g);
      return <div key={garmentMockKey(item)} style={{ marginTop: 12 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{[mockSkuOf(item), item.name, item.color].filter(Boolean).join(' · ')}
          {deps.length > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#3730a3' }}>🔗 + {deps.map(d => garmentLabel(d.item)).join(', ')}</span>}</h4>
        {linked ? (() => {
          const src = mockLinkSourceFiles(jobArts, linked);
          const f = src[0];
          const url = typeof f === 'string' ? f : f?.url || '';
          return <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8 }}>
            {url && _isImgUrl(url) ? <img src={url} alt="" onClick={() => openFile(url)} style={{ width: 64, height: 64, objectFit: 'contain', background: '#fff', borderRadius: 6, border: '1px solid #c7d2fe', cursor: 'zoom-in', flexShrink: 0 }} />
              : <div style={{ width: 64, height: 64, borderRadius: 6, border: '1px dashed #a5b4fc', background: '#fff', flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#3730a3' }}>🔗 Shares the mock from {linked.replace('|', ' · ')}</div>
            <button type="button" disabled={busy} style={{ border: '1px solid #c7d2fe', borderRadius: 7, background: '#fff', color: '#3730a3', fontSize: 11, fontWeight: 600, padding: '6px 10px', cursor: 'pointer', flexShrink: 0 }}
              onClick={() => run(() => onSave(jobArts.reduce((all, a) => applyMockLink(all, a.id, garmentMockKey(item), null), safeArt(getOrder())), 'Mock link removed'))}>Give it its own mock</button>
          </div>;
        })() : slots.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{slots.map(slot => <GarmentMockCard
          key={slot.artId + '|' + slot.key} label={slot.label} sub={slot.sub}
          mocks={slotMockFiles(slot, allSlots, item)} candidates={slot.candidates} suggest busy={busy}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          uploadLabel="Upload mock image"
          logo={logoFor(slot, item)}
          onUse={file => run(() => useFiles(slot, [file]))}
          onRemove={url => run(() => onSave(removeGarmentSlotMock(safeArt(getOrder()), slot, allSlots, item, url), 'Mock removed'))}
          onUpload={files => run(async () => {
            if (files.some(f => !/\.(png|jpe?g|webp|gif|pdf)$/i.test(f.name))) throw new Error('Choose an image or PDF for the garment mock.');
            const uploaded = await Promise.all(files.map(async f => ({ url: await fileUpload(f, 'nsa-mockups'), name: f.name })));
            return useFiles(slot, uploaded);
          })}
        />)}</div>}
        {deps.length > 0 ? <>
          <div className="garment-mock-card" style={{ marginTop: 12 }}><MockCoversTable rows={[g, ...deps].map(coverRow)} /></div>
          {summary && <div style={{ display: 'flex', padding: '12px 4px 0' }}><GarmentDecorationSpecs specs={Array.from(summary.specs || [])} /></div>}
        </> : <JobGarmentProgress summary={summary} onViewItem={onViewItem} />}
      </div>;
    })}
  </section>;
}
