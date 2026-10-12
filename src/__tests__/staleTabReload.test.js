import { staleTabReason, staleReloadDecision, STALE_TAB_MS, SLEEP_GAP_MS, RETURN_WINDOW_MS } from '../deployReload';

const H = 60 * 60 * 1000;
const base = { safe: true, blocked: false, unsaved: false, visible: true };

describe('staleTabReason', () => {
  it('flags a tab hidden overnight (the SO-2444 case)', () => {
    expect(staleTabReason({ now: 10 * H, hiddenAt: 0 })).toBe('stale-hidden');
  });
  it('flags a machine that slept with the tab in front', () => {
    expect(staleTabReason({ now: 2 * H, lastTickAt: 0 })).toBe('stale-wake');
  });
  it('ignores ordinary tab switching and throttled timers', () => {
    expect(staleTabReason({ now: STALE_TAB_MS - 1, hiddenAt: 0 })).toBe(null);
    expect(staleTabReason({ now: 5 * 60 * 1000, lastTickAt: 0 })).toBe(null);
    expect(staleTabReason({ now: SLEEP_GAP_MS - 1, lastTickAt: 0 })).toBe(null);
    expect(staleTabReason({ now: 10 * H })).toBe(null);
  });
});

describe('staleReloadDecision', () => {
  const returnedAt = 1000;
  it('reloads right after the user comes back, before they act', () => {
    expect(staleReloadDecision({ ...base, now: returnedAt + 200, returnedAt })).toBe('reload');
  });
  it('never reloads once the user has started working', () => {
    expect(staleReloadDecision({ ...base, now: returnedAt + 500, returnedAt, lastInputAt: returnedAt + 100 })).toBe('cancel');
  });
  it('gives up after the return window instead of reloading mid-session later', () => {
    expect(staleReloadDecision({ ...base, now: returnedAt + RETURN_WINDOW_MS + 1, returnedAt })).toBe('cancel');
  });
  it('waits while anything is unsaved, blocked or saving', () => {
    expect(staleReloadDecision({ ...base, now: returnedAt + 1, returnedAt, unsaved: true })).toBe('wait');
    expect(staleReloadDecision({ ...base, now: returnedAt + 1, returnedAt, blocked: true })).toBe('wait');
    expect(staleReloadDecision({ ...base, now: returnedAt + 1, returnedAt, safe: false })).toBe('wait');
  });
  it('never reloads a hidden tab', () => {
    expect(staleReloadDecision({ ...base, visible: false, now: 5, returnedAt: null })).toBe('wait');
  });
  it('input from before the user left does not count as working', () => {
    expect(staleReloadDecision({ ...base, now: returnedAt + 10, returnedAt, lastInputAt: returnedAt - 5000 })).toBe('reload');
  });
});
