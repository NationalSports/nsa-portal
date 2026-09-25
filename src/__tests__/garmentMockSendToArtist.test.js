import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GarmentMockCard from '../GarmentMockCard';

jest.mock('../utils', () => ({ fileDisplayName: f => f.name || f.url, _isImgUrl: u => u.endsWith('.png'), _cloudinaryPdfThumb: () => null, openFile: jest.fn() }));

const props = { label: 'SUNBIRDS Soccer', sub: 'Front Center', mocks: [], candidates: [{ url: 'grey-hood.png' }], suggest: true, onUse: jest.fn(), onRemove: jest.fn(), onUpload: jest.fn() };

test('mock card shows Send to Artist next to Use this mock when wired', () => {
  const html = renderToStaticMarkup(<GarmentMockCard {...props} onSendToArtist={jest.fn()} />);
  expect(html).toContain('Use this mock');
  expect(html).toContain('Send to Artist');
  expect(html.indexOf('Send to Artist')).toBeGreaterThan(html.indexOf('Use this mock'));
});

test('mock card hides Send to Artist when no handler is passed (art dashboard)', () => {
  expect(renderToStaticMarkup(<GarmentMockCard {...props} />)).not.toContain('Send to Artist');
});

test('both order editors wire Send to Artist into the artist-picker request modal', () => {
  for (const f of ['OrderEditorClassic.js', 'OrderEditor.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(src).toMatch(/<JobGarmentMocks [^\n]*onSendToArtist=\{note=>setArtReqModal\(\{jIdx:ji,artist:_activeArtistId\(/);
  }
});
