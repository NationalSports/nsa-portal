import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobGarmentProgress, { sizeProgressCell, GarmentDecorationSpecs, garmentProgress } from '../JobGarmentProgress';

test.each([
  [6,0,0,'Waiting','6','#fef3c7'],
  [6,6,0,'Received','6','#dcfce7'],
  [6,2,0,'Part received','2/6','linear-gradient'],
  [6,0,2,'Part shipped','2/6','linear-gradient'],
  [6,6,2,'Part shipped','2/6','linear-gradient'],
  [6,6,6,'Shipped','6','#dbeafe'],
])('quantity %s received %s shipped %s has readable status and color', (qty,received,shipped,status,label,bg) => {
  expect(sizeProgressCell(qty,received,shipped)).toMatchObject({status,label});
  expect(sizeProgressCell(qty,received,shipped).background).toContain(bg);
});
test('split fill is proportional, caps overcounts and never displays negative counts', () => {
  const part=sizeProgressCell(4,0,1);
  expect(part.background).toContain('#dbeafe 25%');
  expect(part.background).toContain('#fef3c7 25%');
  expect(sizeProgressCell(4,99,99)).toMatchObject({label:'4',status:'Shipped'});
  expect(sizeProgressCell(4,-1,-2)).toMatchObject({label:'4',status:'Waiting'});
});
test('renders Sales Order-style size headers, quantity boxes, status tiles and accessible counts', () => {
  const summary={total:7,sizes:{M:1,XS:2,S:4},received:{XS:2,S:2},shipped:{S:1},receivedTotal:4,shippedTotal:1,specs:new Set(),lines:new Set([0])};
  const html=renderToStaticMarkup(<JobGarmentProgress summary={summary}/>);
  expect(html).toContain('XS: QTY 2 · Received 2/2 · Shipped 0/2. Received');
  expect(html).toContain('S: QTY 4 · Received 2/4 · Shipped 1/4. Part shipped');
  expect(html).toContain('M: QTY 1 · Received 0/1 · Shipped 0/1. Waiting');
  expect(html.indexOf('XS:')).toBeLessThan(html.indexOf('S: QTY 4'));
  expect(html).toContain('1/4');
  expect(html).not.toContain('>Received <strong>');
  expect(html).not.toContain('>Shipped <strong>');
});

test('decoration specs are visible labeled fields, not collapsed text or invented units', () => {
  const html=renderToStaticMarkup(<GarmentDecorationSpecs specs={[{name:'SJM logo 3in',method:'embroidery',placement:'Left Chest',size:'3',colorLabel:'Thread colors',colors:'Navy, Red'}]}/>);
  expect(html).not.toContain('<details');
  for(const text of ['SJM logo 3in','embroidery','Placement','Left Chest','Art size','Thread colors','Navy','Red']) expect(html).toContain(text);
  expect(html).not.toContain('3 inches');
  expect(renderToStaticMarkup(<GarmentDecorationSpecs specs={[]}/>)).toBe('');
});

test('color chips retain codes, show known swatches and omit placeholder colors', () => {
  const html=renderToStaticMarkup(<GarmentDecorationSpecs specs={[{name:'Logo',colors:'PMS 186 C, Custom XYZ, Color 1',colorLabel:'Ink / Pantone colors'}]}/>);
  expect(html).toContain('PMS 186 C');
  expect(html).toContain('approximate screen color');
  expect(html).toContain('Custom XYZ');
  expect(html).not.toContain('Custom XYZ — approximate');
  expect(html).not.toContain('Color 1');
});

test('garment colors override selected colorway and selected colorway overrides generic colors', () => {
  const item={sku:'P',color:'Navy',decorations:[{kind:'art',art_file_id:'a',color_way_id:'navy'}]};
  const rows=[{item_idx:0,deco_idxs:[0],sizes:{M:1}}];
  const job={id:'j',items:rows};
  const art={id:'a',deco_type:'screen_print',ink_colors:'Color 1',color_ways:[{id:'navy',inks:['PMS 186 C']},{id:'white',inks:['Black']}]};
  const order={items:[item],jobs:[job],art_files:[art]};
  expect(garmentProgress(job,order,rows)[0].specs[0].colors).toBe('PMS 186 C');
  art.garment_colors={'P|Navy':{front:['White']}};
  expect(garmentProgress(job,order,rows)[0].specs[0].colors).toBe('White');
  delete art.garment_colors;
  delete item.decorations[0].color_way_id;
  expect(garmentProgress(job,order,rows)[0].specs[0].colors).toBe('');
  art.color_ways[0].garment_color=' navy ';
  art.color_ways[1].garment_color='White';
  expect(garmentProgress(job,order,rows)[0].specs[0].colors).toBe('PMS 186 C');
  item.color='White';
  art.color_ways[1].inks=[];
  expect(garmentProgress(job,order,rows)[0].specs[0].colors).toBe('');
  const html=renderToStaticMarkup(<GarmentDecorationSpecs specs={garmentProgress(job,order,rows)[0].specs}/>);
  expect(html).toContain('Not specified');
  expect(html).not.toContain('PMS 186 C');
});
test('repeated garment lines deduplicate structured specs but retain distinct placements', () => {
  const item={sku:'P',color:'Navy',decorations:[{kind:'art',art_file_id:'a',position:'Left Chest'},{kind:'art',art_file_id:'a',position:'Back'}]};
  const rows=[{item_idx:0,deco_idxs:[0,1],sizes:{M:1}},{item_idx:1,deco_idxs:[0,1],sizes:{S:2}}];
  const job={id:'j',items:rows};
  const order={items:[item,item],jobs:[job],art_files:[{id:'a',name:'Logo',deco_type:'embroidery',art_size:'3',thread_colors:'Red'}]};
  const [group]=garmentProgress(job,order,rows);
  expect(group.specs).toHaveLength(2);
  expect(group.specs[0]).toMatchObject({name:'Logo',placement:'Left Chest',size:'3',colors:'Red',colorLabel:'Thread colors'});
});
