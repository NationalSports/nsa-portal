import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PersonalizationTemplate from './PersonalizationTemplate';
import { productionSetupError } from './ProductionSetupReview';
jest.mock('./productionArtwork', () => ({ uploadProductionArtwork: jest.fn() }));
const name = { font: 'Name font', print_color: 'White', width_in: 11, height_in: 2, placement: 'upper_back', max_length: 20, unit_cost: 1, production_file: { bucket: 'all-school-art', path: 'name.ai', name: 'name.ai' } };
const number = { ...name, font: 'Number font', width_in: 4, height_in: 8, placement: 'full_back', max_length: 3, unit_cost: 2, production_file: { bucket: 'all-school-art', path: 'number.ai', name: 'number.ai' } };
const base = { id: 'wp', product_id: 'blank', sku: 'JERSEY', image_url: 'mock.png', takes_name: true, takes_number: true, personalization_template: { ...name, number_template: number } };
it('saves independently edited number specifications without changing name specifications', async () => {
  const onSave = jest.fn(async () => true);
  render(<PersonalizationTemplate item={base} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit custom numbers' }));
  fireEvent.change(screen.getByLabelText('Print height (in)'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save personalization templates' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const saved = onSave.mock.calls[0][1];
  expect(saved.takes_name).toBe(true); expect(saved.takes_number).toBe(true);
  expect(saved.personalization_template.font).toBe('Name font'); expect(saved.personalization_template.height_in).toBe(2);
  expect(saved.personalization_template.production_file.path).toBe('name.ai');
  expect(saved.personalization_template.number_template.font).toBe('Number font'); expect(saved.personalization_template.number_template.height_in).toBe(9);
  expect(saved.personalization_template.number_template.production_file.path).toBe('number.ai');
});
it('custom numbers alone do not enable names', async () => {
  const onSave = jest.fn(async () => true);
  render(<PersonalizationTemplate item={{ ...base, takes_name: false }} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save personalization templates' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][1].takes_name).toBe(false); expect(onSave.mock.calls[0][1].takes_number).toBe(true);
});
it('editing names preserves stocked number selection until custom numbers are explicitly enabled', async () => {
  const onSave = jest.fn(async () => true);
  render(<PersonalizationTemplate item={{ ...base, num_transfer_sets: ['8in|White'] }} onSave={onSave} onClose={() => {}} />);
  expect(screen.getByLabelText('Enable custom DTF numbers').checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save personalization templates' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][1].takes_number).toBe(true); expect(onSave.mock.calls[0][1]).not.toHaveProperty('num_transfer_sets');
});
it('approval requires a distinct exact number template and valid production costs', () => {
  expect(productionSetupError(base)).toBe('');
  expect(productionSetupError({ ...base, personalization_template: name })).toMatch(/Custom numbers/);
  expect(productionSetupError({ ...base, personalization_template: { ...base.personalization_template, unit_cost: -1 } })).toMatch(/unit cost/);
  expect(productionSetupError({ ...base, personalization_template: { ...name, number_template: { ...number, production_file: { bucket: 'all-school-art', path: 'preview.png' } } } })).toMatch(/exact .ai/);
});
