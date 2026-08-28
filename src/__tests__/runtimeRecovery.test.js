import { isInitializationRuntimeError, runtimeRecoveryStorageKey } from '../runtimeRecovery';

describe('runtime deploy recovery', () => {
  test('recognizes the stale-chunk initialization failure from the portal error screen', () => {
    expect(isInitializationRuntimeError(new ReferenceError("Cannot access 'Ui' before initialization"))).toBe(true);
    expect(isInitializationRuntimeError(new Error('ordinary render bug'))).toBe(false);
    expect(isInitializationRuntimeError(null)).toBe(false);
  });

  test('scopes the one-shot reload marker to the active main bundle hash', () => {
    expect(runtimeRecoveryStorageKey([
      'https://example.test/static/js/4658.abc.chunk.js',
      'https://example.test/static/js/main.c3437208.js',
    ], '/')).toBe('app_runtime_reload:https://example.test/static/js/main.c3437208.js');
    expect(runtimeRecoveryStorageKey([], '/orders')).toBe('app_runtime_reload:/orders');
  });
});
