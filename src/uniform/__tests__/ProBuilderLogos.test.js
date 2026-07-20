jest.mock('../renderCanvas', () => ({
  renderToDataURL: jest.fn(),
  renderProductionPDF: jest.fn(),
  renderProductionSheet: jest.fn(),
}));

import { logoSpecFromConfig, modelGarmentFor } from '../ProBuilder';

describe('logoSpecFromConfig — multiple independent logo placements', () => {
  test('keeps simultaneous front, sleeve, back-neck, and under-number logos', () => {
    const logos = logoSpecFromConfig({
      chest: { src: 'data:image/png;base64,left', x: 0.67, y: 0.2, scale: 0.46, aspect: 1 },
      rightSleeve: { src: 'data:image/png;base64,sleeve', x: 0.83, y: 0.33, scale: 0.5, aspect: 1 },
      back: { src: 'data:image/png;base64,neck', x: 0.5, y: 0.15, scale: 0.46, aspect: 1 },
      backUnderNumber: { src: 'data:image/png;base64,under', x: 0.5, y: 0.78, scale: 0.55, aspect: 1 },
    });

    expect(logos.front.map((logo) => logo.slot)).toEqual(['chest', 'rightSleeve']);
    expect(logos.back.map((logo) => logo.slot)).toEqual(['back', 'backUnderNumber']);
    expect([...logos.front, ...logos.back]).toHaveLength(4);
  });

  test('constrains the under-number placement to its production-safe back area', () => {
    const logos = logoSpecFromConfig({
      backUnderNumber: { src: 'data:image/png;base64,under', x: 0.99, y: 0.99, scale: 0.55, aspect: 1 },
    });

    expect(logos.back[0]).toMatchObject({ slot: 'backUnderNumber', x: 0.76, y: 0.86 });
  });

  test('carries finished logo height and vertical pixels into production', () => {
    const logos = logoSpecFromConfig({
      chest: { src: 'data:image/png;base64,left', scale: 4 / 5.72, aspect: 0.8, pixelWidth: 800, pixelHeight: 1000 },
    });

    expect(logos.front[0]).toMatchObject({ inches: 4, aspect: 0.8, pixelWidth: 800, pixelHeight: 1000 });
  });
});

describe('artist cut model selection', () => {
  test('locks approved catalog designs to their production garment', () => {
    expect(modelGarmentFor({ neckStyle: 'agi1012', artistCut: 'sahrul' })).toBe('agi1012_jersey');
    expect(modelGarmentFor({ neckStyle: 'agi1012', artistCut: 'vikram' })).toBe('agi1012_jersey');
    expect(modelGarmentFor({ neckStyle: 'agi1012', artistCut: 'foundation' })).toBe('agi1012_jersey');
    expect(modelGarmentFor({ neckStyle: 'vneck', artistCut: 'sahrul' })).toBe('sahrul2_jersey');
  });
});
