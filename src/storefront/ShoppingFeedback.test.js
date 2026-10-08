import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Card, ProductPage } from './Storefront';

const theme = { primary: '#0644a5', paper: '#fff', line: '#ddd', ink: '#123', band: '#0644a5', warm: '#f5f5f5', subText: '#567' };
const store = { slug: 'serra', name: 'Serra', org_type: 'all_school', delivery_mode: 'ship_home' };
const blue = { webstore_product_id: 'blue', name: 'Hoodie', variant_group_id: 'arch', color: 'Royal', school_design_label: 'Serra arch', retail_price: 50, available_sizes: ['S', 'L'], image_front_url: 'hoodie.png', decorations: [{ art_url: 'arch.png' }] };
const script = { ...blue, webstore_product_id: 'script', variant_group_id: 'script', school_design_label: 'Serra script', decorations: [{ art_url: 'script.png' }] };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  HTMLElement.prototype.scrollIntoView = jest.fn();
  window.matchMedia = jest.fn(() => ({ matches: false }));
});

test('card logos switch the mockup and product destination without navigating', () => {
  render(<Card store={store} theme={theme} p={blue} colorRows={[blue, script]} />);
  const before = window.location.href;
  expect(screen.getByText('2 designs')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Serra script' }));
  expect(window.location.href).toBe(before);
  expect(screen.getByRole('link', { name: 'Hoodie' }).getAttribute('href')).toBe('/shop/serra/p/script');
  expect(document.querySelector('.sf-card-mock img[src="script.png"]')).toBeTruthy();
});

test('mobile size action focuses sizes, then adds the exact chosen design with lasting confirmation', () => {
  const onAdd = jest.fn();
  render(<ProductPage store={store} theme={theme} product={blue} colorRows={[blue, script]} isOpen onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select size' }));
  expect(onAdd).not.toHaveBeenCalled();
  expect(document.activeElement.querySelector('button')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Serra script' }));
  fireEvent.click(screen.getByRole('button', { name: 'L' }));
  expect(screen.getByText('Serra script · Royal · L', { selector: '.sf-selection-summary' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add to cart', exact: true }));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ webstore_product_id: 'script', size: 'L', variant_label: 'Serra script' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Serra script · Royal · L')).toBeTruthy();
  expect(dialog.querySelector('img[src="script.png"]')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Checkout' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep shopping' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onAdd).toHaveBeenCalledTimes(1);
});

test('closed stores cannot be ordered through the mobile bar', () => {
  const onAdd = jest.fn();
  render(<ProductPage store={store} theme={theme} product={blue} colorRows={[blue]} isOpen={false} onAdd={onAdd} />);
  screen.getAllByRole('button', { name: 'Store not open yet' }).forEach((button) => {
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  });
  expect(onAdd).not.toHaveBeenCalled();
});
