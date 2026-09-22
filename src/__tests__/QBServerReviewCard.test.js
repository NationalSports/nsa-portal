import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QBServerReviewCard from '../QBServerReviewCard';
import { authFetch } from '../utils';
jest.mock('../utils', () => ({ authFetch: jest.fn() }));
const ok = data => ({ ok:true, json:async()=>data });
const ready = { runs:[], enabled:true, realm:'123', mode:'read_only' };
beforeEach(()=>jest.resetAllMocks());
const refresh = () => fireEvent.click(screen.getByText('Refresh server history'));
const start = () => fireEvent.click(screen.getByText('Run read-only server review'));

test('requires verified readiness; background acceptance is not success', async()=>{
  authFetch.mockResolvedValue(ok(ready));
  render(<QBServerReviewCard/>);
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
  refresh(); await waitFor(()=>expect(screen.getByText('Run read-only server review').disabled).toBe(false));
  start(); await screen.findByText(/Request sent; awaiting a durable run/);
  expect(authFetch.mock.calls.filter(([url])=>url.endsWith('background'))).toHaveLength(1);
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
  expect(screen.queryByText(/Linked balances match/)).toBeNull();
  refresh(); await waitFor(()=>expect(authFetch).toHaveBeenCalledTimes(4));
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
});
test('disabled configuration and running rows prevent starts', async()=>{
  authFetch.mockResolvedValueOnce(ok({...ready, enabled:false}));
  render(<QBServerReviewCard/>); refresh(); await screen.findByText(/Server review: disabled/);
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
  authFetch.mockResolvedValueOnce(ok({...ready,runs:[{id:'r1',status:'running',realm_id:'123'}]}));
  refresh(); await screen.findByText(/Running — not verified/);
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
});
test('old completed history cannot confirm the new request', async()=>{
  const old={id:'old',status:'complete',realm_id:'123'};
  authFetch.mockResolvedValue(ok({...ready,runs:[old]}));
  render(<QBServerReviewCard/>); refresh(); await screen.findByText(/Linked balances match/);
  start(); await screen.findByText(/Request sent/);
  refresh(); await waitFor(()=>expect(authFetch).toHaveBeenCalledTimes(4));
  expect(screen.queryByText(/A new durable run/)).toBeNull();
  await waitFor(()=>expect(screen.getByText('Refresh server history').disabled).toBe(false));
  authFetch.mockResolvedValueOnce(ok({...ready,runs:[{id:'new',status:'needs_review',realm_id:'123'},old]}));
  refresh(); await screen.findByText(/A new durable run is recorded below: new/);
});
test('network uncertainty preserves no-retry warning', async()=>{
  authFetch.mockResolvedValueOnce(ok(ready)).mockResolvedValueOnce(ok(ready)).mockRejectedValueOnce(new Error('Network failed'));
  render(<QBServerReviewCard/>); refresh(); await waitFor(()=>expect(screen.getByText('Run read-only server review').disabled).toBe(false));
  start(); await screen.findByRole('alert');
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
  expect(screen.getByText(/awaiting a durable run/)).toBeTruthy();
});
test('history failures cannot enable run controls', async()=>{
  authFetch.mockResolvedValue({ok:false});
  render(<QBServerReviewCard/>); refresh(); await screen.findByRole('alert');
  expect(screen.getByText('Run read-only server review').disabled).toBe(true);
});
