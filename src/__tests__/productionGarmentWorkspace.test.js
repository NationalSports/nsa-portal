import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProductionGarmentWorkspace from '../ProductionGarmentWorkspace';

const garment = overrides => ({
  id: '0', sku: 'JERSEY', name: 'Team jersey', color: 'Navy', sizes: { M: 2 }, units: 2,
  mockups: [{ src: 'https://example.com/navy.png', file: 'navy.png', label: 'Navy front' }],
  logos: [{ src: 'https://example.com/logo.png', file: 'logo.png', label: 'Team logo' }],
  specs: <div>Front · 10 inch · PMS 1665 C</div>, files: [],
  personalization: { hasNumbers: true, hasNames: true, numbers: { M: ['12', '0'] }, names: { M: ['Lee', 'Chen'] } },
  ...overrides,
});
const setup = (items, extra = {}) => {
  const props = { items, jobUnits: 8, onToggleNumber: jest.fn(), onOpenFile: jest.fn(), ...extra };
  return { ...render(<ProductionGarmentWorkspace {...props} />), props };
};

test('every garment is on the page at once — no dropdown to switch between SKUs', () => {
  setup([garment({ groupKey: 'navy-logo', decoSummary: 'Front: Crest' }), garment({ id: '1', groupKey: 'back-num', decoSummary: 'Numbers · Back', color: 'White', units: 1, sizes: { XL: 1 },
    mockups: [{ src: 'https://example.com/white.png', file: 'white.png', label: 'White front' }],
    specs: <div>Back · 8 inch · Navy</div>, personalization: { hasNumbers: true, hasNames: false, numbers: { XL: ['33'] } } })]);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Navy front' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'White front' })).toBeInTheDocument();
  expect(screen.getByText('Lee')).toBeInTheDocument();
  expect(screen.getByText('Back · 8 inch · Navy')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark number 33, size XL, JERSEY done' })).toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: /Decoration group/ })).toHaveLength(2);
  expect(screen.getByRole('navigation', { name: 'Jump to decoration group' })).toBeInTheDocument();
});

test('SKUs sharing a logo and colors consolidate onto one card with a combined size table', () => {
  const shared = { src: 'https://example.com/shared.png', file: 'shared.png', label: 'Shared mock' };
  setup([
    garment({ id: '0', sku: 'TEE', name: 'Tee', color: 'Navy', sizes: { S: 2, M: 3 }, units: 5, groupKey: 'crest', decoSummary: 'Front: Crest',
      mockups: [shared], personalization: { hasNumbers: false, hasNames: false } }),
    garment({ id: '1', sku: 'HOOD', name: 'Hoodie', color: 'Navy', sizes: { M: 1, L: 4 }, units: 5, groupKey: 'crest', decoSummary: 'Front: Crest',
      mockups: [shared], personalization: { hasNumbers: false, hasNames: false } }),
  ], { jobUnits: 10 });
  const groups = screen.getAllByRole('region', { name: /Decoration group/ });
  expect(groups).toHaveLength(1);
  expect(screen.queryByRole('navigation', { name: 'Jump to decoration group' })).not.toBeInTheDocument();
  // the shared mockup prints once, naming both garments
  expect(screen.getAllByRole('img', { name: 'Shared mock' })).toHaveLength(1);
  expect(screen.getAllByText('For: TEE (Navy), HOOD (Navy)')).toHaveLength(2); // mockup + logo
  const table = within(groups[0]).getAllByRole('table')[0];
  const footer = within(table).getByText('Group total').closest('tr');
  expect(within(footer).getAllByRole('cell').map(c => c.textContent)).toEqual(['2', '4', '4', '10']);
  // no personalization → no roster panel
  expect(screen.queryByRole('region', { name: 'Numbers and names' })).not.toBeInTheDocument();
});

test('number/name pairing preserves source order, zero, and blank slots', () => {
  const { props } = setup([garment({ sizes: { M: 3 }, units: 3,
    personalization: { hasNumbers: true, hasNames: true, numbers: { M: ['12', '', 0] }, names: { M: ['Lee', 'Perez', 'Chen'] } },
  })]);
  const rows = within(screen.getByRole('region', { name: 'Numbers and names' })).getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('12')).toBeInTheDocument();
  expect(within(rows[0]).getByText('Lee')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Not supplied')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Perez')).toBeInTheDocument();
  expect(within(rows[2]).getByText('0')).toBeInTheDocument();
  expect(within(rows[2]).getByText('Chen')).toBeInTheDocument();
  fireEvent.click(within(rows[2]).getByRole('button'));
  expect(props.onToggleNumber).toHaveBeenCalledWith('JERSEY', 'M', '0');
  expect(screen.getByText(/Some assignments are missing/)).toBeInTheDocument();
});

test('existing check-off state and callback remain in use', () => {
  const { props } = setup([garment()], { numbersDone: { 'JERSEY|M|12': true } });
  const button = screen.getByRole('button', { name: 'Unmark number 12, size M, JERSEY done' });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('1 / 2 numbers marked done')).toBeInTheDocument();
  fireEvent.click(button);
  expect(props.onToggleNumber).toHaveBeenCalledWith('JERSEY', 'M', '12');
});

test('shared references and logo details remain visible on linked garment', () => {
  setup([garment({ referenceLabel: 'Shared mockup reference from AT106 / Grey. Verify placement on this garment.' })]);
  expect(screen.getByText(/Shared mockup reference from AT106/)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Navy front' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Team logo' })).toBeInTheDocument();
});

test('unknown sizes remain visible and missing assets/specs/rosters are explicit', () => {
  setup([garment({ sizes: { 'CUSTOM-42': 1 }, units: 1, mockups: [], logos: [], specs: null,
    personalization: { hasNumbers: true, hasNames: false } })]);
  expect(screen.getByText('CUSTOM-42')).toBeInTheDocument();
  expect(screen.getByText('Garment mockup not supplied.')).toBeInTheDocument();
  expect(screen.getByText('Logo detail not supplied for this job item.')).toBeInTheDocument();
  expect(screen.getByText('Decoration specs not supplied.')).toBeInTheDocument();
  expect(screen.getByText('Number / name assignments not supplied for this job item.')).toBeInTheDocument();
});

test('missing image preview leaves the original file accessible', () => {
  const { props } = setup([garment()]);
  fireEvent.error(screen.getByRole('img', { name: 'Navy front' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Navy front' }));
  expect(props.onOpenFile).toHaveBeenCalledWith('navy.png');
});

test('image preview opens in a dialog and returns focus on close', () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  setup([garment()]);
  const trigger = screen.getByRole('button', { name: 'Enlarge Team logo' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Team logo' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
