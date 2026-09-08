import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StripePaymentVerification from '../StripePaymentVerification';
import { authFetch } from '../utils';
jest.mock('../utils', () => ({authFetch:jest.fn()}));
const ok = data => ({ok:true,json:async()=>data});
beforeEach(()=>jest.clearAllMocks());
test('shows live account evidence and explicit pagination without claiming QBO reconciliation',async()=>{
 authFetch.mockResolvedValueOnce(ok({account_id:'acct_nsa',name:'NSA',livemode:true,charges_enabled:true,payouts_enabled:true,available:[{amount:12345,currency:'usd'}],pending:[],checked_at:'2026-09-07T00:00:00Z'}));
 render(<StripePaymentVerification/>);
 fireEvent.click(screen.getByText('Check Stripe connection'));
 await screen.findByText(/acct_nsa/);expect(screen.getByText(/Available:/).textContent).toContain('$123.45');
 const page={payments:[{id:'pi_first',created:1,status:'succeeded',invoice_ids:['INV1'],currency:'usd',captured_cents:100,recorded_cents:100,verified:true,reasons:[]}],has_more:true,next_cursor:'pi_first',checked_at:'2026-09-07T00:00:00Z'};
 authFetch.mockResolvedValueOnce(ok(page));fireEvent.click(screen.getByText('Verify payments'));
 await screen.findByText(/More payments remain/);
 authFetch.mockResolvedValueOnce(ok({...page,payments:[],has_more:false,next_cursor:null}));
 fireEvent.click(screen.getByText('Next 25 payments'));
 await screen.findByText(/End of results/);
 expect(JSON.parse(authFetch.mock.calls[2][1].body).starting_after).toBe('pi_first');
 fireEvent.change(screen.getByLabelText('Payment start date'),{target:{value:'2024-01-01'}});
 expect(screen.queryByText(/End of results/)).toBeNull();
});
test('failed API check shows an error and allows retry',async()=>{
 authFetch.mockResolvedValueOnce({ok:false,json:async()=>({error:'Connection unavailable'})});
 render(<StripePaymentVerification/>);fireEvent.click(screen.getByText('Check Stripe connection'));
 expect((await screen.findByRole('alert')).textContent).toBe('Connection unavailable');
 await waitFor(()=>expect(screen.getByText('Check Stripe connection').disabled).toBe(false));
});
