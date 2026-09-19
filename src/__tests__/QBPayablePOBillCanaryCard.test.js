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


test('offers and submits the narrowly scoped repair for a verified partial bill',async()=>{
  const candidate={vendor:'Adidas',documentNumber:'6166270074',date:'2026-09-09',total:32.59,freight:6.08,sportsFee:.26,poNumber:'PO 57960 SANBA',qboPurchaseOrderId:'5106'};
  authFetch.mockReturnValueOnce(Promise.resolve({ok:false,json:()=>Promise.resolve({error:'A prior PO-to-bill canary attempt requires review',repairable:true,qboBillId:'18724',candidate})})).mockReturnValueOnce(ok({status:'complete',qboBillId:'18725',qboPurchaseOrderId:'5106',repaired:true,replacedQboBillId:'18724'}));
  render(<QBPayablePOBillCanaryCard/>);fireEvent.click(screen.getByText(/Prepare PO-linked bill canary/));
  expect(await screen.findByText(/partial QBO Bill #18724/)).toBeTruthy();fireEvent.click(screen.getByText(/Create verified replacement/));
  await waitFor(()=>expect(authFetch).toHaveBeenNthCalledWith(2,'/.netlify/functions/qbo-payable-po-bill-canary',expect.objectContaining({body:JSON.stringify({action:'repair',approved:true,qboBillId:'18724'})})));
  expect(await screen.findByText(/Partial Bill #18724 deleted/)).toBeTruthy();expect(window.confirm).toHaveBeenCalledTimes(1);
});
