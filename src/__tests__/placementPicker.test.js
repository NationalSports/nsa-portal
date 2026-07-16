/* Stage 4 UI test: src/teamshop/PlacementPicker.js — a thin picker over the
 * decoSpec engine (src/teamshop/decoSpec.js) and the shared DecoOverlay
 * renderer. This suite proves the picker routes every nudge/resize through
 * clampPlacement (never writes x/y/w directly), shows zone chips from
 * zonesForGarment, shows method-specific options, and that Confirm only
 * fires onDone with a spec validateSpec accepts. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PlacementPicker from '../teamshop/PlacementPicker';
import { zonesForGarment, validateSpec, NUDGE_LIMIT, clampPlacement } from '../teamshop/decoSpec';

const PRODUCT = { name: 'Team Cotton Tee', image_front_url: 'https://cdn/x/tee-front.png' };
const LOGO = { id: 'art_1', url: 'https://cdn/x/logo.png', name: 'Crest', source: 'art_library' };

describe('PlacementPicker', () => {
  test('renders a zone chip for every zonesForGarment entry', () => {
    render(<PlacementPicker product={PRODUCT} logo={LOGO} onDone={() => {}} onBack={() => {}} />);
    const zones = zonesForGarment(PRODUCT);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(screen.getByText(z.label)).toBeTruthy();
    }
  });

  test('nudge buttons move the preview but never exceed clampPlacement bounds', () => {
    render(<PlacementPicker product={PRODUCT} logo={LOGO} onDone={() => {}} onBack={() => {}} />);
    const zones = zonesForGarment(PRODUCT);
    const zone = zones[0];
    const right = screen.getByLabelText('Move right');
    // Push far past the nudge limit — clampPlacement must cap it at zone.x + NUDGE_LIMIT.
    for (let i = 0; i < NUDGE_LIMIT + 10; i += 1) fireEvent.click(right);
    const img = document.querySelector('img[alt=""]'); // the DecoOverlay <img> layer
    expect(img).toBeTruthy();
    const left = parseFloat(img.style.left);
    expect(left).toBeCloseTo(clampPlacement(zone, { x: zone.x + NUDGE_LIMIT + 10, y: zone.y, w: zone.w }).x, 5);
    expect(left).toBeLessThanOrEqual(zone.x + NUDGE_LIMIT + 0.001);
  });

  test('size buttons stay within SCALE_MIN/SCALE_MAX via clampPlacement', () => {
    render(<PlacementPicker product={PRODUCT} logo={LOGO} onDone={() => {}} onBack={() => {}} />);
    const zones = zonesForGarment(PRODUCT);
    const zone = zones[0];
    const bigger = screen.getByLabelText('Larger');
    for (let i = 0; i < 50; i += 1) fireEvent.click(bigger);
    const img = document.querySelector('img[alt=""]');
    const width = parseFloat(img.style.width);
    const clamped = clampPlacement(zone, { x: zone.x, y: zone.y, w: zone.w * 100 });
    expect(width).toBeCloseTo(clamped.w, 5);
  });

  test('method options render per method (embroidery note, screen print colors, dtf sizes)', () => {
    render(<PlacementPicker product={PRODUCT} logo={LOGO} onDone={() => {}} onBack={() => {}} />);
    // screen_print is DECO_METHODS[0] (the default); switch to embroidery first.
    fireEvent.click(screen.getByText('Embroidery'));
    expect(screen.getByText(/Standard stitch count/)).toBeTruthy();

    fireEvent.click(screen.getByText('Screen Print'));
    expect(screen.getByText('Number of colors')).toBeTruthy();
    for (let n = 1; n <= 5; n += 1) expect(screen.getByText(String(n))).toBeTruthy();

    fireEvent.click(screen.getByText('DTF Print'));
    expect(screen.getByText('Print size')).toBeTruthy();
    expect(screen.getByText('4" Sq & Under')).toBeTruthy();
  });

  test('confirm produces a validateSpec-accepted spec and calls onDone with it', () => {
    const onDone = jest.fn();
    render(<PlacementPicker product={PRODUCT} logo={LOGO} onDone={onDone} onBack={() => {}} />);
    const confirm = screen.getByText('Confirm placement');
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onDone).toHaveBeenCalledTimes(1);
    const spec = onDone.mock.calls[0][0];
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(spec.art_url).toBe(LOGO.url);
    expect(spec.art_file_id).toBe(LOGO.id);
  });

  test('missing garment photo falls back to a labeled zone-outline placeholder', () => {
    render(<PlacementPicker product={{ name: 'Team Cotton Tee' }} logo={LOGO} onDone={() => {}} onBack={() => {}} />);
    expect(screen.getByText('No photo')).toBeTruthy();
    const zones = zonesForGarment({ name: 'Team Cotton Tee' });
    // front-side zones render as outline placeholders too (not just chips) —
    // assert at least one zone label appears twice (chip + outline).
    const label = zones[0].label;
    expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2);
  });
});
