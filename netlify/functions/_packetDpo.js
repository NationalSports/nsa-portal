const { jsPDF } = require('jspdf');
const list = value => Array.isArray(value) ? value : [];
const clean = value => String(value || '').trim();
function resolveDpos(orders, decorators, vendors) {
  return orders.flatMap(so => list(so.deco_pos).filter(dp => dp.po_id && !['cancelled','void'].includes(dp.status)).map(dp => {
    const decorator = decorators.find(d => d.id === dp.deco_vendor_id) || decorators.find(d => d.name === dp.vendor);
    const vendor = vendors.find(v => v.id === decorator?.vendor_id);
    return { id: dp.id || dp.po_id, soId: so.id, number: dp.po_id, vendor: dp.vendor || decorator?.name || vendor?.name || '',
      email: clean(dp.contact_email || dp.email || vendor?.contact_email), dp, so };
  }));
}
// A dated copy of the selected DPO, built from its saved terms and covered SO lines.
async function dpoPdf(entry) {
  const doc = new jsPDF({unit:'pt',format:'letter'});
  let y = 48;
  const room = height => {if(y + height > 740){doc.addPage();y=48;}};
  const line = (value, strong=false, size=11) => {
    doc.setFont('helvetica',strong?'bold':'normal');doc.setFontSize(size);doc.setTextColor(20,46,59);
    const text = String(value ?? '').replace(/[^\x20-\x7e\n]/g, ' ');
    const rows = doc.splitTextToSize(text,510);
    for(const row of rows) { if(y > 740){doc.addPage();y=48;} doc.text(row,48,y);y+=size+6; }
  };
  const {dp,so} = entry;
  line('NATIONAL SPORTS APPAREL',true,12);
  line('DECORATION PURCHASE ORDER',true,18);
  line(entry.number,true,15);
  line(`${entry.vendor} | ${so.id}`);
  line(`Status: ${dp.status || 'Waiting'} | Expected return: ${dp.expected_date || 'Not specified'}`);
  line(`Saved DPO quantity: ${dp.qty ?? 'Not specified'} | Unit cost: $${Number(dp.unit_cost || 0).toFixed(2)}`);
  line(`Expected cost: $${Number(dp.expected_cost ?? Number(dp.qty || 0)*Number(dp.unit_cost || 0)).toFixed(2)}`);
  line(`Reference generated: ${new Date().toISOString()}`);
  y += 12;
  line('ITEMS ON THIS DPO',true,13);
  const covered = list(dp.item_idxs).map(index => list(so.items).find(it => it.item_index === index)).filter(Boolean);
  for (const it of covered) {
    room(80);
    line(`${it.sku || ''} - ${it.name || ''} - ${it.color || ''}`,true);
    line(Object.entries(it.sizes || {}).map(([size,qty]) => `${size}: ${qty}`).join(' | '));
    const rate = dp.item_costs?.[it.item_index] ?? dp.unit_cost;
    if (rate != null) line(`Decoration rate: $${Number(rate).toFixed(2)}`);
    y += 6;
  }
  if (!covered.length) line('No garment lines are assigned to this DPO.');
  room(90);
  line('DPO NOTES',true,13); line(dp.notes || 'No notes saved on this DPO.');
  line('Use the linked production packet for current artwork, mocks, player details and shared instructions.');
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
module.exports = { resolveDpos, dpoPdf };
