/* eslint-disable */
// Verifies the Phase 4 per-vendor PO tracking panel renders the vendor's POs.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Heavy libs pulled in transitively by modals.js — stub so the component mounts.
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));

import { VendDetail } from '../modals';

const vendor = { id: 'v1780447907300', name: 'Methodic', vendor_type: 'upload', payment_terms: 'net30' };

const pos = [
  { po_id: 'PO 4001 ABC', status: 'waiting', so_id: 'SO-100', so: {}, customer: 'Acme', itemSku: 'TEE1', itemName: 'Tee', totalOrd: 24, totalRcvd: 0, totalOpen: 24, created_at: '6/8/2026', expected_date: '6/20/2026', poTotal: 120, source: 'so' },
  { po_id: 'PO 4002 XYZ', status: 'received', so_id: 'SO-101', so: {}, customer: 'Beta', itemSku: 'CAP1', itemName: 'Cap', totalOrd: 10, totalRcvd: 10, totalOpen: 0, created_at: '6/5/2026', expected_date: '', poTotal: 80, source: 'so' },
];

test('VendDetail renders the per-vendor PO tracking table with rows and filters', () => {
  const onOpenPO = jest.fn();
  render(<VendDetail vendor={vendor} products={[]} onUpdateProducts={()=>{}} onBack={()=>{}} onEdit={()=>{}} vendorPOs={pos} onOpenPO={onOpenPO} fmtCreatedAt={s=>s||'—'} />);
  // Both PO numbers show (getByText throws if absent)
  expect(screen.getByText('PO 4001 ABC')).toBeTruthy();
  expect(screen.getByText('PO 4002 XYZ')).toBeTruthy();
  // Open-units summary banner reflects the single open PO (24 units)
  expect(screen.getByText(/24 units still open/)).toBeTruthy();
  // Clicking a row invokes navigation
  fireEvent.click(screen.getByText('PO 4001 ABC'));
  expect(onOpenPO).toHaveBeenCalledWith(expect.objectContaining({ po_id: 'PO 4001 ABC' }));
  // Status filter: click "Received (1)" hides the waiting PO
  fireEvent.click(screen.getByText(/Received \(1\)/));
  expect(screen.queryByText('PO 4001 ABC')).toBeNull();
  expect(screen.getByText('PO 4002 XYZ')).toBeTruthy();
});

test('VendDetail shows empty state when the vendor has no POs', () => {
  render(<VendDetail vendor={vendor} products={[]} onUpdateProducts={()=>{}} onBack={()=>{}} onEdit={()=>{}} vendorPOs={[]} onOpenPO={()=>{}} fmtCreatedAt={s=>s} />);
  expect(screen.getByText(/No purchase orders reference this vendor yet/)).toBeTruthy();
});
