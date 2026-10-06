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
