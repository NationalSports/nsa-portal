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
  fireEvent.click(screen.getByRole('button', { name: '+ Add category' }));
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
