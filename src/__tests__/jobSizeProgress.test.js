import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobGarmentProgress, { sizeProgressCell } from '../JobGarmentProgress';

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
});
