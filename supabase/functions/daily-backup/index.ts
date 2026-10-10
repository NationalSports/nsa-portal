// supabase/functions/daily-backup/index.ts
// ─────────────────────────────────────────────────────────
// Backup WORKER. Runs are started by pg_cron (public.backup_start —
// daily at 07:00 UTC + intraday every 3h), which snapshots the list of
// every public table into a backup_runs row. pg_cron then pokes this
// function every minute while a run is in progress. Each poke:
//   1. claims the oldest running run (short lease, so pokes never overlap)
//   2. reads ~4 MB pages via backup_read_page and writes each page as its
//      own gzipped file: backups/<kind>/<stamp>/<table>/part-00001.json.gz
//   3. records progress after every page, so a crash or time limit just
//      resumes on the next poke
//   4. on the last table writes manifest.json, marks the run ok, and prunes
//      expired runs (daily 30 days, intraday / failed 4 days)
//
// Each part file is the page as returned by backup_read_page:
//   {"n": <row count>, "last": <keyset cursor>, "rows": [ {...}, ... ]}
//
// Memory stays at one page at a time. The previous version built the whole
// database as one JSON string and was killed (WORKER_RESOURCE_LIMIT) on every
// run once the data grew — see migration 20260922230000_backup_every_table.
// ─────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET = "backups";
const TIME_BUDGET_MS = 25_000; // stop starting new pages after this; next poke continues
const MAX_PAGES_PER_POKE = 15; // keeps CPU per invocation bounded

type Cursor = { ti: number; after: unknown; part: number };
type Run = {
  id: string;
  kind: "daily" | "intraday";
  prefix: string;
  created_at: string;
  tables: { name: string; limit: number }[];
  cursor: Cursor;
  table_stats: Record<string, { rows: number; parts: number }>;
  total_rows: number;
  audit_from_id: number | null;
  audit_to_id: number | null;
};

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

// Fetch the page as raw text so we never parse/re-serialize the rows — the
// text is gzipped straight to storage. Only the small {n,last} head is parsed.
async function readPage(table: string, after: unknown, limit: number, minId: number | null, maxId: number | null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/backup_read_page`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_table: table, p_after: after ?? null, p_limit: limit, p_min_id: minId, p_max_id: maxId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`read ${table}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // jsonb prints keys shortest-first, so the text is {"n": .., "last": .., "rows": [...]}.
  // A "rows" key inside a string value would appear escaped (\"rows\"), so this can't mis-split.
  let head: { n: number; last: unknown };
  const at = text.indexOf(', "rows": ');
  try {
    head = JSON.parse(text.slice(0, at) + "}");
  } catch {
    head = JSON.parse(text);
  }
  if (typeof head?.n !== "number") throw new Error(`read ${table}: unexpected response ${text.slice(0, 200)}`);
  return { text, n: head.n, last: head.last };
}

async function gzip(input: string): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function upload(path: string, body: Uint8Array, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function prune() {
  const runs = (await rpc("backup_prunable", {})) as { id: string; files: string[] }[] | null;
  let removed = 0;
  for (const r of runs ?? []) {
    const files = r.files ?? [];
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await supabase.storage.from(BUCKET).remove(files.slice(i, i + 100));
      if (error) throw new Error(`prune: ${error.message}`);
    }
    removed += files.length;
    await rpc("backup_mark_pruned", { p_run: r.id });
  }
  return removed;
}

async function finish(run: Run) {
  const manifestPath = `${run.prefix}manifest.json`;
  const manifest = {
    version: 2,
    app: "NSA Portal",
    kind: run.kind,
    started_at: run.created_at,
    finished_at: new Date().toISOString(),
    format: "Each <table>/part-NNNNN.json.gz is gzipped JSON {n, last, rows:[...]}; concatenate rows across parts in order.",
    audit_log: run.kind === "daily"
      ? { note: "Incremental: only rows with from_id < id <= to_id", from_id: run.audit_from_id, to_id: run.audit_to_id }
      : { note: "Not included in intraday runs" },
    total_rows: run.total_rows,
    tables: Object.fromEntries(run.tables.map((t) => [t.name, run.table_stats[t.name] ?? { rows: 0, parts: 0 }])),
  };
  await upload(manifestPath, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), "application/json");
  await rpc("backup_finish", { p_run: run.id, p_manifest: manifestPath });
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const run = (await rpc("backup_claim", {}).catch((e) => ({ __error: String(e) }))) as Run | { __error: string } | null;
  if (!run) return Response.json({ ok: true, idle: true });
  if ("__error" in run) return Response.json({ ok: false, error: run.__error }, { status: 500 });

  let cursor: Cursor = run.cursor ?? { ti: 0, after: null, part: 0 };
  let pages = 0;
  try {
    while (Date.now() - started < TIME_BUDGET_MS && pages < MAX_PAGES_PER_POKE) {
      const table = run.tables[cursor.ti];
      if (!table) {
        await finish(run);
        const pruned = await prune();
        return Response.json({ ok: true, finished: run.id, total_rows: run.total_rows, pruned, duration_ms: Date.now() - started });
      }
      const incremental = table.name === "audit_log" && run.kind === "daily";
      const page = await readPage(
        table.name, cursor.after, table.limit,
        incremental ? run.audit_from_id : null,
        incremental ? run.audit_to_id : null,
      );
      pages++;
      const doneWithTable = page.n < table.limit;
      if (page.n === 0) {
        cursor = { ti: cursor.ti + 1, after: null, part: 0 };
        await rpc("backup_advance", { p_run: run.id, p_cursor: cursor, p_table: table.name, p_rows: 0, p_bytes: 0, p_file: null });
        continue;
      }
      const part = cursor.part + 1;
      const path = `${run.prefix}${table.name}/part-${String(part).padStart(5, "0")}.json.gz`;
      const gz = await gzip(page.text);
      await upload(path, gz, "application/gzip");
      cursor = doneWithTable ? { ti: cursor.ti + 1, after: null, part: 0 } : { ti: cursor.ti, after: page.last, part };
      await rpc("backup_advance", { p_run: run.id, p_cursor: cursor, p_table: table.name, p_rows: page.n, p_bytes: gz.byteLength, p_file: path });
      const s = run.table_stats[table.name] ?? { rows: 0, parts: 0 };
      run.table_stats[table.name] = { rows: s.rows + page.n, parts: s.parts + 1 };
      run.total_rows += page.n;
    }
    await rpc("backup_release", { p_run: run.id });
    return Response.json({ ok: true, run: run.id, pages, next_table: run.tables[cursor.ti]?.name ?? null, duration_ms: Date.now() - started });
  } catch (err) {
    await rpc("backup_fail_attempt", { p_run: run.id, p_error: String(err) }).catch(() => {});
    return Response.json({ ok: false, run: run.id, error: String(err), duration_ms: Date.now() - started }, { status: 500 });
  }
});
