import { sanmarGarmentImage } from '../vendorCatalogSearch';

describe('sanmarGarmentImage', () => {
  test('prefers the garment-only front flat over model photography', () => {
    expect(sanmarGarmentImage({
      frontFlat: 'https://cdn.sanmar.com/ST650_Black_Flat_Front.jpg',
      colorProductImage: 'https://cdn.sanmar.com/ST650_Black_Model_Front.jpg',
      productImage: 'https://cdn.sanmar.com/ST650.jpg',
    })).toContain('_Flat_Front');
  });

  test('falls back to the color model image when no flat is published', () => {
    expect(sanmarGarmentImage({
      colorProductImage: 'https://cdn.sanmar.com/ST650_Black_Model_Front.jpg',
      productImage: 'https://cdn.sanmar.com/ST650.jpg',
    })).toContain('_Model_Front');
  });

  test('returns an empty string when SanMar supplies no usable image', () => {
    expect(sanmarGarmentImage({})).toBe('');
  });
});
