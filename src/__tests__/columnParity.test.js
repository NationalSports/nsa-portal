const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Guards the guard. scripts/check-column-parity.js is what stands between us and the next
// "column the client writes that no migration created" — the failure mode behind both the
// estimate-art sample_art gap and the split-pricing columns. If it stops failing on a real
// gap, the next one ships silently again.
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-column-parity.js');
const CONSTANTS = fs.readFileSync(path.join(__dirname, '..', 'constants.js'), 'utf8');

const cols = (name) => new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`)
  .exec(CONSTANTS)[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

// A schema that contains exactly what the client writes, plus each table's own key columns.
const completeSchema = () => ({
  estimate_art_files: [...cols('_artCols'), 'estimate_id', '_version'],
  so_art_files: [...cols('_artCols'), 'so_id', '_version'],
  estimate_items: [...cols('_itemCols'), 'estimate_id', 'item_index', 'id'],
  so_items: [...cols('_itemCols'), ...cols('_soItemCols'), 'so_id', 'item_index', 'id'],
  estimate_item_decorations: [...cols('_decoCols'), 'estimate_item_id', 'deco_index', 'id'],
  so_item_decorations: [...cols('_decoCols'), 'so_item_id', 'deco_index', 'id'],
  so_jobs: [...cols('_jobCols'), 'so_id', '_version'],
  estimates: [...cols('_estCols'), '_version'],
  sales_orders: [...cols('_soCols'), '_version'],
  messages: [...cols('_msgCols')],
});

// schema === null runs the script in its default mode (the committed snapshot).
const run = (schema) => {
  const args = [SCRIPT];
  if (schema) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 'schema.json');
    fs.writeFileSync(f, JSON.stringify(schema));
    args.push('--schema', f);
  }
  try {
    execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
};

describe('column-parity guard', () => {
  // The check that matters: the real write lists against the real committed schema snapshot.
  // Runs in the normal test job, so it fires on EVERY pull request — no database credentials,
  // no workflow path filter. This is what would have caught sample_art and split_runs at review
  // time. A new gap fails here until it is either migrated or acknowledged in the baseline.
  test('the committed schema covers every column the client writes', () => {
    const r = run(null);
    expect(r.out).toBe('');
    expect(r.code).toBe(0);
  });

  test('passes when every written column exists', () => {
    expect(run(completeSchema()).code).toBe(0);
  });

  test('fails and names the column when a NEW one goes missing', () => {
    const s = completeSchema();
    s.so_item_decorations = s.so_item_decorations.filter((c) => c !== 'color_way_id');
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('color_way_id');
    expect(r.out).toContain('so_item_decorations');
  });

  // split_runs is a real, tracked gap (migration 20260727200000 pending). It must report as a
  // notice rather than fail, or the guard would block every PR until an unrelated manual step
  // happens — the same trap that made the drift job useless. Anything NOT baselined still fails.
  test('an acknowledged gap reports but does not fail', () => {
    const s = completeSchema();
    s.so_item_decorations = s.so_item_decorations.filter((c) => c !== 'split_runs');
    const r = run(s);
    expect(r.code).toBe(0);
  });

  test('fails when a column exists on one table of a pair but not the other (the sample_art case)', () => {
    const s = completeSchema();
    s.estimate_art_files = s.estimate_art_files.filter((c) => c !== 'sample_art');
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('sample_art');
    expect(r.out).toContain('estimate_art_files');
    expect(r.out).not.toContain('so_art_files');// the table that has it is not flagged
  });
});
