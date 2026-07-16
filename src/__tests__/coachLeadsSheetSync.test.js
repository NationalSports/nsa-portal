/* Tests for coach-leads-sheet-sync.js's pure helpers (_internals): the RFC4180-ish CSV
 * parser, the header-mapping/dedupe pass, and the unique-violation classifier that backs
 * the 2026-07 safety-review hardening (chunk-insert fallback in insertNewLeads). */
const { parseCsv, mapRows, isUniqueViolation } = require('../../netlify/functions/coach-leads-sheet-sync')._internals;

test('coach-leads-sheet-sync.js loads as a Netlify function', () => {
  const mod = require('../../netlify/functions/coach-leads-sheet-sync');
  expect(typeof mod.handler).toBe('function');
});

describe('parseCsv', () => {
  test('parses a simple unquoted CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('handles a quoted field containing a comma', () => {
    expect(parseCsv('name,email\n"Smith, Jane",jane@x.com')).toEqual([
      ['name', 'email'],
      ['Smith, Jane', 'jane@x.com'],
    ]);
  });

  test('handles "" as an escaped quote inside a quoted field', () => {
    expect(parseCsv('note\n"She said ""hi"" today"')).toEqual([['note'], ['She said "hi" today']]);
  });

  test('handles an embedded newline inside a quoted field', () => {
    expect(parseCsv('note,x\n"line one\nline two",1')).toEqual([['note', 'x'], ['line one\nline two', '1']]);
  });

  test('normalizes CRLF and lone CR line endings to \\n', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  test('a trailing row with no final newline is still captured', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('a blank trailing line (double newline at EOF) is dropped, not returned as a phantom row', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('empty input -> no rows', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('mapRows', () => {
  const headerRow = ['Coach Name', 'Email', 'Coach Email', 'School', 'Sport', 'Phone', 'Extra Column'];

  test('maps known headers case-insensitively and stashes an unmapped column in raw', () => {
    const rows = [headerRow, ['Jane Doe', 'jane@school.edu', '', 'Lincoln HS', 'Football', '555-1212', 'Some Value']];
    const { leads, skippedNoEmail } = mapRows(rows);
    expect(skippedNoEmail).toBe(0);
    expect(leads).toEqual([{
      school: 'Lincoln HS', sport: 'Football', name: 'Jane Doe', phone: '555-1212', notes: null,
      email: 'jane@school.edu', source: 'sheet', status: 'new',
      raw: { 'Extra Column': 'Some Value' },
    }]);
  });

  test('first-non-empty wins: a populated Email survives a later, DIFFERENT non-empty Coach Email', () => {
    // The header-collision fix: previously last-wins meant the later "Coach Email" column
    // clobbered a good earlier "Email" value whenever it also had (any) content.
    const rows = [headerRow, ['Jane Doe', 'jane@school.edu', 'other@school.edu', 'Lincoln HS', 'Football', '', '']];
    const { leads } = mapRows(rows);
    expect(leads[0].email).toBe('jane@school.edu');
  });

  test('first-non-empty wins: a populated Email is unaffected by a later blank Coach Email', () => {
    const rows = [headerRow, ['Jane Doe', 'jane@school.edu', '', 'Lincoln HS', 'Football', '', '']];
    const { leads } = mapRows(rows);
    expect(leads[0].email).toBe('jane@school.edu');
  });

  test('a later mapped column still fills in when the earlier column is blank for that row', () => {
    const rows = [headerRow, ['Jane Doe', '', 'coachemail@school.edu', 'Lincoln HS', 'Football', '', '']];
    const { leads } = mapRows(rows);
    expect(leads[0].email).toBe('coachemail@school.edu');
  });

  test('the same first-wins rule applies to non-email mapped columns (e.g. duplicate "school" headers)', () => {
    const rows = [
      ['School', 'Organization', 'Email'],
      ['Lincoln HS', 'Should Not Win', 'jane@school.edu'],
    ];
    const { leads } = mapRows(rows);
    expect(leads[0].school).toBe('Lincoln HS');
  });

  test('email is normalized to trimmed lowercase', () => {
    const rows = [['Email'], ['  Jane@SCHOOL.edu  ']];
    const { leads } = mapRows(rows);
    expect(leads[0].email).toBe('jane@school.edu');
  });

  test('invalid or missing email is skipped and counted', () => {
    const rows = [['Email', 'School'], ['not-an-email', 'Lincoln HS'], ['', 'Lincoln HS']];
    const { leads, skippedNoEmail } = mapRows(rows);
    expect(leads).toEqual([]);
    expect(skippedNoEmail).toBe(2);
  });

  test('dedupes within the batch, keeping the first occurrence', () => {
    const rows = [['Email', 'School'], ['jane@school.edu', 'First'], ['JANE@school.edu', 'Second']];
    const { leads } = mapRows(rows);
    expect(leads).toHaveLength(1);
    expect(leads[0].school).toBe('First');
  });

  test('a fully-blank data row is skipped entirely', () => {
    const rows = [['Email', 'School'], ['', ''], ['jane@school.edu', 'Lincoln HS']];
    const { leads } = mapRows(rows);
    expect(leads).toHaveLength(1);
  });

  test('no rows -> empty result, no crash', () => {
    expect(mapRows([])).toEqual({ leads: [], skippedNoEmail: 0 });
  });

  test('raw stashes unmapped columns keyed by the ORIGINAL header text, not the normalized one', () => {
    const rows = [['Email', 'T-Shirt Size'], ['jane@school.edu', 'Large']];
    const { leads } = mapRows(rows);
    expect(leads[0].raw).toEqual({ 'T-Shirt Size': 'Large' });
  });
});

describe('isUniqueViolation', () => {
  test('detects Postgres unique-violation code 23505', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(true);
  });

  test('detects a message containing "duplicate key" even without the code', () => {
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "coach_leads_email_key"' })).toBe(true);
  });

  test('message match is case-insensitive', () => {
    expect(isUniqueViolation({ message: 'DUPLICATE KEY value violates...' })).toBe(true);
  });

  test('a different error code/message is not a unique violation', () => {
    expect(isUniqueViolation({ code: '23502', message: 'null value in column violates not-null constraint' })).toBe(false);
  });

  test('null/undefined error is not a unique violation', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
