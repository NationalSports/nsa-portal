import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { transformFromAstSync } from '@babel/core';
import GarmentMockCard from '../GarmentMockCard';
import { garmentSlotCandidates } from '../lib/jobMockCards';
import { safeArt, slotMockFiles } from '../safeHelpers';

jest.mock('../utils', () => ({ fileDisplayName: f => f.name || f.url, _isImgUrl: u => u.endsWith('.png'), _cloudinaryPdfThumb: () => null, openFile: jest.fn() }));

// Exercise the actual JSX wiring in BOTH dashboard dialogs, not a duplicate
// test-only card: this catches a view accidentally using only slot.artFile.
const ast = parse(fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
const cards = [];
traverse(ast, { JSXElement(p) {
  if (p.node.openingElement.name.name !== 'GarmentMockCard') return;
  const code = transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'module', body: [{ type: 'ExpressionStatement', expression: p.node }] } }, '', {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-react-jsx'],
  }).code;
  cards.push(new Function('React', 'GarmentMockCard', 'garmentSlotCandidates', 'safeArt', 'slotMockFiles', 'slot', 'gi', 'so', '_repSlots', '_slots', 'artJobDetailUploading', 'logoDetailProps', 'return ' + code));
} });

const garment = { sku: 'LE5122', color: 'Navy' };
const replacement = { id: 'new', name: 'SJM logo 3in', status: 'waiting_for_art', prod_files: [{ url: 'sew-out.png' }] };
const original = { id: 'old', name: 'SJM GOLF', item_mockups: {
  'LE5122|Navy': [{ url: 'store-polo.png', art_file_id: 'old' }],
  'LE5122|White': [{ url: 'wrong-color.png' }],
} };

test('both Art Dashboard dialogs offer the matching store garment before the sew-out', () => {
  expect(cards).toHaveLength(2);
  const so = { art_files: [replacement, original] }, before = JSON.stringify(so);
  const slot = { key: 'LE5122|Navy|d1', kind: 'art', primary: false, artId: 'new', artFile: replacement, label: replacement.name };
  const logoDetailProps = (_so, s, g) => ({ url: '', bg: '#1f2a44', colorName: g.color, onUpload: () => true });
  for (const card of cards) {
    const element = card(React, GarmentMockCard, garmentSlotCandidates, safeArt, slotMockFiles, slot, garment, so, [slot], [slot], false, logoDetailProps);
    expect(element.props.candidates.map(f => f.url)).toEqual(['store-polo.png', 'sew-out.png']);
    expect(element.props.mocks).toEqual([]);
    const html = renderToStaticMarkup(element);
    expect(html).toContain('src="store-polo.png"');
    expect(html).toContain('From SJM GOLF');
    expect(html).toContain('Use this mock');
    expect(html).toContain('Upload mock image');
    expect(html).toContain('Needs mock');
    expect(html).toContain('Logo detail');
    expect(html).toContain('Upload logo PNG');
  }
  expect(JSON.stringify(so)).toBe(before);
});

test.each(['A', 'B'])('reversible side %s does not inherit an unsided other-art mock', side => {
  expect(garmentSlotCandidates({ kind: 'art', side, artFile: replacement }, garment, [replacement, original]).map(f => f.url)).toEqual(['sew-out.png']);
});
