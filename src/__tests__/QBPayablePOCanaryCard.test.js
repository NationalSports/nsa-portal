import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import QBPayablePOCanaryCard from '../QBPayablePOCanaryCard';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const ok=data=>Promise.resolve({ok:true,json:()=>Promise.resolve(data)});

beforeEach(()=>{authFetch.mockReset();window.confirm=jest.fn(()=>true)});
test('prepares without writes and executes the exact reviewed PO hash',async()=>{
  const candidate={vendor:'S&S Activewear',poId:'PO 60000 TEST',date:'2026-09-18',total:25};
  authFetch.mockReturnValueOnce(ok({candidate,previewHash:'hash',writes:0})).mockReturnValueOnce(ok({status:'complete',qboPurchaseOrderId:'99'}));
  render(<QBPayablePOCanaryCard/>);fireEvent.click(screen.getByText(/Prepare smallest PO canary/));
  expect(await screen.findByText(/PO 60000 TEST/)).toBeTruthy();expect(authFetch).toHaveBeenNthCalledWith(1,'/.netlify/functions/qbo-payable-po-canary',expect.objectContaining({body:JSON.stringify({action:'preview'})}));
  fireEvent.click(screen.getByText(/Create and verify exactly one/));await waitFor(()=>expect(authFetch).toHaveBeenNthCalledWith(2,'/.netlify/functions/qbo-payable-po-canary',expect.objectContaining({body:JSON.stringify({action:'execute',approved:true,previewHash:'hash'})})));
  expect(await screen.findByText(/Verified QBO Purchase Order #99/)).toBeTruthy();expect(window.confirm).toHaveBeenCalledTimes(1);
});
test('shows an already completed server canary without offering another',async()=>{
  authFetch.mockReturnValueOnce(ok({status:'complete',qboPurchaseOrderId:'99',recovered:true}));render(<QBPayablePOCanaryCard/>);fireEvent.click(screen.getByText(/Prepare smallest PO canary/));expect(await screen.findByText(/Verified QBO Purchase Order #99/)).toBeTruthy();
});
