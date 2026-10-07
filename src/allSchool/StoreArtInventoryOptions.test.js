import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StoreArtInventoryOptions, { inventorySeedForArt, artInventoryCode } from './StoreArtInventoryOptions';
import DecorationStockForm from './DecorationStockForm';
jest.mock('./productionArtwork', () => ({ uploadProductionArtwork: jest.fn() }));
const arts = [{ id: 'a', name: 'TWILL Serra', url: '/serra.png', deco_type: 'dtf' }, { id: 'b', name: 'Padres', deco_type: 'patch' }, { id: 'c', name: 'Serra block', deco_type: 'dtf' }];
test('all three store logos appear without creating stock or ordering anything', () => {
  const select = jest.fn();
  render(<StoreArtInventoryOptions artwork={[...arts, arts[0]]} onSelect={select} />);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /TWILL Serra/ }));
  expect(select).toHaveBeenCalledWith(arts[0], undefined);
});
test('saved inventory is recognized after renaming and opens for editing', () => {
  const select = jest.fn();
  const row = { id: 'saved', kind: 'design', code: artInventoryCode(arts[0]), label: 'Renamed stock', on_hand: 12 };
  render(<StoreArtInventoryOptions artwork={arts} transfers={[row]} onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: /12 on hand/ }));
  expect(select).toHaveBeenCalledWith(arts[0], row);
});
test('art seeds zero-stock options with editable types and only verified private production files', () => {
  expect(arts.map((a) => inventorySeedForArt(a).decoration_type)).toEqual(['twill', 'patch', 'dtf']);
  expect(inventorySeedForArt(arts[0]).on_hand).toBe(0);
  expect(inventorySeedForArt({ ...arts[0], production_file: { url: '/mock.png' } }).production_file).toBeUndefined();
  const file = { bucket: 'all-school-art', path: 'art.ai', sha256: 'hash' };
  expect(inventorySeedForArt({ ...arts[0], production_file: file }).production_file).toEqual(file);
});
test('prefilled form offers Twill and Patch and saves the art identity with zero on hand', async () => {
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'random-code' } });
  const save = jest.fn().mockResolvedValue(true);
  const close = jest.fn();
  render(<DecorationStockForm initialValue={inventorySeedForArt(arts[0])} artwork={arts[0]} onAdd={save} onClose={close} />);
  expect(screen.getByLabelText('Decoration stock name').value).toBe('TWILL Serra');
  expect(screen.getByRole('option', { name: 'Twill' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Patch' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Inventory type'), { target: { value: 'patch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add decoration stock' }));
  await screen.findByRole('button', { name: 'Add decoration stock' });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ code: artInventoryCode(arts[0]), decoration_type: 'patch', on_hand: 0 }));
});
