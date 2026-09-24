import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { canReviewJobMocks } from '../lib/jobMockReadiness';
import { garmentProgress } from '../JobGarmentProgress';
import JobGarmentMocks from '../JobGarmentMocks';
import GarmentMockCard from '../GarmentMockCard';

jest.mock('../utils', () => ({ fileDisplayName: f => f.name || f.url, _isImgUrl: () => true, _cloudinaryPdfThumb: () => null, openFile: jest.fn() }));

function fixture() {
  const items = [
    { sku: 'POLO', color: 'Navy', sizes: { XS: 2, S: 4 }, decorations: [{ kind: 'art', art_file_id: 'a' }] },
    { sku: 'POLO', color: 'Navy', sizes: { M: 1 }, decorations: [{ kind: 'art', art_file_id: 'a' }] },
    { sku: 'POLO', color: 'White', sizes: { S: 2 }, decorations: [{ kind: 'art', art_file_id: 'a' }] },
  ];
  const job = { id: 'job', art_file_id: 'a', art_status: 'needs_art', items: items.map((it, item_idx) => ({ item_idx, deco_idxs: [0], sizes: it.sizes })) };
  const order = { items, jobs: [job], art_files: [{ id: 'a', name: 'Logo', status: 'waiting_for_art', item_mockups: { 'POLO|Navy': [{ url: 'navy.png' }], 'POLO|White': [{ url: 'white.png' }] } }], _shipments: [{ items: [{ sku: 'POLO', color: 'Navy', sizes: { XS: 1, S: 2, M: 1 } }] }] };
  const rows = job.items.map(row => ({ ...row, fulSizes: { XS: 2, S: 2, M: 1 } }));
  return { job, order, rows };
}

test('saved mocks offer review without automatically approving or completing art', () => {
  const {job,order} = fixture(); const before = JSON.stringify(order);
  expect(canReviewJobMocks(job,order)).toBe(true);
  expect(JSON.stringify(order)).toBe(before);
  for(const art_status of ['art_requested','art_in_progress','waiting_approval']) expect(canReviewJobMocks({...job,art_status},order)).toBe(true);
  for(const art_status of ['art_complete','production_files_needed','upload_emb_files']) expect(canReviewJobMocks({...job,art_status},order)).toBe(false);
});
test('missing mocks, unresolved art and incomplete hydration cannot expose review', () => {
  const {job,order}=fixture();
  for(const key of ['_artHydrated','_itemsHydrated','_decosHydrated']) expect(canReviewJobMocks(job,{...order,[key]:false})).toBe(false);
  order.art_files[0].item_mockups['POLO|White']=[];
  expect(canReviewJobMocks(job,order)).toBe(false);
  expect(canReviewJobMocks({...job,items:[]},order)).toBe(false);
});
test('price-split garment lines combine quantities without repeating shipment coverage', () => {
  const {job,order,rows}=fixture(); const before=JSON.stringify(order);
  const groups=garmentProgress(job,order,rows);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({total:7,receivedTotal:5,shippedTotal:4,sizes:{XS:2,S:4,M:1}});
  expect(groups[1]).toMatchObject({total:2,shippedTotal:0});
  expect(JSON.stringify(order)).toBe(before);
});
test('same-size duplicate lines and decorator transfers never inflate shipments', () => {
  const {job,order,rows}=fixture();
  rows[1].sizes={S:3}; job.items[1].sizes={S:3};
  order._shipments.push({shipment_scope:'deco_transfer',items:[{sku:'POLO',color:'Navy',sizes:{S:100}}]});
  expect(garmentProgress(job,order,rows)[0]).toMatchObject({total:9,shippedTotal:3});
});
test('garments without art still retain their inline quantities', () => {
  const {job,order,rows}=fixture(); order.art_files=[];
  const html=renderToStaticMarkup(<JobGarmentMocks job={job} order={order} itemDetails={rows} getOrder={()=>order} onSave={jest.fn()}/>);
  expect(html).toContain('QTY 7'); expect(html).toContain('Received'); expect(html).toContain('Shipped');
});
test('split-job shipping stays scoped to that split and repeated decoration rows do not duplicate quantities', () => {
  const {job,order,rows}=fixture();
  const split={...job,id:'split',items:[{...job.items[0],split_group:'team',sizes:{S:2}}]};
  order.jobs=[{...job,id:'first',items:[{...split.items[0],sizes:{S:1}}]},split];
  const splitRows=[{...split.items[0],fulSizes:{S:2}}];
  expect(garmentProgress(split,order,splitRows)[0]).toMatchObject({total:2,receivedTotal:2,shippedTotal:1});
  expect(garmentProgress(job,order,[...rows,rows[0]])[0].total).toBe(7);
});
test('saved mock action clearly says Change mock', () => {
  const file={url:'navy.png'};
  const html=renderToStaticMarkup(<GarmentMockCard mocks={[file]} candidates={[file]} label="Polo"/>);
  expect(html).toContain('Change mock'); expect(html).not.toContain('Use existing image');
});
test.each(['OrderEditor.js','OrderEditorClassic.js'])('%s places setup/split above mocks and reuses gated approval actions', file => {
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const start=source.indexOf('aria-label="Job actions"');
  const end=source.indexOf('<JobGarmentMocks key={j.id}',start);
  expect(source.slice(start,end)).toContain('Set up job</button>');
  expect(source.slice(start,end)).toContain('Split Job</button>');
  expect(source).not.toContain('📦 Items & Sizes');
  expect(source).toContain('itemDetails={itemDetails} onViewItem={_jumpToItem}');
  const actions=source.slice(source.indexOf('const _reviewActions='),source.indexOf('const _reviewActions=')+6500);
  expect(actions).toContain('skusMissingMockups(j,o)');
  expect(actions).toContain('skusMissingRevColorWays(j,o)');
  expect(actions).toContain('setArtApproveGate');
  expect(actions).toContain('setCoachApprovalModal');
});
