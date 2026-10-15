import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtRequestCard, ArtRequestTile } from '../StandaloneArtQueue';
import { fileUpload } from '../utils';
import { createArtService } from '../lib/standaloneArtRequests';

jest.mock('../utils', () => ({ fileUpload: jest.fn() }));
jest.mock('../lib/standaloneArtRequests', () => ({ createArtService: jest.fn() }));

const request = { id: 'request-1', request_type: 'web_logo', art_name: 'School crest', customer_id: 'cust-1', status: 'in_progress', instructions: 'Make a web logo.' };
const setup = (transition = jest.fn().mockResolvedValue({ id: 'request-1', status: 'completed' })) => {
  createArtService.mockReturnValue({ transition, list: jest.fn().mockResolvedValue([]), create: jest.fn() });
  return { ...render(<ArtRequestCard request={request} supabase={{}} />), transition };
};

test('keeps an uploaded PNG staged after transition failure and retries without uploading it again', async () => {
  fileUpload.mockResolvedValue('https://files.test/logo.png');
  const transition = jest.fn().mockRejectedValueOnce(new Error('Could not save completion')).mockResolvedValueOnce({ id: 'request-1', status: 'completed' });
  const { container } = setup(transition);
  fireEvent.click(screen.getByText('Upload finished files'));
  const file = new File(['png'], 'logo.png', { type: 'image/png' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  expect(await screen.findByRole('link', { name: 'logo.png' })).toBeTruthy();
  fireEvent.click(screen.getByText('Mark completed'));
  expect(await screen.findByText('Could not save completion')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'logo.png' })).toBeTruthy();
  fireEvent.click(screen.getByText('Mark completed'));
  await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));
  expect(transition.mock.calls[0]).toEqual(['request-1', 'completed', [{ name: 'logo.png', url: 'https://files.test/logo.png' }]]);
  expect(transition.mock.calls[1][2]).toEqual(transition.mock.calls[0][2]);
  expect(fileUpload).toHaveBeenCalledTimes(1);
});

test('web logo completion only accepts PNG output', async () => {
  fileUpload.mockResolvedValue('https://files.test/not-a-logo.svg');
  const { container, transition } = setup();
  fireEvent.click(screen.getByText('Upload finished files'));
  const file = new File(['svg'], 'logo.svg', { type: 'image/svg+xml' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  expect(await screen.findByText('Web logo results must be PNG files.')).toBeTruthy();
  expect(fileUpload).not.toHaveBeenCalled();
  expect(screen.getByText('Mark completed').disabled).toBe(true);
  expect(transition).not.toHaveBeenCalled();
});

test('web logo requests accept exactly one PNG per color way', async () => {
  fileUpload.mockResolvedValue('https://files.test/logo.png');
  const { container, transition } = setup();
  const input = container.querySelector('input[type="file"]');
  expect(input.multiple).toBe(false);
  const files = [new File(['a'], 'logo-a.png', { type: 'image/png' }), new File(['b'], 'logo-b.png', { type: 'image/png' })];
  fireEvent.change(input, { target: { files } });
  expect(await screen.findByText('Upload one PNG per color way.')).toBeTruthy();
  expect(fileUpload).not.toHaveBeenCalled();
  expect(transition).not.toHaveBeenCalled();
});

test('board tile is compact and opens the full request with an upload box in a popup', () => {
  createArtService.mockReturnValue({ transition: jest.fn(), list: jest.fn(), create: jest.fn() });
  render(<ArtRequestTile request={{ ...request, status: 'requested', customer_name: 'Preuss School', linked_so_id: 'SO-2864' }} supabase={{}} />);
  expect(screen.getByText(/Next: open it and click Start/)).toBeTruthy();
  expect(screen.queryByText('Upload finished files')).toBeNull();
  fireEvent.click(screen.getByText('Preuss School'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('Upload the finished logo PNG')).toBeTruthy();
  expect(screen.getByText('Upload finished files')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Close'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('uploading on a not-yet-started request starts it and keeps the file staged', async () => {
  fileUpload.mockResolvedValue('https://files.test/logo.png');
  const transition = jest.fn().mockResolvedValue({ request: { ...request, status: 'in_progress' } });
  createArtService.mockReturnValue({ transition, list: jest.fn(), create: jest.fn() });
  const onChanged = jest.fn();
  const { container } = render(<ArtRequestCard request={{ ...request, status: 'requested' }} supabase={{}} onChanged={onChanged} />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
  expect(await screen.findByRole('link', { name: 'logo.png' })).toBeTruthy();
  await waitFor(() => expect(transition).toHaveBeenCalledWith('request-1', 'in_progress', []));
  expect(onChanged).toHaveBeenCalled();
});

test('closing the popup with uploaded but uncompleted files asks first', async () => {
  fileUpload.mockResolvedValue('https://files.test/logo.png');
  createArtService.mockReturnValue({ transition: jest.fn(), list: jest.fn(), create: jest.fn() });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ArtRequestTile request={{ ...request, customer_name: 'Preuss School' }} supabase={{}} />);
  fireEvent.click(screen.getByText('Preuss School'));
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
  expect(await screen.findByRole('link', { name: 'logo.png' })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Close'));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  confirm.mockRestore();
});
