import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import QBPayableServerReviewCard from '../QBPayableServerReviewCard';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const ok=data=>({ok:true,json:async()=>data});
const ready={runs:[],enabled:true,realm:'123',mode:'read_only'};
beforeEach(()=>jest.resetAllMocks());
test('cannot start until durable history is verified and acceptance is not success',async()=>{
  authFetch.mockResolvedValue(ok(ready));render(<QBPayableServerReviewCard/>);
  const run=screen.getByText(/Run Server Bill Review/);expect(run.disabled).toBe(true);
  fireEvent.click(screen.getByText(/Refresh payable review history/));await waitFor(()=>expect(run.disabled).toBe(false));
  fireEvent.click(run);await screen.findByText(/Request accepted/);expect(run.disabled).toBe(true);
  expect(screen.getByText(/bill and vendor-credit creation remain disabled/i)).toBeTruthy();
});
test('renders persisted exceptions without exposing a write control',async()=>{
  authFetch.mockResolvedValue(ok({...ready,runs:[{id:'r1',status:'needs_review',started_at:'now',finished_at:'later',report:{population:1,counts:{blocked:1},sourceHash:'abc',sourceChanged:false,results:[{ledgerId:'L1',transactionType:'Bill',documentNumber:'B1',vendor:'Acme',date:'2026-01-01',total:10,action:'blocked',reason:'No vendor'}]}}]}));
  render(<QBPayableServerReviewCard/>);fireEvent.click(screen.getByText(/Refresh payable review history/));await screen.findByText(/Needs review/);fireEvent.click(screen.getByText(/Needs review/));expect(await screen.findByText('No vendor')).toBeTruthy();expect(screen.queryByText(/Create bill/i)).toBeNull();
});
