import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JobGarmentMocks from '../JobGarmentMocks';
import { productionLogoCandidates } from '../lib/logoDetail';
import { fileUpload } from '../utils';

jest.mock('../utils', () => ({
  fileDisplayName: f => f.name || f.url || '', _isImgUrl: () => true,
  _cloudinaryPdfThumb: () => '', openFile: jest.fn(), fileUpload: jest.fn(),
}));

const url = 'https://res.cloudinary.com/nsa-production/blue-logo.png';
const art = { id: 'front', name: 'Front logo', deco_type: 'screen_print',
  color_ways: [{ id: 'grey', garment_color: 'Grey', inks: ['PMS 293'] }],
  prod_files: [{ url, name: 'blue-logo.png' }, { url: 'https://example.com/separations.ai', name: 'separations.ai' }] };
const order = { items: [{ sku: 'TEE', color: 'Sport Grey', sizes: { M: 12 }, decorations: [
  { kind: 'art', art_file_id: 'front', color_way_id: 'grey', position: 'Front Center' },
] }], art_files: [art] };
const job = { id: 'j', art_file_id: 'front', items: [{ item_idx: 0, deco_idxs: [0] }] };

test('only PNG production files on the matching design are offered', () => {
  expect(productionLogoCandidates({ prod_files: [
    { url, name: 'blue-logo.png' }, { url, name: 'duplicate.png' },
    { url: 'https://example.com/separations.ai', name: 'separations.ai' },
  ] })).toEqual([{ url, name: 'blue-logo.png' }]);
  render(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={() => true} />);
  expect(screen.getByRole('button', { name: 'Use blue-logo.png as logo detail' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /separations\.ai as logo detail/ })).toBeNull();
});

describe('using a production PNG as a logo detail', () => {
  let image, canvas;
  beforeEach(() => {
    image = global.Image;
    global.Image = class {
      naturalWidth = 2; naturalHeight = 1;
      set src(_value) { this.onload(); }
    };
  });
  afterEach(() => {
    global.Image = image;
    canvas?.mockRestore();
    canvas = null;
    jest.clearAllMocks();
  });

  test('a transparent PNG saves the current artwork version without another upload', async () => {
    canvas = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(), getImageData: () => ({ data: Uint8ClampedArray.from([0, 0, 255, 255, 0, 0, 0, 0]) }),
    });
    const save = jest.fn().mockResolvedValue(true);
    render(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use blue-logo.png as logo detail' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0][0].web_logos).toMatchObject([{ url, name: 'blue-logo.png', color_way_id: 'grey' }]);
    expect(fileUpload).not.toHaveBeenCalled();
  });

  test('an opaque PNG stays a production file and is not exposed as a logo', async () => {
    canvas = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(), getImageData: () => ({ data: Uint8ClampedArray.from([0, 0, 255, 255, 0, 0, 0, 255]) }),
    });
    const save = jest.fn().mockResolvedValue(true);
    render(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use blue-logo.png as logo detail' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/does not have a transparent background/));
    expect(save).not.toHaveBeenCalled();
  });
});
