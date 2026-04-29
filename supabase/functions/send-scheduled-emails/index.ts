// supabase/functions/send-scheduled-emails/index.ts
// ─────────────────────────────────────────────────────────
// Scheduled email worker. Picks up due rows from the
// `scheduled_emails` table and POSTs them to Brevo, then
// marks each row as sent or failed.
//
// Triggered every 15 minutes by pg_cron (see migration 00067).
// Can also be invoked manually with an authenticated POST to
// flush the queue on demand.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Cap how many we process per invocation so a backlog can't time the function
// out. The cron runs every 15 minutes — the queue will catch up across runs.
const BATCH_SIZE = 25;

// After this many failed attempts we stop retrying so a permanently bad row
// (e.g. malformed recipient) doesn't block the queue forever. Operator can
// reset attempt_count to 0 to retry.
const MAX_ATTEMPTS = 5;

// Rows older than this with status='sent' or 'cancelled' get pruned to keep
// the table small. Failed rows are kept for diagnostics.
const RETENTION_DAYS = 30;

type ScheduledRow = {
  id: string;
  send_at: string;
  to_emails: { email: string; name?: string }[];
  cc_emails: { email: string; name?: string }[];
  subject: string;
  html_content: string;
  sender_name: string | null;
  sender_email: string | null;
  reply_to: { email: string; name?: string } | null;
  attachments: { name: string; content: string }[];
  attempt_count: number;
};

async function sendOne(row: ScheduledRow): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!BREVO_API_KEY) return { ok: false, error: "BREVO_API_KEY not configured" };

  const payload: Record<string, unknown> = {
    sender: {
      name: row.sender_name || "National Sports Apparel",
      email: row.sender_email || "noreply@nationalsportsapparel.com",
    },
    to: row.to_emails,
    subject: row.subject,
    htmlContent: row.html_content,
  };
  if (row.cc_emails && row.cc_emails.length > 0) payload.cc = row.cc_emails;
  if (row.reply_to) payload.replyTo = row.reply_to;
  if (row.attachments && row.attachments.length > 0) payload.attachment = row.attachments;

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.message || `HTTP ${r.status}` };
    return { ok: true, messageId: d.messageId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function pruneOld(): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const { error, count } = await supabase
    .from("scheduled_emails")
    .delete({ count: "exact" })
    .in("status", ["sent", "cancelled"])
    .lt("sent_at", cutoff.toISOString());
  if (error) {
    console.warn("[send-scheduled-emails] prune failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

serve(async (_req: Request) => {
  const started = Date.now();

  const { data: due, error: fetchErr } = await supabase
    .from("scheduled_emails")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("send_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;
  for (const row of (due ?? []) as ScheduledRow[]) {
    const res = await sendOne(row);
    if (res.ok) {
      await supabase
        .from("scheduled_emails")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          message_id: res.messageId ?? null,
          attempt_count: row.attempt_count + 1,
        })
        .eq("id", row.id);
      sent++;
    } else {
      const nextAttempt = row.attempt_count + 1;
      await supabase
        .from("scheduled_emails")
        .update({
          status: nextAttempt >= MAX_ATTEMPTS ? "failed" : "pending",
          error_message: res.error ?? "unknown",
          attempt_count: nextAttempt,
        })
        .eq("id", row.id);
      failed++;
    }
  }

  const pruned = await pruneOld();

  return new Response(
    JSON.stringify({
      ok: true,
      processed: (due ?? []).length,
      sent,
      failed,
      pruned,
      duration_ms: Date.now() - started,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
