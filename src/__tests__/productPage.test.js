/* src/teamshop/ProductPage.js — the "Product - Performance Polo" mockup
 * translated into the detail stage between a catalog card click and the
 * logo/placement flow. This suite covers: the product fields it renders
 * (brand/name/sku/color/sizes), that Customize/Add blank call their props
 * with the product, and the image-fallback placeholder when no photo is on
 * the row — same style as placementPicker.test.js. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductPage from '../teamshop/ProductPage';

const PRODUCT = {
  id: 'p1',
  brand: 'Sport-Tek',
  name: 'PosiCharge Performance Polo',
  sku: 'ST-POLO-1',
  color: 'Navy',
  available_sizes: ['S', 'M', 'L', 'XL'],
  image_front_url: 'https://cdn/x/polo-front.png',
  image_back_url: 'https://cdn/x/polo-back.png',
};

describe('ProductPage', () => {
  test('renders brand, name, sku, color, and size chips', () => {
    render(<ProductPage product={PRODUCT} onCustomize={() => {}} onAddBlank={() => {}} onBack={() => {}} />);
    expect(screen.getByText('Sport-Tek')).toBeTruthy();
    expect(screen.getByText('PosiCharge Performance Polo')).toBeTruthy();
    expect(screen.getByText('SKU ST-POLO-1')).toBeTruthy();
    expect(screen.getByText('Navy')).toBeTruthy();
    for (const s of PRODUCT.available_sizes) {
      expect(screen.getByText(s)).toBeTruthy();
    }
  });

  test('Customize with your logo invokes onCustomize with the product', () => {
    const onCustomize = jest.fn();
    render(<ProductPage product={PRODUCT} onCustomize={onCustomize} onAddBlank={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText('Customize with your logo'));
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(onCustomize).toHaveBeenCalledWith(PRODUCT);
  });

  test('Add blank invokes onAddBlank with the product, and is absent when the prop is omitted', () => {
    const onAddBlank = jest.fn();
    const { rerender } = render(<ProductPage product={PRODUCT} onCustomize={() => {}} onAddBlank={onAddBlank} onBack={() => {}} />);
    fireEvent.click(screen.getByText('Add blank'));
    expect(onAddBlank).toHaveBeenCalledTimes(1);
    expect(onAddBlank).toHaveBeenCalledWith(PRODUCT);

    // Anonymous browsing doesn't offer "Add blank" — the button must not render
    // at all when the prop isn't passed (see TeamShopApp.js's anonymous wiring).
    rerender(<ProductPage product={PRODUCT} onCustomize={() => {}} onBack={() => {}} />);
    expect(screen.queryByText('Add blank')).toBeNull();
  });

  test('falls back to a labeled placeholder when the product has no photo', () => {
    const noPhoto = { name: 'No Photo Polo' };
    render(<ProductPage product={noPhoto} onCustomize={() => {}} onBack={() => {}} />);
    expect(screen.getByText('Garment Photo — Front')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  test('back button calls onBack', () => {
    const onBack = jest.fn();
    render(<ProductPage product={PRODUCT} onCustomize={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByText('← Back to catalog'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
