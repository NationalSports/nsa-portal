// supabase/functions/daily-backup/index.ts
// ─────────────────────────────────────────────────────────
// Full-database snapshot, uploaded to the private `backups`
// storage bucket. Two modes:
//   • daily  (default)        → backup-YYYY-MM-DD.json.gz, kept RETENTION_DAYS
//   • intraday (body {intraday:true}) → backup-YYYY-MM-DDTHHMM.json.gz,
//     kept INTRADAY_RETENTION_DAYS. Timestamped so frequent runs never
//     overwrite each other (or the daily file), shrinking the recovery
//     window from ~24h to the intraday cadence.
//
// Triggered by pg_cron (daily at 07:00 UTC + intraday every few hours).
// Can also be invoked manually with an authenticated POST for an
// on-demand snapshot.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const RETENTION_DAYS = 30;
const INTRADAY_RETENTION_DAYS = 4; // timestamped intraday snapshots are kept this long
const PAGE_SIZE = 1000;
const BUCKET = "backups";

// Every app table whose contents we want in the nightly snapshot.
// Keep alphabetized; add new tables as the schema grows.
const TABLES = [
  "adidas_inventory",
  "app_settings",
  "app_state",
  "assigned_todos",
  "customer_contacts",
  "customer_credit_usage",
  "customer_credits",
  "customer_promo_periods",
  "customer_promo_programs",
  "customer_promo_usage",
  "customers",
  "deco_vendor_pricing",
  "deco_vendors",
  "decoration_types",
  "dismissed_notifs",
  "dismissed_todos",
  "estimate_art_files",
  "estimate_item_decorations",
  "estimate_items",
  "estimates",
  "id_sequences",
  "inventory",
  "inventory_adjustments",
  "invoice_items",
  "invoice_payments",
  "invoices",
  "issues",
  "labor_rates",
  "message_reads",
  "messages",
  "omg_store_products",
  "omg_stores",
  "price_matrix",
  "product_inventory",
  "product_variants",
  "products",
  "rep_csr_assignments",
  "sales_orders",
  "so_art_files",
  "so_firm_dates",
  "so_item_decorations",
  "so_item_pick_lines",
  "so_item_po_lines",
  "so_items",
  "so_jobs",
  "team_members",
  "time_entries",
  "todo_comments",
  "user_profiles",
  "vendors",
];

// Returns the table's rows, or null if the table doesn't exist (renamed/dropped/not yet created).
// A single missing table must never abort the whole backup — that's how the snapshot silently broke before.
async function dumpTable(name: string): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(name)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      const msg = error.message || "";
      if (
        msg.includes("does not exist") ||
        msg.includes("Could not find the table") ||
        error.code === "PGRST205" ||
        error.code === "42P01"
      ) {
        return null; // table absent — skip it, keep backing up the rest
      }
      throw new Error(`${name}: ${msg}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function gzip(input: string): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function pruneOldBackups(): Promise<string[]> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`list backups: ${error.message}`);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const intradayCutoff = new Date();
  intradayCutoff.setUTCDate(intradayCutoff.getUTCDate() - INTRADAY_RETENTION_DAYS);

  const toDelete: string[] = [];
  for (const f of files ?? []) {
    // Daily snapshot: backup-YYYY-MM-DD.json[.gz]
    const daily = f.name.match(/^backup-(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/);
    if (daily) {
      if (new Date(daily[1] + "T00:00:00Z") < cutoff) toDelete.push(f.name);
      continue;
    }
    // Intraday snapshot: backup-YYYY-MM-DDTHHMM.json.gz — shorter retention
    const intra = f.name.match(/^backup-(\d{4}-\d{2}-\d{2})T\d{4}\.json\.gz$/);
    if (intra) {
      if (new Date(intra[1] + "T00:00:00Z") < intradayCutoff) toDelete.push(f.name);
      continue;
    }
  }

  if (toDelete.length) {
    const { error: delErr } = await supabase.storage.from(BUCKET).remove(toDelete);
    if (delErr) throw new Error(`prune: ${delErr.message}`);
  }
  return toDelete;
}

serve(async (_req: Request) => {
  const started = Date.now();
  // Intraday runs (frequent cron) pass {intraday:true} so the file is timestamped and never overwrites
  // the daily snapshot or a prior intraday one. Missing/empty body → daily mode.
  let intraday = false;
  try { const body = await _req.json(); intraday = !!body?.intraday; } catch { /* no/invalid body → daily */ }
  try {
    const snapshot: Record<string, unknown[]> = {};
    const rowCounts: Record<string, number> = {};
    const skipped: string[] = [];

    for (const table of TABLES) {
      const rows = await dumpTable(table);
      if (rows === null) { skipped.push(table); continue; }
      snapshot[table] = rows;
      rowCounts[table] = rows.length;
    }

    const payload = {
      _meta: {
        version: "1.0",
        app: "NSA Portal",
        created_at: new Date().toISOString(),
        retention_days: RETENTION_DAYS,
        row_counts: rowCounts,
        skipped_tables: skipped,
        total_rows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
      },
      data: snapshot,
    };

    const json = JSON.stringify(payload);
    const gz = await gzip(json);

    const iso = new Date().toISOString();        // 2026-05-29T14:30:05.123Z
    const date = iso.split("T")[0];              // 2026-05-29
    // Daily file is overwritten each day; intraday files are timestamped (HHMM) so each run is distinct.
    const filename = intraday
      ? `backup-${date}T${iso.slice(11, 16).replace(":", "")}.json.gz`
      : `backup-${date}.json.gz`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(filename, gz, {
      contentType: "application/gzip",
      upsert: true,
    });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const pruned = await pruneOldBackups();

    return new Response(
      JSON.stringify({
        ok: true,
        mode: intraday ? "intraday" : "daily",
        file: filename,
        bytes_uncompressed: json.length,
        bytes_compressed: gz.byteLength,
        total_rows: payload._meta.total_rows,
        skipped_tables: skipped,
        pruned,
        duration_ms: Date.now() - started,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err), duration_ms: Date.now() - started }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
