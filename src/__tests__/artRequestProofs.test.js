import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerArtProofs, { ShareArtProof } from '../ArtRequestProofs';
const row = { id: 'r1', art_name: 'Mascot', estimate_id: 'EST-1', status: 'completed', result_files: [{ url: 'https://example.com/proof.png', name: 'proof.png' }], portal_proofs: [] };
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });
test('rep explicitly shares completed artwork and sees customer status', async () => {
  const service = { shareProof: jest.fn().mockResolvedValue({}) }, onChanged = jest.fn();
  render(<ShareArtProof row={row} service={service} onChanged={onChanged} portalTag="QA" />);
  fireEvent.click(screen.getByText('Share in customer portal for approval'));
  await waitFor(() => expect(service.shareProof).toHaveBeenCalledWith('r1'));
  expect(onChanged).toHaveBeenCalled();
});
test('customer must explain changes; approval sends reviewed version without estimate approval', async () => {
  const proof = { version: 2, status: 'pending', files: row.result_files };
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [{ ...row, portal_proofs: [proof] }] }) }).mockResolvedValueOnce({ok:true,json:async()=>({proof:{...proof,status:'changes_requested',comment:'Make the outline blue'}})});
  render(<CustomerArtProofs alphaTag="QA" estimateId="EST-1" />);
  await screen.findByText('Mascot');
  expect(screen.getByText('Request changes').disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Make the outline blue' } });
  fireEvent.click(screen.getByText('Request changes'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText('Request changes')).toBeNull());
  const sent = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(sent).toEqual({ action: 'decide', alphaTag: 'QA', id: 'r1', version: 2, decision: 'reject', comment: 'Make the outline blue' });
});
test('failed decisions retain the proof and show an error', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [{ ...row, portal_proofs: [{ version: 1, status: 'pending', files: row.result_files }] }] }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Proof changed' }) });
  render(<CustomerArtProofs alphaTag="QA" />);
  fireEvent.click(await screen.findByText('Approve artwork'));
  expect((await screen.findByRole('alert')).textContent).toContain('Proof changed');
  expect(screen.getByText('Approve artwork').disabled).toBe(false);
});
