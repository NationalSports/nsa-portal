import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LogoChoiceSwitcher } from './SchoolLogoOptionsEditor';

const row = { id: 'hoodie', kind: 'single', sku: 'HOODIE-BLUE', display_name: 'Club Fleece Hoodie', product_id: 'blank', retail_price: 42, active: true };
const choice = (id, vg, label, art, extra = {}) => ({ id, kind: 'single', sku: 'TEE', product_id: 'black', variant_group_id: vg, school_style_group_id: 'style', school_design_label: label, active: true, image_url: 'blank.png', decorations: [{ art_id: art, art_url: `https://example.com/${art}.png`, side: 'front' }], ...extra });

test('logo choice switcher shows every choice and opens the same color of another choice', () => {
  const onEdit = jest.fn();
  const mk = (id, vg, product_id, label, art, active = true) => ({ id, kind: 'single', product_id, variant_group_id: vg, school_style_group_id: 'style', school_design_label: label, active, decorations: [{ art_id: art, art_url: `https://example.com/${art}.png`, side: 'front' }] });
  const catalog = [mk('orig-black', 'orig-black', 'black', 'Original logo', 'a'), mk('orig-grey', 'orig-black', 'grey', 'Original logo', 'a'),
    mk('arch-black', 'arch', 'black', 'Arched', 'b', false), mk('arch-grey', 'arch', 'grey', 'Arched', 'b', false)];
  render(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={onEdit} />);
  expect(screen.getByRole('button', { name: /Original logo/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('HIDDEN')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Arched/ }));
  expect(onEdit).toHaveBeenCalledWith('arch-grey', 'art');
});

test('logo choice switcher stays out of the way for a single-logo item', () => {
  const { container } = render(<LogoChoiceSwitcher item={row} catalog={[row]} onEdit={jest.fn()} />);
  expect(container.innerHTML).toBe('');
});

test('team-store switcher carries rename, show-first and hide controls for the current choice', async () => {
  const onUpdate = jest.fn(async () => true);
  const onSetFirst = jest.fn(async () => true);
  const mk = (id, vg, label, art) => ({ id, kind: 'single', product_id: 'black', variant_group_id: vg, school_style_group_id: 'style', school_design_label: label, active: true, image_url: 'blank.png', decorations: [{ art_id: art, art_url: `https://example.com/${art}.png`, side: 'front' }] });
  const catalog = [mk('orig', 'orig', 'Original logo', 'a'), mk('arch', 'arch', 'Arched', 'b')];
  render(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={jest.fn()} onUpdate={onUpdate} onSetFirst={onSetFirst} firstLogoByStyle={{ style: 'orig' }} />);
  fireEvent.change(screen.getByLabelText('Logo choice name'), { target: { value: 'Arched MO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(catalog[1], { school_design_label: 'Arched MO' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show first' }));
  await waitFor(() => expect(onSetFirst).toHaveBeenCalledWith(catalog[1]));
  fireEvent.click(screen.getByRole('button', { name: 'Hide from store' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(catalog[1], { active: false }));
});

test('the × removes a logo choice after confirming, switching away first when it is the one being edited', async () => {
  const onRemove = jest.fn(async () => true);
  const onEdit = jest.fn();
  const catalog = [choice('orig', 'orig', 'Original logo', 'a'), choice('arch', 'arch', 'Arched', 'b')];
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={onEdit} onUpdate={jest.fn()} onRemove={onRemove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Arched' }));
  await waitFor(() => expect(onRemove).toHaveBeenCalledWith(catalog[1]));
  expect(onEdit).toHaveBeenCalledWith('orig', 'art');
  confirm.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Original logo' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test('a hidden choice can be shown in the store again', async () => {
  const onUpdate = jest.fn(async () => true);
  const catalog = [choice('orig', 'orig', 'Original logo', 'a'), choice('arch', 'arch', 'Arched', 'b', { active: false })];
  render(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={jest.fn()} onUpdate={onUpdate} onRemove={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show in store' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(catalog[1], { active: true }));
});

test('24/7 stores get the launch-requirements review for the current choice; team stores do not', () => {
  const catalog = [choice('orig', 'orig', 'Original logo', 'a'), choice('arch', 'arch', 'Arched', 'b', { sku: '' })];
  const { rerender } = render(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={jest.fn()} onUpdate={jest.fn()} onSaveItem={jest.fn()} productionSetup />);
  fireEvent.click(screen.getByRole('button', { name: 'Launch requirements' }));
  expect(screen.getByRole('dialog', { name: 'Review exact production setup' })).toBeTruthy();
  rerender(<LogoChoiceSwitcher item={catalog[1]} catalog={catalog} onEdit={jest.fn()} onUpdate={jest.fn()} onSaveItem={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Launch requirements' })).toBeNull();
});
