import { render as renderUi, fireEvent, screen } from '@testing-library/react';
import { schoolProductMatches, schoolPrograms, schoolOrderShipmentDate, schoolVariantGroupKey } from './AllSchoolStorefront';

describe('All School shopper programs', () => {
  test('color variants cannot cross decorated programs even with a copied variant group', () => {
    expect(schoolVariantGroupKey({ school_program_ids: ['football'] }, 'blank-family')).not.toBe(schoolVariantGroupKey({ school_program_ids: ['baseball'] }, 'blank-family'));
    expect(schoolVariantGroupKey({ school_program_ids: ['baseball', 'football'] }, 'blank-family')).toBe(schoolVariantGroupKey({ school_program_ids: ['football', 'baseball'] }, 'blank-family'));
  });
  test('school-spirit decoration does not become a sport-specific design without explicit sharing', () => {
    const spirit = { school_program_ids: [] };
    const football = { school_program_ids: ['football'] };
    expect(schoolProductMatches(spirit, 'football')).toBe(false);
    expect(schoolProductMatches(football, 'baseball')).toBe(false);
    expect(schoolProductMatches(football, 'spirit')).toBe(false);
    expect(schoolProductMatches(spirit, 'spirit')).toBe(true);
    expect(schoolProductMatches({ ...spirit, school_shared: true }, 'football')).toBe(true);
    expect(schoolProductMatches(football, 'all')).toBe(true);
  });
  test('navigation excludes disabled programs without mutating saved program order', () => {
    const saved = [{ id: 'track', name: 'Track', sort_order: 4 }, { id: 'football', name: 'Football', sort_order: 1 }, { id: 'baseball', name: 'Baseball', enabled: false }];
    expect(schoolPrograms({ all_school_settings: { programs: saved } }).map((p) => p.id)).toEqual(['football', 'track']);
    expect(saved[0].id).toBe('track');
  });
});

describe('All School order shipment target', () => {
  test('a purchased target is preserved when the store turnaround changes', () => {
    const result = schoolOrderShipmentDate({ all_school_settings: { target_ship_days: 30 } }, { created_at: '2026-10-02T18:30:00Z', ship_target_at: '2026-10-16T18:30:00Z', target_ship_days: 14 });
    expect(result.date.toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(result.approximate).toBe(false);
  });
  test('legacy orders use their saved interval and are labeled approximate', () => {
    const result = schoolOrderShipmentDate({ all_school_settings: { target_ship_days: 30 } }, { created_at: '2026-10-02T18:30:00Z', target_ship_days: 14, ship_target_at: 'invalid' });
    expect(result.date.toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(result.approximate).toBe(true);
    expect(schoolOrderShipmentDate({}, { created_at: 'invalid' }).date).toBeNull();
  });
});

describe('All School hero branding', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AllSchoolIntro } = require('./AllSchoolStorefront');
  const render = (settings) => renderToStaticMarkup(React.createElement(AllSchoolIntro, {
    store: { name: 'Serra High School Athletics', logo_url: 'serra.png', all_school_settings: settings },
    theme: { band: '#003da5', accent: '#ffc72c', deepest: '#001f44' }, products: [],
  }));
  test('can hide or customize the mid-page promotion with a secondary logo', () => {
    const original = render({});
    expect(original).not.toContain('class="as-spirit"');
    expect(original).toContain('src="serra.png"');
    expect(render({ show_promo_banner: true })).toContain('Wear your pride.');
    const alternate = render({ show_promo_banner: true, secondary_logo_url: 'alternate.png' });
    expect(alternate).toContain('class="as-spirit-art"');
    expect(alternate).toContain('src="alternate.png"');
    expect(alternate).toContain('class="as-hero-crest"><img src="serra.png"');
    expect(render({ show_promo_banner: false, secondary_logo_url: 'alternate.png' })).not.toContain('class="as-spirit"');
    const promotion = render({ show_promo_banner: true, promo_eyebrow: 'Homecoming week', promo_heading: 'Show up in blue.', promo_description: 'Get ready for Friday night.', promo_button_label: 'Shop the collection', promo_destination: 'football', promo_art_text: 'Homecoming' });
    expect(promotion).toContain('Homecoming week');
    expect(promotion).toContain('Show up in blue.');
    expect(promotion).toContain('Get ready for Friday night.');
    expect(promotion).toContain('Shop the collection');
    expect(promotion).toContain('Homecoming');
    const onProgram = jest.fn();
    renderUi(React.createElement(AllSchoolIntro, { store: { name: 'Serra High School Athletics', logo_url: 'serra.png', all_school_settings: { show_promo_banner: true, promo_destination: 'football' } }, theme: { band: '#003da5', accent: '#ffc72c', deepest: '#001f44' }, products: [], onProgram }));
    fireEvent.click(screen.getByRole('button', { name: /Shop school spirit/ }));
    expect(onProgram).toHaveBeenCalledWith('football');
  });
  test('renders store logo and editable background text, including explicit hiding', () => {
    expect(render({ hero_background_text: 'PADRES' })).toContain('>PADRES</span>');
    expect(render({ hero_background_text: 'PADRES' })).toContain('src="serra.png"');
    expect(render({})).toContain('>Athletics</span>');
    expect(render({ hero_background_text: '' })).not.toContain('>Athletics</span>');
  });
  test('sport tiles use an uploaded image or the complete styled sport name', () => {
    const markup = render({ programs: [{ id: 'football', name: 'Football', slug: 'football' }, { id: 'baseball', name: 'Baseball', slug: 'baseball', image_url: 'baseball-custom.jpg' }] });
    expect(markup).toContain('class="as-program-monogram" aria-hidden="true">Football</span>');
    expect(markup).toContain('src="baseball-custom.jpg"');
    expect(markup).not.toContain('src="football.webp"');
  });
});
