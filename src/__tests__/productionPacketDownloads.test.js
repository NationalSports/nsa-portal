import { validatePacketImages, createProductionFileManifest } from '../productionPacket/download';

test('image validator rejects broken, timed out, and undecodable images with their source', async () => {
  const broken = { complete: true, naturalWidth: 0, src: 'broken.png' };
  await expect(validatePacketImages([broken])).rejects.toThrow('broken.png');
  const pending = { complete: false, src: 'slow.png', addEventListener() {} };
  await expect(validatePacketImages([pending], { timeoutMs: 1 })).rejects.toThrow('Timed out loading packet image: slow.png');
  const decoded = { complete: true, naturalWidth: 3 };
  await expect(validatePacketImages([decoded])).resolves.toEqual([undefined]);
});

test('production file manifest groups downloadable decoration and message files', () => {
  expect(createProductionFileManifest({ decorations: [{ soId: 'SO-9', sku: 'TEE', position: 'Front', productionFiles: [{ name: 'art.dst', url: '/art.dst' }] }], messages: [{ soId: 'SO-9', kind: 'action', attachments: [{ name: 'proof.pdf', url: '/proof.pdf' }] }] })).toEqual({ 'SO-9 · TEE · Front': [{ name: 'art.dst', url: '/art.dst' }], 'SO-9 · action': [{ name: 'proof.pdf', url: '/proof.pdf' }] });
});
