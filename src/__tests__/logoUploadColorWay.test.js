import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GarmentMockCard from '../GarmentMockCard';

jest.mock('../utils', () => ({ fileDisplayName: f => f.name || f.url, _isImgUrl: () => true, _cloudinaryPdfThumb: () => null, openFile: jest.fn() }));

const setup = () => {
  const onUpload = jest.fn().mockResolvedValue(true);
  render(<GarmentMockCard label="Royal shirt" mocks={[]} candidates={[]} onUpload={jest.fn()} logo={{
    url: '', bg: '#224ddd', needsColorWay: true, onUpload,
    colorWays: [{ id: 'white', label: 'White ink', url: '' }, { id: 'gold', label: 'Gold ink', url: '' }],
  }} />);
  return onUpload;
};

test('unresolved color way blocks dropped files with an actionable explanation', () => {
  const upload = setup();
  fireEvent.drop(screen.getByText('Choose a color way below to upload the logo PNG').closest('.panel-frame'), { dataTransfer: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
  expect(upload).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Choose a color way below');
  expect(screen.getByRole('button', { name: 'Upload logo PNG' }).disabled).toBe(true);
});

test('selecting a color way uploads the PNG to that explicit color way', async () => {
  const originalImage = global.Image;
  global.Image = class { naturalWidth = 2; naturalHeight = 1; set src(value) { Promise.resolve().then(() => this.onload()); } };
  URL.createObjectURL = jest.fn(() => 'blob:logo');
  URL.revokeObjectURL = jest.fn();
  const canvas = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: jest.fn(), getImageData: () => ({ data: [255,255,255,255,0,0,0,0] }) });
  try {
    const upload = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Color way for this logo' }), { target: { value: 'gold' } });
    expect(screen.getByRole('button', { name: 'Upload logo PNG' }).disabled).toBe(false);
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    fireEvent.drop(screen.getByText('Drop the transparent logo PNG here').closest('.panel-frame'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(upload).toHaveBeenCalledWith([file], 'gold'));
  } finally { global.Image = originalImage; canvas.mockRestore(); }
});
