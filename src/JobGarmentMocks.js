import React, { useRef, useState } from 'react';
import GarmentMockCard, { MockCoversTable } from './GarmentMockCard';
import { jobMockCardGroups } from './lib/jobMockCards';
import { logoDetailUrl, logoDetailBg, setLogoDetail, removeLogoDetail } from './lib/logoDetail';
import { safeArt, safeNum, safeSizes, garmentMockKey, mockSkuOf, slotMockFiles, adoptArtProofAsGarmentMock, removeGarmentSlotMock, resolveMockLink, mockLinkSourceFiles, applyMockLink } from './safeHelpers';
import { fileUpload, openFile, _isImgUrl } from './utils';

const sizesOf = (gi, item) => gi?.sizes ? { ...gi.sizes }
  : Object.fromEntries(Object.entries(safeSizes(item)).filter(([, v]) => safeNum(v) > 0).map(([sz, v]) => [sz, safeNum(v)]));
const garmentLabel = item => [mockSkuOf(item), item.color].filter(Boolean).join(' · ');

// Garment mocks for a job. With itemIdx it renders just that garment's mock, embedded in the
// garment's own card on the job page; without it, a standalone panel for every garment.
// Garments linked to one shared mock collapse into the source garment's card, which lists every
// covered garment's quantities underneath.
export default function JobGarmentMocks({ job, order, priorMocks, getOrder, onSave, itemIdx = null }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const allGroups = jobMockCardGroups(job, order, priorMocks);
  const embedded = itemIdx != null;
  const groups = embedded ? allGroups.filter(g => g.gi.item_idx === itemIdx) : allGroups;
  if (!groups.length) return null;
  const jobArts = [...new Set(allGroups.flatMap(g => g.slots.map(s => s.artFile)).filter(Boolean))];
  const linkOf = g => resolveMockLink(jobArts, mockSkuOf(g.item), g.item.color || '');
  const inJob = key => allGroups.some(g => garmentMockKey(g.item) === key);
  const dependentsOf = g => allGroups.filter(o => o !== g && linkOf(o) === garmentMockKey(g.item));
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
  const logoFor = (slot, item) => slot.kind !== 'art' ? null : {
    url: logoDetailUrl(slot.artFile, slot.cwId), bg: logoDetailBg(item.color), colorName: item.color,
    onUpload: files => run(async () => {
      const url = await fileUpload(files[0], 'nsa-web-logos');
      return onSave(setLogoDetail(liveArts(slot.artId), slot.artId, slot.cwId, { url, name: files[0].name }), 'Logo detail');
    }),
    onRemove: url => run(() => onSave(removeLogoDetail(liveArts(slot.artId), slot.artId, url), 'Logo detail removed')),
  };
  const body = groups.map(g => {
    const { item, slots, allSlots } = g;
    const linked = linkOf(g);
    // Standalone panel: a garment sharing another job garment's mock is shown inside that card.
    if (linked && !embedded && inJob(linked)) return null;
    const deps = linked ? [] : dependentsOf(g);
    const heading = !embedded && <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{[mockSkuOf(item), item.name, item.color].filter(Boolean).join(' · ')}</h4>;
    if (linked) {
      const src = mockLinkSourceFiles(jobArts, linked);
      const f = src[0];
      const url = typeof f === 'string' ? f : f?.url || '';
      return <div key={garmentMockKey(item)} style={{ marginTop: embedded ? 0 : 12 }}>
        {heading}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8 }}>
          {url && _isImgUrl(url) ? <img src={url} alt="" onClick={() => openFile(url)} style={{ width: 64, height: 64, objectFit: 'contain', background: '#fff', borderRadius: 6, border: '1px solid #c7d2fe', cursor: 'zoom-in', flexShrink: 0 }} />
            : <div style={{ width: 64, height: 64, borderRadius: 6, border: '1px dashed #a5b4fc', background: '#fff', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#3730a3' }}>🔗 Shares the mock from {linked.replace('|', ' · ')}</div>
            <div style={{ fontSize: 11, color: src.length ? '#64748b' : '#b45309' }}>{src.length ? 'One mock covers both garments — approval uses it for this one too.' : 'Waiting on that garment’s mock.'}</div>
          </div>
          <button type="button" disabled={busy} style={{ border: '1px solid #c7d2fe', borderRadius: 7, background: '#fff', color: '#3730a3', fontSize: 11, fontWeight: 600, padding: '6px 10px', cursor: 'pointer', flexShrink: 0 }}
            onClick={() => run(() => onSave(jobArts.reduce((all, a) => applyMockLink(all, a.id, garmentMockKey(item), null), safeArt(getOrder())), 'Mock link removed'))}>Give it its own mock</button>
        </div>
      </div>;
    }
    const covers = deps.length > 0 && <MockCoversTable rows={[g, ...deps].map(x => ({ key: garmentMockKey(x.item), label: garmentLabel(x.item), sizes: sizesOf(x.gi, x.item) }))} />;
    return <div key={garmentMockKey(item)} style={{ marginTop: embedded ? 0 : 12 }}>
      {heading}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{slots.map((slot, si) => <GarmentMockCard
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
      >{slots.length === 1 && si === 0 ? covers : null}</GarmentMockCard>)}</div>
      {slots.length > 1 && covers && <div className="garment-mock-card" style={{ marginTop: 12 }}>{covers}</div>}
    </div>;
  });
  const errorLine = error && <p role="alert" style={{ color: '#b91c1c', fontSize: 12, margin: '6px 0' }}>{error}</p>;
  if (embedded) return <div aria-label="Garment mock" style={{ margin: '12px 14px 14px' }}>{errorLine}{body}</div>;
  return <section aria-label="Job garment mocks" style={{ margin: '16px 20px', padding: 16, border: '1px solid #dbe2ea', borderRadius: 12, background: '#f8fafc' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Garment mocks</h3>
    <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>Each garment needs its mock and a logo detail (transparent PNG). Approval stays a separate step.</p>
    {errorLine}
    {body}
  </section>;
}
