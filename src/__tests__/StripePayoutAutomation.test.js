import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import StripePayoutAutomation from '../StripePayoutAutomation';
import {supabase} from '../lib/dbEngine';

jest.mock('../lib/dbEngine',()=>({supabase:{functions:{invoke:jest.fn()}}}));

const baseSettings={
  stripe_payouts_enabled:false,
  stripe_payout_writes_enabled:false,
  stripe_payout_bank_account_id:'',
  stripe_payout_fee_account_id:'',
  stripe_payout_start_date:'',
  stripe_payout_canary_id:'',
  writes_enabled:true,
  kill_switch:false,
};
const accounts=[
  {id:'bank-42',number:'10100',name:'Stripe Clearing',types:['Bank']},
  {id:'fee-11',number:'71400',name:'Processing Fees',types:['Expense']},
  {id:'income-9',number:'40000',name:'Sales',types:['Income']},
];

beforeEach(()=>{
  jest.clearAllMocks();
  let settings={...baseSettings};
  supabase.functions.invoke.mockImplementation(async(_name,{body})=>{
    if(body.action==='status')return {data:{ok:true,settings,payout_postings:[]}};
    if(body.action==='configure_stripe_payouts'){
      settings={...settings,...body};
      return {data:{ok:true,message:'Payout settings saved.'}};
    }
    if(body.action==='preflight')return {data:{ok:true,run_id:'run-1',status:'completed',summary:{stripe_payouts:{scanned:1,eligible:1}}}};
    return {data:{ok:false,error:'Unexpected action'}};
  });
});

test('selects mapped bank and fee accounts, saves their IDs, then runs read-only preview',async()=>{
  render(<StripePayoutAutomation accountChoices={accounts}/>);
  const bank=await screen.findByLabelText('QuickBooks deposit account');
  const fee=screen.getByLabelText('Stripe fee expense account');
  expect(bank.options).toHaveLength(2);
  expect(fee.options).toHaveLength(2);
  expect(screen.queryByText('income-9')).toBeNull();

  fireEvent.change(bank,{target:{value:'bank-42'}});
  fireEvent.change(fee,{target:{value:'fee-11'}});
  fireEvent.change(screen.getByLabelText(/Start date/),{target:{value:'2026-10-01'}});
  fireEvent.click(screen.getByLabelText(/Enable payout preview scans/));
  fireEvent.click(screen.getByText('Save payout settings'));

  await screen.findByText('Payout settings saved.');
  const configureCall=supabase.functions.invoke.mock.calls.find(([,args])=>args.body.action==='configure_stripe_payouts');
  expect(configureCall[1].body).toEqual(expect.objectContaining({
    stripe_payouts_enabled:true,
    stripe_payout_writes_enabled:false,
    stripe_payout_bank_account_id:'bank-42',
    stripe_payout_fee_account_id:'fee-11',
    stripe_payout_start_date:'2026-10-01',
  }));

  fireEvent.click(screen.getByText('Run read-only payout preview'));
  await screen.findByText(/eligible: 1/);
  expect(supabase.functions.invoke).toHaveBeenCalledWith('qbo-sales-background',{body:{action:'preflight'}});
});

test('keeps saved account selections when they are absent from the latest preflight list',async()=>{
  supabase.functions.invoke.mockResolvedValue({data:{ok:true,settings:{...baseSettings,
    stripe_payout_bank_account_id:'old-bank',stripe_payout_fee_account_id:'old-fee',
  },payout_postings:[]}});
  render(<StripePayoutAutomation accountChoices={accounts}/>);
  await screen.findAllByText(/Saved account selection \(not in current account list\)/);
  const bank=screen.getByLabelText(/QuickBooks deposit account/);
  const fee=screen.getByLabelText(/Stripe fee expense account/);
  expect(bank.value).toBe('old-bank');
  expect(fee.value).toBe('old-fee');
  expect(screen.getAllByText(/Saved account selection \(not in current account list\)/)).toHaveLength(2);
});
