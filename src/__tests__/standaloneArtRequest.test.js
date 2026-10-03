import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StandaloneArtRequest from '../StandaloneArtRequest';
import { fileUpload } from '../utils';
import { createArtService } from '../lib/standaloneArtRequests';

jest.mock('../utils', () => ({ fileUpload: jest.fn() }));
jest.mock('../lib/standaloneArtRequests', () => ({ createArtService: jest.fn() }));

beforeEach(() => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: jest.fn(() => '12345678-1234-4abc-8def-1234567890ab') } });
});

const art = { id: 'art-1', name: 'School crest', color_ways: [{ id: 'navy', garment_color: 'Navy' }] };
const customer = { id: 'cust-1', name: 'North High' };
const setup = async ({ beforeCreate, create = jest.fn().mockResolvedValue({ id: 'request-1' }), list = jest.fn().mockResolvedValue([]), props = {} } = {}) => {
  createArtService.mockReturnValue({ list, create, transition: jest.fn() });
  const view = render(<StandaloneArtRequest supabase={{}} customer={customer} order={{ id: 'EST-1', customer_id: customer.id }} mode="estimate" art={art} beforeCreate={beforeCreate} {...props} />);
  fireEvent.click(screen.getByText('🎨 Request art'));
  await screen.findByText('No requests yet.');
  return { ...view, create, list, beforeCreate };
};
const fillBrief = () => fireEvent.change(screen.getByLabelText('Brief / instructions'), { target: { value: 'Prepare the web logo.' } });
const chooseCw = () => fireEvent.change(screen.getByLabelText('Color way'), { target: { value: 'navy' } });

test('waits for confirmed art save before creating the linked estimate request', async () => {
  let resolveSave;
  const beforeCreate = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
  const { create } = await setup({ beforeCreate });
  fillBrief(); chooseCw();
  fireEvent.click(screen.getByText('Submit request'));
  await waitFor(() => expect(beforeCreate).toHaveBeenCalledTimes(1));
  expect(create).not.toHaveBeenCalled();
  await act(async () => resolveSave(true));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0]).toMatchObject({ customer_id: 'cust-1', estimate_id: 'EST-1', so_id: null, art_id: 'art-1', color_way_id: 'navy' });
});

test('a failed save stops submission and leaves the request dialog available', async () => {
  const create = jest.fn();
  await setup({ beforeCreate: jest.fn().mockResolvedValue(false), create });
  fillBrief(); chooseCw();
  fireEvent.click(screen.getByText('Submit request'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});

test('requires selecting an actual color way when art has color ways', async () => {
  const { create } = await setup();
  fillBrief();
  fireEvent.click(screen.getByText('Submit request'));
  expect(await screen.findByText('Choose a color way.')).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
  chooseCw();
  fireEvent.click(screen.getByText('Submit request'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0].color_way_id).toBe('navy');
});

test('a failed create retains uploaded references and reuses the same UUID on retry', async () => {
  fileUpload.mockResolvedValue('https://files.test/ref.png');
  const create = jest.fn().mockRejectedValueOnce(new Error('Temporary insert failure')).mockResolvedValueOnce({ id: 'request-1' });
  const { container } = await setup({ create });
  const file = new File(['png'], 'ref.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Add files'), { target: { files: [file] } });
  expect(await screen.findByRole('link', { name: 'ref.png' })).toBeTruthy();
  fillBrief(); chooseCw();
  fireEvent.click(screen.getByText('Submit request'));
  expect(await screen.findByText('Temporary insert failure')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'ref.png' })).toBeTruthy();
  fireEvent.click(screen.getByText('Submit request'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0][0].id).toBeTruthy();
  expect(create.mock.calls[1][0].id).toBe(create.mock.calls[0][0].id);
  expect(create.mock.calls[1][0].reference_files).toEqual([{ name: 'ref.png', url: 'https://files.test/ref.png' }]);
  expect(fileUpload).toHaveBeenCalledTimes(1);
});
