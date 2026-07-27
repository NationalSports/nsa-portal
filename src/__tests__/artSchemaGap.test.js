import { _upsertArtRows } from '../lib/dbEngine';

// A column the client writes but the table doesn't have makes PostgREST reject the WHOLE batch
// (PGRST204, naming the column). estimate_art_files never got so_art_files' sample_art column, and
// the old recovery re-sent the batch stripped of EVERY optional column — so one missing column
// silently saved estimate art with no color_ways, design_id, preview_url or item_mockups, and the
// group came back from the next load as an empty shell. Recovery must cost only the missing column.
const PGRST204 = (col, table) => ({
  code: 'PGRST204',
  message: "Could not find the '" + col + "' column of '" + table + "' in the schema cache",
});

const row = () => ({
  id: 'af1', name: 'Biola Script 2 color', deco_type: 'screen_print', art_size: '10"',
  color_ways: [{ id: 'cw1' }, { id: 'cw2' }], design_id: 'design_abc', preview_url: 'p.png',
  item_mockups: { '0': ['m.png'] }, prod_files: [{ url: 'f.pdf' }], sample_art: [],
  estimate_id: 'EST-1415',
});

// Fake upsert that rejects any batch carrying `missing`, and records what it was sent.
const fakeSend = (missing, table) => {
  const calls = [];
  const send = async (rows) => {
    calls.push(rows);
    const offender = missing.find((c) => rows.some((r) => c in r));
    return offender ? { error: PGRST204(offender, table) } : { error: null };
  };
  return { send, calls };
};

describe('art upsert schema-gap recovery', () => {
  test('drops ONLY the column the error names — the rest of the art row still saves', async () => {
    const { send, calls } = fakeSend(['sample_art'], 'estimate_art_files');
    const { error, dropped } = await _upsertArtRows('estimate_art_files', [row()], 'estimate_id,id', send);
    expect(error).toBeNull();
    expect(dropped).toEqual(['sample_art']);
    expect(calls).toHaveLength(2);
    const saved = calls[1][0];
    expect(saved.sample_art).toBeUndefined();
    expect(saved.color_ways).toHaveLength(2);
    expect(saved.design_id).toBe('design_abc');
    expect(saved.preview_url).toBe('p.png');
    expect(saved.item_mockups).toEqual({ '0': ['m.png'] });
  });

  test('a clean table is written once, with nothing dropped', async () => {
    const { send, calls } = fakeSend([], 'so_art_files');
    const { error, dropped } = await _upsertArtRows('so_art_files', [row()], 'so_id,id', send);
    expect(error).toBeNull();
    expect(dropped).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test('two missing columns are peeled off one at a time, not by blanket strip', async () => {
    const { send, calls } = fakeSend(['sample_art', 'web_logos'], 'estimate_art_files');
    const { error, dropped } = await _upsertArtRows(
      'estimate_art_files', [{ ...row(), web_logos: [] }], 'estimate_id,id', send,
    );
    expect(error).toBeNull();
    expect(dropped.sort()).toEqual(['sample_art', 'web_logos']);
    expect(calls[calls.length - 1][0].color_ways).toHaveLength(2);
  });

  test('an unnamed schema-cache error still falls back to the blanket strip', async () => {
    const calls = [];
    const send = async (rows) => {
      calls.push(rows);
      return rows.some((r) => 'color_ways' in r)
        ? { error: { message: 'schema cache is stale' } }
        : { error: null };
    };
    const { error, dropped } = await _upsertArtRows('estimate_art_files', [row()], 'estimate_id,id', send);
    expect(error).toBeNull();
    expect(dropped).toContain('color_ways');
    expect(calls[1][0].name).toBe('Biola Script 2 color');// core fields survive the strip
  });

  test('a non-schema error (auth/RLS) is returned untouched — no silent stripped retry', async () => {
    const calls = [];
    const send = async (rows) => { calls.push(rows); return { error: { code: '42501', message: 'permission denied for table' } }; };
    const { error, dropped } = await _upsertArtRows('estimate_art_files', [row()], 'estimate_id,id', send);
    expect(error.code).toBe('42501');
    expect(dropped).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
