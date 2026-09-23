import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobGarmentMocks from '../JobGarmentMocks';

jest.mock('../utils', () => ({ fileDisplayName: f => f.name || '', _isImgUrl: () => true, _cloudinaryPdfThumb: () => '', openFile: jest.fn(), fileUpload: jest.fn() }));

test.each(['art_requested', 'waiting_approval', 'art_complete'])('job detail offers explicit upload at %s without changing status', status => {
  const job = { id: 'j', art_file_id: 'a', art_status: status, items: [{ item_idx: 0, deco_idxs: [0] }] };
  const order = { items: [{ sku: 'VISOR', color: 'White', decorations: [{ kind: 'art', art_file_id: 'a' }] }], art_files: [{ id: 'a', name: 'Logo' }] };
  const save = jest.fn();
  const markup = renderToStaticMarkup(<JobGarmentMocks job={job} order={order} getOrder={() => order} onSave={save} />);
  expect(markup).toContain('Upload mock image');
  expect(markup).toContain('type="file"');
  expect(save).not.toHaveBeenCalled();
  expect(job.art_status).toBe(status);
});
