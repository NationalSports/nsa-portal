// supabase/functions/slack-reply/index.ts
// ─────────────────────────────────────────────────────────
// Receives Slack Events API callbacks (message events).
// When someone replies in a Slack thread that was created by
// slack-notify, this function posts that reply back into the
// portal's message thread on the corresponding SO.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/crypto/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Verify Slack signature ────────────────────────────

async function getSigningSecret(): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "slack_signing_secret")
    .single();
  return data?.value || "";
}

async function verifySlackSignature(
  req: Request,
  rawBody: string
): Promise<boolean> {
  const secret = await getSigningSecret();
  if (!secret) return false;

  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBasestring));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hex}`;

  return expected === signature;
}

// ─── Look up portal user by Slack ID ───────────────────

async function findUserBySlackId(slackUserId: string) {
  const { data } = await supabase
    .from("user_profiles")
    .select("id, full_name")
    .eq("slack_user_id", slackUserId)
    .single();
  return data;
}

// ─── Find the original portal message by Slack thread ──

async function findOriginalMessage(channelId: string, threadTs: string) {
  // The notification we sent has the slack_ts and slack_channel stored
  const { data } = await supabase
    .from("slack_notifications")
    .select("message_id")
    .eq("slack_channel", channelId)
    .eq("slack_ts", threadTs)
    .limit(1)
    .single();

  if (!data) return null;

  // Get the actual portal message to find the SO
  const { data: msg } = await supabase
    .from("messages")
    .select("id, so_id")
    .eq("id", data.message_id)
    .single();

  return msg;
}

// Also check if the message table itself has the slack_ts
async function findMessageBySlackThread(channelId: string, threadTs: string) {
  const { data } = await supabase
    .from("messages")
    .select("id, so_id")
    .eq("slack_channel", channelId)
    .eq("slack_ts", threadTs)
    .limit(1)
    .single();
  return data;
}

// ─── Main handler ──────────────────────────────────────

serve(async (req: Request) => {
  const rawBody = await req.text();

  // Slack sends a URL verification challenge on app setup
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: parsed.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    // Not JSON, continue
  }

  // Verify signature
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody);

    // We only care about message events that are thread replies
    if (payload.type !== "event_callback") {
      return new Response("ok", { status: 200 });
    }

    const event = payload.event;

    // Only handle message events (not subtypes like bot_message)
    if (event.type !== "message" || event.subtype || !event.thread_ts) {
      return new Response("ok", { status: 200 });
    }

    // Don't loop on our own bot's messages
    if (event.bot_id) {
      return new Response("ok", { status: 200 });
    }

    const slackUserId: string = event.user;
    const channelId: string = event.channel;
    const threadTs: string = event.thread_ts;
    const replyText: string = event.text;

    // Look up who this Slack user is in our system
    const portalUser = await findUserBySlackId(slackUserId);
    if (!portalUser) {
      console.log(`Unknown Slack user ${slackUserId}, ignoring reply`);
      return new Response("ok", { status: 200 });
    }

    // Find the original portal message this thread belongs to
    let originalMsg = await findMessageBySlackThread(channelId, threadTs);
    if (!originalMsg) {
      originalMsg = await findOriginalMessage(channelId, threadTs);
    }
    if (!originalMsg) {
      console.log(`No matching portal message for thread ${threadTs} in ${channelId}`);
      return new Response("ok", { status: 200 });
    }

    // Insert the reply as a new portal message on the same SO
    const { data: newMsg, error } = await supabase
      .from("messages")
      .insert({
        so_id: originalMsg.so_id,
        author_id: portalUser.id,
        dept: "all",
        body: replyText,
        slack_ts: event.ts, // this reply's own ts
        slack_channel: channelId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to insert reply:", error);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 200,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        portal_message_id: newMsg?.id,
        so_id: originalMsg.so_id,
        from: portalUser.full_name,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("slack-reply error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
