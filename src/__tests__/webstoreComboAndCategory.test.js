import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  allocateComboPrice,
  cleanSizeList,
  comboConfig,
  comboSizeOptions,
  isComboItem,
  withComboConfig,
} from '../lib/webstoreItemOptions.shared';
import { ComboSizeEditor } from '../Webstores';
import { productCategory } from '../storefront/Storefront';

describe('webstore combo item configuration', () => {
  test('adds required top and bottom size choices without disturbing regular options', () => {
    const regular = [{ id: 'name', label: 'Locker name', kind: 'text' }];
    const configured = withComboConfig(regular, true, {
      pieces: {
        top: { webstore_product_id: 'top-item', sizes: ['s', 'M', 'M'], price_share: 80 },
        bottom: { webstore_product_id: 'bottom-item', sizes: ['L', 'xl'], price_share: 60 },
      },
    });

    expect(isComboItem(configured)).toBe(true);
    expect(configured[0]).toEqual(regular[0]);
    expect(comboConfig(configured).pieces).toMatchObject({
      top: { webstore_product_id: 'top-item', price_share: 80 },
      bottom: { webstore_product_id: 'bottom-item', price_share: 60 },
    });
    expect(comboSizeOptions(configured)).toMatchObject([
      { label: 'Top size', kind: 'choice', purpose: 'combo_top_size', required: true, choices: [{ label: 'S' }, { label: 'M' }] },
      { label: 'Bottom size', kind: 'choice', purpose: 'combo_bottom_size', required: true, choices: [{ label: 'L' }, { label: 'XL' }] },
    ]);
    expect(cleanSizeList([' m ', 'M', '', 'xl'])).toEqual(['M', 'XL']);
  });

  test('turning combo mode off removes only its generated size options', () => {
    const regular = [{ id: 'patch', label: 'Add patch', kind: 'addon' }];
    const configured = withComboConfig(regular, true, { pieces: { top: { sizes: ['M'] }, bottom: { sizes: ['L'] } } });

    expect(withComboConfig(configured, false)).toEqual(regular);
  });

  test('allocates explicit shares or blank-cost ratios to exact cents', () => {
    expect(allocateComboPrice(140, comboConfig(withComboConfig([], true, {
      pieces: { top: { sizes: ['M'], price_share: 80 }, bottom: { sizes: ['L'], price_share: 60 } },
    })))).toEqual({ top: 80, bottom: 60 });
    expect(allocateComboPrice(140, { pieces: { top: {}, bottom: {} } }, { top: 30, bottom: 20 }))
      .toEqual({ top: 84, bottom: 56 });
    expect(allocateComboPrice(99.99, { pieces: { top: {}, bottom: {} } }, { top: 1, bottom: 1 }))
      .toEqual({ top: 50, bottom: 49.99 });
  });

  test('admin can enable a combo and link independently decorated top and bottom items', () => {
    const catalog = [
      { id: 'combo', kind: 'single', sku: 'SET' },
      { id: 'top-item', kind: 'single', product_id: 'top-product', sku: 'TOP', display_name: 'Sweatshirt', decorations: [{ art_id: 'chest-logo' }] },
      { id: 'bottom-item', kind: 'single', product_id: 'bottom-product', sku: 'BOTTOM', display_name: 'Sweatpants', decorations: [{ art_id: 'leg-logo' }] },
    ];
    function Harness() {
      const [options, setOptions] = useState([]);
      return <ComboSizeEditor item={catalog[0]} options={options} catalog={catalog} stockByWp={{}} costByPid={{ 'top-product': 30, 'bottom-product': 20 }} defaultSizes={['S', 'M', 'L']} price={140} onChange={setOptions} onEnabled={() => {}} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Top combo item'), { target: { value: 'top-item' } });
    fireEvent.change(screen.getByLabelText('Bottom combo item'), { target: { value: 'bottom-item' } });

    expect(screen.getByText(/Sales Order split: Top \$84\.00 · Bottom \$56\.00/)).toBeTruthy();
    expect(document.body.textContent).toContain('SKU TOP · 1 decoration');
    expect(document.body.textContent).toContain('SKU BOTTOM · 1 decoration');
  });
});

describe('uncategorized storefront items', () => {
  test('normalizes missing listing category to the visible Other section', () => {
    expect(productCategory({ category: null, store_category: null })).toBe('Other');
    expect(productCategory({ category: 'Catalog only', store_category: null })).toBe('Other');
    expect(productCategory({ category: 'Catalog', store_category: 'Spirit Wear' })).toBe('Spirit Wear');
  });

  test('admin editor warns when no category is selected', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Webstores.js'), 'utf8');
    expect(source).toContain('No category selected. Shoppers will find this item under “Other.”');
  });
});
