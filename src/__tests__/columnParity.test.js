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
  so_items: [...cols('_itemCols'), 'so_id', 'item_index', 'id'],
  estimate_item_decorations: [...cols('_decoCols'), 'estimate_item_id', 'deco_index', 'id'],
  so_item_decorations: [...cols('_decoCols'), 'so_item_id', 'deco_index', 'id'],
  so_jobs: [...cols('_jobCols'), 'so_id', '_version'],
  estimates: [...cols('_estCols'), '_version'],
  sales_orders: [...cols('_soCols'), '_version'],
  messages: [...cols('_msgCols')],
});

const run = (schema) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 'schema.json');
  fs.writeFileSync(f, JSON.stringify(schema));
  try {
    execFileSync('node', [SCRIPT, '--schema', f], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
};

describe('column-parity guard', () => {
  test('passes when every written column exists', () => {
    expect(run(completeSchema()).code).toBe(0);
  });

  test('fails and names the column when one is missing (the split_runs case)', () => {
    const s = completeSchema();
    s.so_item_decorations = s.so_item_decorations.filter((c) => c !== 'split_runs');
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('split_runs');
    expect(r.out).toContain('so_item_decorations');
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
