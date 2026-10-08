import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SchoolLogoOptionsEditor from './SchoolLogoOptionsEditor';

const row = { id: 'hoodie', kind: 'single', sku: 'HOODIE-BLUE', display_name: 'Club Fleece Hoodie', product_id: 'blank', retail_price: 42, active: true };
const base = { item: row, catalog: [row], transfers: [], logoOptions: [], onCreate: jest.fn(), onUpdate: jest.fn(), onSaveItem: jest.fn(), onEdit: jest.fn() };

test('adds a DTF logo choice from the item art editor using its exact stock', async () => {
  const onCreate = jest.fn(async () => 'new-choice');
  const onEdit = jest.fn();
  render(<SchoolLogoOptionsEditor {...base} onCreate={onCreate} onEdit={onEdit}
    transfers={[{ id: 'print', kind: 'design', code: 'ARCH', application_method: 'heat_press', label: 'Arched', production_file: { bucket: 'all-school-art', path: 'arch.ai', name: 'arch.ai' }, width_in: 10, height_in: 5 }]}
    logoOptions={[{ id: 'art', name: 'Arched Serra', url: 'https://example.com/arch.png', deco_type: 'dtf' }]} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add logo option' }));
  fireEvent.change(screen.getByLabelText('New web logo'), { target: { value: 'art' } });
  expect(screen.getByLabelText('New logo name').value).toBe('Arched Serra');
  fireEvent.change(screen.getByLabelText('Production inventory (optional now)'), { target: { value: 'ARCH' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create logo choice' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(row, 'Original logo', 'Arched Serra', expect.objectContaining({ code: 'ARCH' }), expect.objectContaining({ id: 'art' })));
  expect(onEdit).toHaveBeenCalledWith('new-choice', 'art');
});

test('embroidery logo uses its attached DST file', async () => {
  const onCreate = jest.fn(async () => 'new-choice');
  render(<SchoolLogoOptionsEditor {...base} onCreate={onCreate}
    logoOptions={[{ id: 'art', name: 'Serra arch', url: 'https://example.com/arch.png', deco_type: 'embroidery', status: 'approved', prod_files: [{ name: 'arch.dst', url: 'https://example.com/arch.dst' }] }]} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add logo option' }));
  fireEvent.change(screen.getByLabelText('New web logo'), { target: { value: 'art' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create logo choice' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(row, 'Original logo', 'Serra arch', null, expect.objectContaining({ deco_type: 'embroidery' })));
});

test('manages names and publishing beside the item artwork', async () => {
  const onUpdate = jest.fn(async () => true);
  const approved = { ...row, production_approved_at: '2026-10-07', production_approved_by: 'staff', image_url: 'mock.png', active: false, variant_group_id: 'colors', school_style_group_id: 'listing', school_design_label: 'Arched Serra' };
  render(<SchoolLogoOptionsEditor {...base} item={approved} catalog={[approved, { ...approved, id: 'black', sku: 'HOODIE-BLACK' }]} onUpdate={onUpdate} />);
  expect(screen.getByText('2 colors · hidden')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Name for Arched Serra'), { target: { value: 'Varsity arch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'hoodie' }), { school_design_label: 'Varsity arch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show in store' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'hoodie' }), { active: true }));
});
test('a published logo can be selected as the first customer preview', async () => {
  const onSetFirst = jest.fn(async () => true);
  const approved = { ...row, production_approved_at: '2026-10-07', production_approved_by: 'staff', image_url: 'mock.png', active: true, school_style_group_id: 'listing' };
  const alternate = { ...approved, id: 'arch', variant_group_id: 'arch-group', school_design_label: 'Arched Serra' };
  render(<SchoolLogoOptionsEditor {...base} item={approved} catalog={[approved, alternate]} onSetFirst={onSetFirst} />);
  expect(screen.getByText('Shows first')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show first' }));
  await waitFor(() => expect(onSetFirst).toHaveBeenCalledWith(alternate));
});

 test('creates an embroidery choice before its production file is attached', async () => {
  const onCreate = jest.fn(async () => 'new-choice');
  render(<SchoolLogoOptionsEditor {...base} onCreate={onCreate} logoOptions={[{ id: 'art', name: 'Script', url: 'script.png', deco_type: 'embroidery' }]} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add logo option' }));
  fireEvent.change(screen.getByLabelText('New web logo'), { target: { value: 'art' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create logo choice' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(row, 'Original logo', 'Script', null, expect.objectContaining({ id: 'art' })));
});

test('a saved logo can show first without production files or approval', () => {
  const onSetFirst = jest.fn(async () => true);
  const first = { ...row, image_url: 'mock.png', variant_group_id: 'first', school_style_group_id: 'listing' };
  const other = { ...first, id: 'other', variant_group_id: 'other', school_design_label: 'Script', decorations: [{ type: 'embroidery', art_id: 'no-file', art_url: 'script.png' }] };
  render(<SchoolLogoOptionsEditor {...base} item={first} catalog={[first, other]} onSetFirst={onSetFirst} />);
  const button = screen.getByRole('button', { name: 'Show first' });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onSetFirst).toHaveBeenCalledWith(other);
});
