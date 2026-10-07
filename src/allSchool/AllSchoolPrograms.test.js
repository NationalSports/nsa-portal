import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AllSchoolPrograms from './AllSchoolPrograms';

beforeAll(() => { Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'new-sport-id' } }); });

const store = { id: 'store', primary_color: '#103c8c', all_school_settings: { programs: [] } };
const row = { id: 'hoodie', kind: 'single', sku: 'HOODIE-BLUE', display_name: 'Club Fleece Hoodie', product_id: 'blank', retail_price: 42, active: true };
const props = { store, catalog: [row], transfers: [], logoOptions: [], stockByWp: {}, onSaveSettings: jest.fn(async () => true), onUpdateItem: jest.fn(async () => true), onCopyOfferings: jest.fn(async () => true), onCreateLogoOption: jest.fn(async () => true), onUpdateLogoOption: jest.fn(async () => true), onOpenCatalog: jest.fn(), onOpenArt: jest.fn(), onOpenInventory: jest.fn() };

test('a sport can be added by name and immediately previews a styled text tile', async () => {
  const onSaveSettings = jest.fn(async () => true);
  render(<AllSchoolPrograms {...props} onSaveSettings={onSaveSettings} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add sport' }));
  fireEvent.change(screen.getByPlaceholderText('Football'), { target: { value: 'Baseball' } });
  expect(screen.getByText('Automatic text tile')).toBeTruthy();
  expect(screen.getByText('Unsaved category changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ programs: [expect.objectContaining({ name: 'Baseball', slug: 'baseball' })] })));
});

test('a sport photo can be replaced with the automatic text tile', () => {
  const photoStore = { ...store, all_school_settings: { programs: [{ id: 'football', name: 'Football', slug: 'football', image_url: 'https://example.com/football.jpg' }] } };
  render(<AllSchoolPrograms {...props} store={photoStore} />);
  expect(screen.getByText('Photo tile · 4:3 crop')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use styled text' }));
  expect(screen.getByText('Automatic text tile')).toBeTruthy();
  expect(screen.getByText('Unsaved category changes')).toBeTruthy();
});

test('logo choices use their own art controls and can be created in one form', async () => {
  const onCreateLogoOption = jest.fn(async () => true);
  render(<AllSchoolPrograms {...props} onCreateLogoOption={onCreateLogoOption}
    transfers={[{ id: 'print', kind: 'design', code: 'ARCH', label: 'Arched', production_file: { bucket: 'all-school-art', path: 'arch.ai', name: 'arch.ai' }, width_in: 10, height_in: 5 }]}
    logoOptions={[{ id: 'art', name: 'Arched Serra', url: 'https://example.com/arch.png' }]} />);
  fireEvent.change(screen.getByLabelText('Choose the garment'), { target: { value: 'hoodie' } });
  fireEvent.change(screen.getByLabelText('New web logo'), { target: { value: 'art' } });
  expect(screen.getByLabelText('Name for new logo').value).toBe('Arched Serra');
  fireEvent.change(screen.getByLabelText('Matching production design'), { target: { value: 'ARCH' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add logo choice' }));
  await waitFor(() => expect(onCreateLogoOption).toHaveBeenCalledWith(row, 'Original logo', 'Arched Serra', expect.objectContaining({ code: 'ARCH' }), expect.objectContaining({ id: 'art' })));
});

test('an approved hidden logo choice can be published for all its colors', async () => {
  const onUpdateLogoOption = jest.fn(async () => true);
  const approved = { production_approved_at: '2026-10-07', production_approved_by: 'staff', image_url: 'mock.png', active: false, variant_group_id: 'colors', school_style_group_id: 'listing', school_design_label: 'Arched Serra' };
  render(<AllSchoolPrograms {...props} catalog={[{ ...row, ...approved }, { ...row, ...approved, id: 'black', sku: 'HOODIE-BLACK' }]} onUpdateLogoOption={onUpdateLogoOption} />);
  fireEvent.change(screen.getByLabelText('Choose the garment'), { target: { value: 'hoodie' } });
  expect(screen.getByText('2 colors · production approved')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Name for Arched Serra'), { target: { value: 'Varsity arch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(onUpdateLogoOption).toHaveBeenCalledWith(expect.objectContaining({ id: 'hoodie' }), { school_design_label: 'Varsity arch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish choice' }));
  await waitFor(() => expect(onUpdateLogoOption).toHaveBeenCalledWith(expect.objectContaining({ id: 'hoodie' }), { active: true }));
});
