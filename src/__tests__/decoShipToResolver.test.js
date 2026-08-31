
import { resolveDecoShipToClient } from '../lib/botTasks';

const decoVendors = [{
  id: 'dv_screen', name: 'Screen House', address_line1: '10 Print Way', address_line2: 'Dock 2',
  city: 'Orange', state: 'CA', zip: '92865', phone: '555-0100',
}];

describe('resolveDecoShipToClient', () => {
  test('an explicitly selected IF DPO wins over the first DPO for that decorator', () => {
    const so = { deco_pos: [
      { po_id: 'DPO 100 TEAM', deco_vendor_id: 'dv_screen', item_idxs: [0] },
      { po_id: 'DPO 200 TEAM', deco_vendor_id: 'dv_screen', item_idxs: [1] },
    ] };
    expect(resolveDecoShipToClient({ decoId: 'dv_screen', decoPoId: 'DPO 200 TEAM', so, decoVendors, vendors: [] }))
      .toEqual({ name: 'Screen House', attention: 'DPO 200 TEAM', line1: '10 Print Way', line2: 'Dock 2', city: 'Orange', state: 'CA', zip: '92865', phone: '555-0100' });
  });

  test('falls back to the linked vendor address without losing the selected DPO attention', () => {
    const dvs = [{ id: 'dv_emb', name: 'Embroidery Co', vendor_id: 'v1' }];
    const vendors = [{ id: 'v1', address_line1: '20 Needle Rd', city: 'Anaheim', state: 'CA', zip: '92801', contact_phone: '555-0200' }];
    const so = { deco_pos: [{ po_id: 'DPO 300 CLUB', deco_vendor_id: 'dv_emb' }] };
    expect(resolveDecoShipToClient({ decoId: 'dv_emb', decoPoId: 'DPO 300 CLUB', so, decoVendors: dvs, vendors }))
      .toEqual(expect.objectContaining({ attention: 'DPO 300 CLUB', line1: '20 Needle Rd', phone: '555-0200' }));
  });
});