import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('../lib/supabase', () => ({ supabase: {} }));
const { CatalogTab } = require('../Webstores');

const rows = [
  { id: 'other', kind: 'single', sku: 'OTHER', sort_order: 0 },
  { id: 'blue', kind: 'single', sku: 'BLUE', variant_group_id: 'blue', sort_order: 1 },
  { id: 'black', kind: 'single', sku: 'BLACK', variant_group_id: 'blue', sort_order: 2 },
  { id: 'white', kind: 'single', sku: 'WHITE', variant_group_id: 'blue', sort_order: 3 },
];
const stockByWp = Object.fromEntries(rows.map(r => [r.id, { name: r.id === 'other' ? 'Other garment' : 'Hoodie', color: r.id, available_sizes: [] }]));

beforeEach(() => localStorage.setItem('nsa_catalog_view', 'split'));

test('promoting a color preserves the open garment, art tab, preview and unsaved edits', () => {
  const onReorderColors = jest.fn();
  const props = { catalog: rows, stockByWp, bundleItems: [], onReorderColors };
  const view = render(<CatalogTab {...props} />);
  fireEvent.click(screen.getByText('Hoodie'));
  fireEvent.click(screen.getByRole('button', { name: '3 · Art & colors' }));
  fireEvent.click(screen.getByText('Player adds a name'));
  const draft = screen.getByRole('spinbutton');
  fireEvent.change(draft, { target: { value: '12' } });
  const blue = screen.getByTitle('Click to preview · drag to reorder — blue');
  const black = screen.getByTitle('Click to preview · drag to reorder — black');
  fireEvent.click(black);
  const dataTransfer = { effectAllowed: '' };
  fireEvent.dragStart(black, { dataTransfer });
  fireEvent.dragOver(blue, { dataTransfer });
  fireEvent.drop(blue, { dataTransfer });
  fireEvent.dragEnd(black, { dataTransfer });
  expect(onReorderColors).toHaveBeenCalledWith(['black', 'blue', 'white']);
  const reordered = rows.map(r => ({ ...r, sort_order: r.id === 'black' ? 1 : r.id === 'blue' ? 2 : r.sort_order }));
  view.rerender(<CatalogTab {...props} catalog={reordered} />);
  expect(screen.getByText('Garment & decoration')).not.toBeNull();
  expect(screen.getByRole('spinbutton')).toBe(draft);
  expect(draft.value).toBe('12');
  expect(within(screen.getByTitle('Click to preview · drag to reorder — black')).getByText('1st')).not.toBeNull();
  // Clicking the same garment's newly-primary list row must not remount its editor.
  fireEvent.click(screen.getAllByText('Hoodie')[0]);
  expect(screen.getByRole('spinbutton')).toBe(draft);
  // Removing the edited garment still selects an available item.
  view.rerender(<CatalogTab {...props} catalog={[rows[0]]} />);
  expect(screen.queryByText('Garment & decoration')).toBeNull();
});
