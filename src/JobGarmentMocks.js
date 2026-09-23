import React, { useRef, useState } from 'react';
import GarmentMockCard from './GarmentMockCard';
import { jobMockCardGroups } from './lib/jobMockCards';
import { safeArt, garmentMockKey, mockSkuOf, slotMockFiles, adoptArtProofAsGarmentMock, removeGarmentSlotMock, resolveMockLink, mockLinkSourceFiles, applyMockLink } from './safeHelpers';
import { fileUpload, openFile } from './utils';

export default function JobGarmentMocks({ job, order, priorMocks, getOrder, onSave }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const groups = jobMockCardGroups(job, order, priorMocks);
  if (!groups.length) return null;
  const run = async action => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { const ok = await action(); if (!ok) setError('Mock changes are not saved yet. Please retry or save the order.'); return ok; }
    catch (e) { setError(e.message || 'Could not save this mock. Please try again.'); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const useFiles = (slot, files) => {
    const live = getOrder();
    if (!safeArt(live).some(a => a.id === slot.artId)) throw new Error('This artwork was removed. Reopen the job to continue.');
    return onSave(files.reduce((arts, file) => adoptArtProofAsGarmentMock(arts, slot.artId, slot.key, file), safeArt(live)), 'Garment mock');
  };
  return <section aria-label="Job garment mocks" style={{ margin: '16px 20px', padding: 16, border: '1px solid #dbe2ea', borderRadius: 12, background: '#f8fafc' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Garment mocks</h3>
    <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>Choose an existing image or upload a mock. Check the garment, color and placement. Approval stays a separate step.</p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {groups.map(({ item, slots, allSlots }) => {
      const arts = [...new Set(slots.map(s => s.artFile))];
      const linked = resolveMockLink(arts, mockSkuOf(item), item.color || '');
      return <div key={garmentMockKey(item)} style={{ marginTop: 12 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{[mockSkuOf(item), item.name, item.color].filter(Boolean).join(' · ')}</h4>
        {linked ? <div style={{ padding: 12, background: '#eef2ff', borderRadius: 8 }}>
          <p>Uses the mock from {linked.replace('|', ' · ')}</p>
          {mockLinkSourceFiles(arts, linked).map(f => <button type="button" key={typeof f === 'string' ? f : f.url} onClick={() => openFile(typeof f === 'string' ? f : f.url)}>View linked mock</button>)}
          <button type="button" disabled={busy} onClick={() => run(() => onSave(arts.reduce((all, a) => applyMockLink(all, a.id, garmentMockKey(item), null), safeArt(getOrder())), 'Mock link removed'))}>Use a different mock</button>
        </div> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{slots.map(slot => <GarmentMockCard
          key={slot.artId + '|' + slot.key} label={slot.label} sub={slot.sub}
          mocks={slotMockFiles(slot, allSlots, item)} candidates={slot.candidates} suggest busy={busy}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          onUse={file => run(() => useFiles(slot, [file]))}
          onRemove={url => run(() => onSave(removeGarmentSlotMock(safeArt(getOrder()), slot, allSlots, item, url), 'Mock removed'))}
          onUpload={files => run(async () => {
            if (files.some(f => !/\.(png|jpe?g|webp|gif|pdf)$/i.test(f.name))) throw new Error('Choose an image or PDF for the garment mock.');
            const uploaded = await Promise.all(files.map(async f => ({ url: await fileUpload(f, 'nsa-mockups'), name: f.name })));
            return useFiles(slot, uploaded);
          })}
        />)}</div>}
      </div>;
    })}
  </section>;
}
