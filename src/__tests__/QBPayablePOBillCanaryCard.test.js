import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import QBPayablePOBillCanaryCard from '../QBPayablePOBillCanaryCard';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const ok=data=>Promise.resolve({ok:true,json:()=>Promise.resolve(data)});

beforeEach(()=>{authFetch.mockReset();window.confirm=jest.fn(()=>true)});

test('prepares read-only and executes only the approved preview hash',async()=>{
  const candidate={vendor:'SanMar',documentNumber:'INV-4000',date:'2026-09-10',total:25,ledgerId:'4000',poNumber:'PO 4000',qboPurchaseOrderId:'70'};
  authFetch.mockReturnValueOnce(ok({candidate,previewHash:'hash',writes:0})).mockReturnValueOnce(ok({status:'complete',qboBillId:'80',qboPurchaseOrderId:'70'}));
  render(<QBPayablePOBillCanaryCard/>);fireEvent.click(screen.getByText(/Prepare PO-linked bill canary/));
  expect(await screen.findByText(/document INV-4000/)).toBeTruthy();
  expect(authFetch).toHaveBeenNthCalledWith(1,'/.netlify/functions/qbo-payable-po-bill-canary',expect.objectContaining({body:JSON.stringify({action:'preview'})}));
  fireEvent.click(screen.getByText(/Create and verify exactly one PO-linked/));
  await waitFor(()=>expect(authFetch).toHaveBeenNthCalledWith(2,'/.netlify/functions/qbo-payable-po-bill-canary',expect.objectContaining({body:JSON.stringify({action:'execute',approved:true,previewHash:'hash'})})));
  expect(await screen.findByText(/Verified QBO Bill #80 linked to QBO Purchase Order #70/)).toBeTruthy();expect(window.confirm).toHaveBeenCalledTimes(1);
});
