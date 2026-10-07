/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RepShipmentButton from '../RepShipmentButton';
let mockCalls=[];let mockFailure=false;
jest.mock('../utils',()=>({authFetch:async(_,options)=>{
  const body=JSON.parse(options.body);mockCalls.push(body);
  return {ok:!mockFailure,json:async()=>mockFailure?{error:'Assigned rep has no valid email address'}:body.preview?{to:'rep@example.com',shipments:1,shipmentIds:['saved-1']}:{to:'rep@example.com',status:'queued'}};
}}));
beforeEach(()=>{mockCalls=[];mockFailure=false;window.confirm=jest.fn(()=>true)});
test('warehouse can confirm a rep-only update for the exact saved shipment preview',async()=>{
  render(<RepShipmentButton soId="SO-closed" nf={()=>{}}/>);
  fireEvent.click(screen.getByText('Email Rep Update'));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('queued for delivery to rep@example.com'));
  expect(mockCalls).toEqual([{soId:'SO-closed',preview:true},{soId:'SO-closed',shipmentIds:['saved-1'],preview:false}]);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('rep@example.com'));
});
test('no send if warehouse cancels the recipient confirmation',async()=>{
  window.confirm=jest.fn(()=>false);render(<RepShipmentButton soId="SO-1" nf={()=>{}}/>);
  fireEvent.click(screen.getByText('Email Rep Update'));
  await waitFor(()=>expect(window.confirm).toHaveBeenCalled());expect(mockCalls).toHaveLength(1);
});
test('missing rep error stays visible and button becomes usable again',async()=>{
  mockFailure=true;render(<RepShipmentButton soId="SO-1" nf={()=>{}}/>);
  fireEvent.click(screen.getByText('Email Rep Update'));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('no valid email'));
  expect(screen.getByText('Email Rep Update').disabled).toBe(false);expect(mockCalls).toHaveLength(1);
});
