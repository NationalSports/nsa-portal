// Pure helpers for deciding whether a top-level runtime failure is worth one
// automatic reload. Netlify deploy aliases can move while a tab still holds an
// older main/chunk graph; that mismatch can surface either as ChunkLoadError or
// as a temporal-dead-zone initialization error inside an otherwise valid chunk.

export function isInitializationRuntimeError(error) {
  const message = error && (error.message || String(error));
  return /Cannot access ['"`].+['"`] before initialization/i.test(message || '');
}

// Scope the one-shot marker to the loaded main bundle. A genuinely bad build
// reloads only once, while a later deployment with a different main hash gets
// its own recovery attempt.
export function runtimeRecoveryStorageKey(scriptSources, pathname) {
  const sources = Array.isArray(scriptSources) ? scriptSources : [];
  const main = sources.find(src => /\/static\/js\/main\.[^/]+\.js(?:$|\?)/.test(String(src || '')));
  return 'app_runtime_reload:' + (main || pathname || 'unknown-build');
}
