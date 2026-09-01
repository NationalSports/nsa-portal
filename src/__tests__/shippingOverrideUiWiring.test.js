
/* eslint-disable */
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

describe('shipping override UI wiring', () => {
  test.each(['OrderEditor.js', 'OrderEditorClassic.js'])(
    '%s exposes the Sales Order action and IF DPO selector',
    (file) => {
      const src = read(file);
      expect(src).toContain('onManualShip');
      expect(src).toContain('⚡ Ship Items / Override');
      expect(src).toContain('DPO for this shipment');
      expect(src).toContain('deco_po_id:');
      expect(src).toContain('attention:');
    },
  );

  test('App connects the Sales Order action to the warehouse override modal', () => {
    const src = read('App.js');
    expect(src).toContain('onManualShip={openManualShipForSO}');
    expect(src).toContain('setManualShipModal(manualShipStateForSO(so,c2))');
  });

  test('warehouse override search accepts an SO number and includes completed orders with work left', () => {
    const src = read('App.js');
    expect(src).toContain('Type sales order #, club, or customer...');
    expect(src).toContain('unshippedOrderItems(so).length>0||soHasOpenShipWork(so)');
    expect(src).not.toContain("if(st==='complete')return false");
  });

  // A finished order is exactly the one whose shipping cost nobody recorded: status
  // 'complete' is hidden from every warehouse queue, so the override search is the only
  // route back to it. Gating that search on "still owes a shipment" put 511 charged
  // orders out of reach. These guard the two halves of the fix — reachable, and
  // recordable once reached.
  test('an explicit search reaches any order, not only ones that still owe a shipment', () => {
    const src = read('App.js');
    // Search and the per-customer list filter on recordability, not on open ship work.
    expect(src).toContain('const _isRecordable=so=>!so.deleted_at;');
    expect(src).toContain('if(!_isRecordable(so))return false');
    // Browsing still leads with the orders that actually owe a shipment.
    expect(src).toContain('.sort((a,b)=>(_canOverride(b)?1:0)-(_canOverride(a)?1:0))');
    expect(src).toContain('.sort((a,b)=>(_custOpen(b)?1:0)-(_custOpen(a)?1:0))');
    // The rep can tell the two cases apart before clicking.
    expect(src).toContain('nothing left to ship — record cost');
    expect(src).toContain('record cost');
  });

  test('a cost alone is a valid record on an order with nothing left to ship', () => {
    const src = read('App.js');
    expect(src).toContain('const _nothingLeft=(manualShipModal.availItems||[]).length===0;');
    expect(src).toContain('const _costOnly=');
    // The cost-only record carries its own line, so no empty shipment is written.
    expect(src).toContain("name:'Shipping cost recorded after the fact'");
    // The error names the way out instead of demanding an item that does not exist.
    expect(src).toContain('Enter the shipping cost to record it against this order');
    // cost must be computed before _costOnly consults it. Scope the search to the
    // against-an-order handler: the no-SO branch has its own `cost` earlier in the file,
    // and a bare indexOf would find that one and pass no matter where this one sits.
    const start = src.indexOf('const hasSelectedItems=');
    const end = src.indexOf('const _costOnly=');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).toContain('const cost=parseFloat(manualShipModal.cost)||0;');
  });
});