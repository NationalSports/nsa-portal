/* Tests for coach-leads-enrich.js's pure helpers (_internals): the enrichment-payload
 * builder (colors only ever overwritten when the research actually found some) and the
 * 2026-07 safety-review attempt-cap helper that stops a school from being retried forever. */
const { buildEnrichment, buildAttemptPatch } = require('../../netlify/functions/coach-leads-enrich')._internals;

test('coach-leads-enrich.js loads as a Netlify function', () => {
  const mod = require('../../netlify/functions/coach-leads-enrich');
  expect(typeof mod.handler).toBe('function');
});

describe('buildEnrichment', () => {
  test('builds a clean enrichment payload and advances status to enriched', () => {
    const parsed = {
      color_names: ['Navy', 'Gold'], primary_hex: '#1a2b3c', accent_hex: '#ffcc00',
      mascot: 'Eagles', confidence: 'high', summary: 'Found on the official athletics site.',
    };
    const { enrichment, patch } = buildEnrichment(parsed, 4321);
    expect(enrichment).toEqual({
      color_names: ['Navy', 'Gold'], primary_hex: '#1a2b3c', accent_hex: '#ffcc00',
      mascot: 'Eagles', confidence: 'high', summary: 'Found on the official athletics site.',
      source: 'haiku-web-search', researched_len: 4321,
    });
    expect(patch.enrichment).toBe(enrichment);
    expect(patch.status).toBe('enriched');
    expect(patch.colors).toEqual(['Navy', 'Gold']);
    expect(typeof patch.enriched_at).toBe('string');
  });

  test('empty color_names -> patch.colors is omitted, so an existing colors array is left untouched', () => {
    const { patch } = buildEnrichment({ color_names: [], confidence: 'low' }, 10);
    expect(patch.colors).toBeUndefined();
    expect('colors' in patch).toBe(false);
  });

  test('missing color_names (not even an array) also omits patch.colors', () => {
    const { patch } = buildEnrichment({ confidence: 'low' }, 0);
    expect(patch.colors).toBeUndefined();
  });

  test('filters falsy entries out of color_names', () => {
    const { enrichment } = buildEnrichment({ color_names: ['Navy', '', null, 'Gold'], confidence: 'high' }, 10);
    expect(enrichment.color_names).toEqual(['Navy', 'Gold']);
  });

  test('missing optional fields default to empty string / low confidence', () => {
    const { enrichment } = buildEnrichment({ color_names: ['Navy'] }, 5);
    expect(enrichment.primary_hex).toBe('');
    expect(enrichment.accent_hex).toBe('');
    expect(enrichment.mascot).toBe('');
    expect(enrichment.confidence).toBe('low');
  });

  test('never carries attempts/last_error forward, even if called for a lead with prior failed attempts', () => {
    // buildEnrichment builds its enrichment object from scratch (from the parsed research),
    // not by spreading the lead's existing enrichment — so a previously-failing lead that
    // finally succeeds gets a clean record, and status is 'enriched', never 'enrich_failed'.
    const { enrichment, patch } = buildEnrichment({ color_names: ['Navy'], confidence: 'high' }, 5);
    expect(enrichment.attempts).toBeUndefined();
    expect(enrichment.last_error).toBeUndefined();
    expect(patch.status).toBe('enriched');
  });
});

describe('buildAttemptPatch', () => {
  test('first attempt (no prior enrichment): attempts=1, status stays new', () => {
    const { enrichment, patch } = buildAttemptPatch(null, 'No research results found');
    expect(enrichment.attempts).toBe(1);
    expect(enrichment.last_error).toBe('No research results found');
    expect(patch).toEqual({ enrichment, status: 'new' });
  });

  test('no prior enrichment at all (undefined) is also treated as zero prior attempts', () => {
    expect(buildAttemptPatch(undefined, 'x').enrichment.attempts).toBe(1);
  });

  test('increments prior attempts', () => {
    const { enrichment, patch } = buildAttemptPatch({ attempts: 1, last_error: 'old error' }, 'anthropic 529 overloaded');
    expect(enrichment.attempts).toBe(2);
    expect(enrichment.last_error).toBe('anthropic 529 overloaded');
    expect(patch.status).toBe('new'); // still under the cap
  });

  test('3rd attempt goes terminal (status enrich_failed), excluded from future runs by the status=new query filter', () => {
    const { patch } = buildAttemptPatch({ attempts: 2 }, 'still nothing found');
    expect(patch.status).toBe('enrich_failed');
  });

  test('a 4th call (should not normally happen once terminal, but stays terminal defensively) also stays enrich_failed', () => {
    expect(buildAttemptPatch({ attempts: 3 }, 'x').patch.status).toBe('enrich_failed');
  });

  test('preserves other existing enrichment keys while bumping attempts/last_error', () => {
    const { enrichment } = buildAttemptPatch({ attempts: 1, color_names: ['Navy'], confidence: 'low' }, 'err');
    expect(enrichment.color_names).toEqual(['Navy']);
    expect(enrichment.confidence).toBe('low');
    expect(enrichment.attempts).toBe(2);
  });

  test('trims whitespace and bounds a long error message to 300 chars', () => {
    const long = '  ' + 'x'.repeat(500) + '  ';
    const { enrichment } = buildAttemptPatch(null, long);
    expect(enrichment.last_error.length).toBe(300);
    expect(enrichment.last_error).toBe('x'.repeat(300));
  });

  test('a non-string error value still produces a stored message', () => {
    expect(buildAttemptPatch(null, undefined).enrichment.last_error).toBe('');
  });
});
