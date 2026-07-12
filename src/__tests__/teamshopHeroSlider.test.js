/* Home.js hero slider: 3 fixed slides (designed banner / Team Stores /
 * sideline video), auto-advancing via a plain interval gated by
 * paused/reduced-motion refs (see Home.js's "Hero slider state" block).
 * These tests exercise the parts that are observable without waiting on the
 * 6s auto-advance timer: slide count, dot navigation, and that every CTA —
 * including the new onOpenStores wiring on slide 2 — fires the right
 * handler and that slide 1's original onStartOrder/onBrowseCatalog-adjacent
 * CTAs are untouched. */
import React from 'react';
import {
  render, screen, fireEvent, within,
} from '@testing-library/react';

const mockRpc = jest.fn();
jest.mock('../lib/supabaseCoach', () => ({
  supabaseCoach: { rpc: (...args) => mockRpc(...args) },
}));

// eslint-disable-next-line import/first
import Home from '../teamshop/Home';

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

describe('Home.js — hero slider', () => {
  test('renders exactly 3 hero slides with 3 pagination dots', () => {
    render(<Home onStartOrder={() => {}} onBrowseCatalog={() => {}} onOpenStores={() => {}} />);

    const dots = [1, 2, 3].map((n) => screen.getByRole('button', { name: `Go to slide ${n}` }));
    expect(dots).toHaveLength(3);

    // Slide 1 content is visible first (all 3 slides are mounted — inactive
    // ones are opacity/pointer-events hidden, not unmounted — so the eyebrow
    // text that slides 1 and 3 share appears twice).
    expect(screen.getByText('Days, not weeks.')).toBeTruthy();
    expect(screen.getAllByText('National Team Shop').length).toBe(2);
  });

  test('clicking dot 2 shows the Team Stores slide', () => {
    render(<Home onStartOrder={() => {}} onBrowseCatalog={() => {}} onOpenStores={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 2' }));

    expect(screen.getByText('Launch a team store')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Explore team stores/ })).toBeTruthy();
  });

  test('slide 1 CTAs still call onStartOrder and link to team stores', () => {
    const onStartOrder = jest.fn();
    const { container } = render(<Home onStartOrder={onStartOrder} onBrowseCatalog={() => {}} onOpenStores={() => {}} />);
    const hero = container.querySelector('.nts-hero');

    fireEvent.click(within(hero).getByRole('button', { name: /Start with your logo/ }));
    expect(onStartOrder).toHaveBeenCalled();

    expect(within(hero).getByText(/or shop team stores/).closest('a').getAttribute('href')).toBe('/team-stores');
  });

  test('onOpenStores fires from slide 2\'s "Explore team stores" CTA', () => {
    const onOpenStores = jest.fn();
    render(<Home onStartOrder={() => {}} onBrowseCatalog={() => {}} onOpenStores={onOpenStores} />);

    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 2' }));
    fireEvent.click(screen.getByRole('button', { name: /Explore team stores/ }));

    expect(onOpenStores).toHaveBeenCalled();
  });

  test('dot 3 shows the video slide with the sideline video/poster still present', () => {
    render(<Home onStartOrder={() => {}} onBrowseCatalog={() => {}} onOpenStores={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 3' }));

    const video = document.querySelector('video[src="/teamshop/hero-sideline-loop.mp4"]');
    expect(video).toBeTruthy();
    expect(video.getAttribute('poster')).toBe('/teamshop/hero-sideline.jpg');
  });
});
