/* eslint-disable */
import fs from 'fs';
import path from 'path';

describe('PO Written to resolves stored vendor ids', () => {
  test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const poVendorLookup = "vendorList.find(v=>v.id===po.vendor)";
    const nameLine = src.split('\n').find((line) =>
      line.includes("const _vName=po.po_type==='outside_deco'")
    );

    expect(src).toContain(poVendorLookup);
    expect(nameLine).toBeDefined();
    expect(nameLine).toContain("_poVendorRec?.name||_vRec?.name");
    expect(nameLine).toContain("D_V.find(v=>v.id===(po.vendor||item?.vendor_id))?.name");
    expect(nameLine).toContain("||po.vendor||");

    // A stored id such as ns_34 must never win before its resolved vendor name.
    expect(nameLine.indexOf('_poVendorRec?.name')).toBeLessThan(nameLine.indexOf('||po.vendor||'));
    expect(src).not.toContain(":(po.vendor||_vRec?.name");
  });
});
