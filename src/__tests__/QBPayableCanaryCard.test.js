import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import QBPayableCanaryCard from '../QBPayableCanaryCard';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const ok=data=>Promise.resolve({ok:true,json:()=>Promise.resolve(data)});

beforeEach(()=>{authFetch.mockReset();window.confirm=jest.fn(()=>true)});
test('prepares without writes and executes only the reviewed hash after confirmation',async()=>{
  const candidate={vendor:'S&S Activewear',documentNumber:'102609587',date:'2026-09-09',total:50,ledgerId:'3910',poNumber:'PO 57840 MISSW'};
  authFetch.mockReturnValueOnce(ok({candidate,previewHash:'hash',writes:0})).mockReturnValueOnce(ok({status:'complete',qboBillId:'99'}));
  render(<QBPayableCanaryCard/>);fireEvent.click(screen.getByText(/Prepare smallest bill canary/));
  expect(await screen.findByText(/document 102609587/)).toBeTruthy();
  expect(authFetch).toHaveBeenNthCalledWith(1,'/.netlify/functions/qbo-payable-canary',expect.objectContaining({body:JSON.stringify({action:'preview'})}));
  fireEvent.click(screen.getByText(/Create and verify exactly one/));
  await waitFor(()=>expect(authFetch).toHaveBeenNthCalledWith(2,'/.netlify/functions/qbo-payable-canary',expect.objectContaining({body:JSON.stringify({action:'execute',approved:true,previewHash:'hash'})})));
  expect(await screen.findByText(/Verified QBO Bill #99/)).toBeTruthy();expect(window.confirm).toHaveBeenCalledTimes(1);
});
test('shows a completed durable canary without preparing a second bill',async()=>{
  authFetch.mockReturnValueOnce(ok({status:'complete',qboBillId:'18714',recovered:true}));render(<QBPayableCanaryCard/>);fireEvent.click(screen.getByText(/Prepare smallest bill canary/));expect(await screen.findByText(/Verified QBO Bill #18714/)).toBeTruthy();
});
