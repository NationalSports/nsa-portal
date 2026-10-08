import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import LogoChoicePicker, { logoDesignRows } from './LogoChoicePicker';

const blue = { webstore_product_id: 'blue', variant_group_id: 'arch', color: 'Royal', school_design_label: 'Serra arch', decorations: [{ art_url: 'arch.png', baked: true }] };
const black = { ...blue, webstore_product_id: 'black', color: 'Black' };
const script = { ...blue, webstore_product_id: 'script-blue', variant_group_id: 'script', school_design_label: 'Serra script', decorations: [{ art_url: 'script.png', cw_by_color: { royal: { url: 'script-royal.png' } } }] };
const scriptBlack = { ...script, webstore_product_id: 'script-black', color: 'Black' };

test('uses one real art thumbnail per design and preserves the selected color', () => {
  const onSelect = jest.fn();
  render(<LogoChoicePicker rows={[blue, black, scriptBlack, script]} selected={blue} onSelect={onSelect} />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  const arch = screen.getByRole('button', { name: 'Serra arch' });
  expect(arch.getAttribute('aria-pressed')).toBe('true');
  expect(arch.querySelector('img').getAttribute('src')).toBe('arch.png');
  const other = screen.getByRole('button', { name: 'Serra script' });
  expect(other.querySelector('img').getAttribute('src')).toBe('script-royal.png');
  fireEvent.click(other);
  expect(onSelect).toHaveBeenCalledWith(script);
  fireEvent.click(arch);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('falls back to the first configured color if the selected color is unavailable', () => {
  const onSelect = jest.fn();
  render(<LogoChoicePicker rows={[{ ...blue, color: 'Gold' }, scriptBlack, script]} selected={{ ...blue, color: 'Gold' }} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Serra script' }));
  expect(onSelect).toHaveBeenCalledWith(scriptBlack);
  expect(logoDesignRows([blue, black, scriptBlack, script])).toEqual([blue, scriptBlack]);
});

test('shows the single included logo and supports a baked mockup without separate art', () => {
  render(<LogoChoicePicker rows={[{ ...blue, decorations: [], image_front_url: 'mock.png' }]} selected={blue} onSelect={jest.fn()} />);
  expect(screen.getByText('Included logo')).toBeTruthy();
  expect(screen.getByRole('button').querySelector('img').getAttribute('src')).toBe('mock.png');
});
