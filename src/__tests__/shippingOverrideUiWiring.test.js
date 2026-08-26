
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
});