// supabase/functions/slack-notify/index.ts
// ─────────────────────────────────────────────────────────
// Triggered by a Database Webhook on INSERT to public.messages.
// Sends Slack DMs to:
//   1. Anyone @mentioned by name in the message body
//   2. Anyone subscribed to the tagged department
//   3. The rep who owns the SO (if not the author)
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Slack API helpers ─────────────────────────────────

async function getSlackToken(): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "slack_bot_token")
    .single();
  return data?.value || "";
}

async function getPortalUrl(): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "portal_base_url")
    .single();
  return data?.value || "https://nsa-portal.netlify.app";
}

async function slackPost(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function openDM(token: string, slackUserId: string): Promise<string | null> {
  const res = await slackPost(token, "conversations.open", { users: slackUserId });
  return res.ok ? res.channel?.id : null;
}

async function sendDM(
  token: string,
  channel: string,
  text: string,
  blocks: unknown[],
  threadTs?: string
) {
  return slackPost(token, "chat.postMessage", {
    channel,
    text,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

// ─── Resolve who to notify ─────────────────────────────

interface UserProfile {
  id: string;
  full_name: string;
  slack_user_id: string | null;
  slack_dm_channel: string | null;
  notify_slack: boolean;
  notify_depts: string[];
}

async function getAllUsers(): Promise<UserProfile[]> {
  const { data } = await supabase
    .from("user_profiles")
    .select("id, full_name, slack_user_id, slack_dm_channel, notify_slack, notify_depts")
    .eq("is_active", true);
  return (data || []) as UserProfile[];
}

function findMentionedUsers(body: string, users: UserProfile[]): UserProfile[] {
  // Match @FirstName or @"Full Name" patterns
  const mentioned: UserProfile[] = [];
  for (const u of users) {
    const firstName = u.full_name.split(" ")[0];
    // Check @FirstName (case-insensitive)
    if (new RegExp(`@${firstName}\\b`, "i").test(body)) {
      mentioned.push(u);
    }
    // Check @"Full Name"
    if (body.toLowerCase().includes(`@${u.full_name.toLowerCase()}`)) {
      if (!mentioned.find((m) => m.id === u.id)) mentioned.push(u);
    }
  }
  return mentioned;
}

function findDeptSubscribers(dept: string, users: UserProfile[], exclude: Set<string>): UserProfile[] {
  if (dept === "all") return []; // don't blast everyone on 'all' — only @mentions
  return users.filter(
    (u) =>
      !exclude.has(u.id) &&
      (u.notify_depts.length === 0 || u.notify_depts.includes(dept))
  );
}

// ─── Build Slack message blocks ────────────────────────

function buildBlocks(
  authorName: string,
  soDisplayId: string,
  soMemo: string,
  customerName: string,
  dept: string,
  body: string,
  portalUrl: string
) {
  const deptLabel = dept === "all" ? "" : ` · @${dept}`;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${authorName}* posted on *${soDisplayId}*${deptLabel}\n_${customerName} — ${soMemo}_`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: body },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Portal" },
          url: `${portalUrl}/?so=${soDisplayId}`,
          action_id: "open_portal",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Reply to this thread and it will post back to the SO in the portal.",
        },
      ],
    },
  ];
}

// ─── Main handler ──────────────────────────────────────

serve(async (req: Request) => {
  try {
    // Webhook payload from Supabase (Database Webhook → Edge Function)
    const payload = await req.json();
    const record = payload.record || payload;

    const messageId: string = record.id;
    const soId: string = record.so_id;
    const authorId: string = record.author_id;
    const dept: string = record.dept || "all";
    const body: string = record.body;
    const mentions: string[] = record.mentions || [];

    // Get Slack token
    const token = await getSlackToken();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "No slack_bot_token configured" }), {
        status: 200,
      });
    }

    const portalUrl = await getPortalUrl();

    // Look up SO details
    const { data: so } = await supabase
      .from("sales_orders")
      .select("display_id, memo, customer_id, created_by")
      .eq("id", soId)
      .single();

    if (!so) {
      return new Response(JSON.stringify({ ok: false, error: "SO not found" }), { status: 200 });
    }

    // Look up customer name
    const { data: cust } = await supabase
      .from("customers")
      .select("name, alpha_tag")
      .eq("id", so.customer_id)
      .single();

    const customerName = cust?.alpha_tag || cust?.name || "Unknown";

    // Get all users
    const users = await getAllUsers();
    const author = users.find((u) => u.id === authorId);
    const authorName = author?.full_name || "Unknown";

    // Build recipient list (deduplicated)
    const recipientIds = new Set<string>();
    const recipientReasons = new Map<string, string>();

    // 1. Explicit @mentions from the mentions[] column
    for (const uid of mentions) {
      if (uid !== authorId) {
        recipientIds.add(uid);
        recipientReasons.set(uid, "mention");
      }
    }

    // 2. Parse @Name mentions from message body
    const bodyMentioned = findMentionedUsers(body, users);
    for (const u of bodyMentioned) {
      if (u.id !== authorId && !recipientIds.has(u.id)) {
        recipientIds.add(u.id);
        recipientReasons.set(u.id, "mention");
      }
    }

    // 3. Department subscribers
    const deptSubs = findDeptSubscribers(dept, users, recipientIds);
    for (const u of deptSubs) {
      if (u.id !== authorId) {
        recipientIds.add(u.id);
        recipientReasons.set(u.id, "dept");
      }
    }

    // 4. SO owner (the rep who created the SO) — always notify if not author
    if (so.created_by && so.created_by !== authorId && !recipientIds.has(so.created_by)) {
      recipientIds.add(so.created_by);
      recipientReasons.set(so.created_by, "reply");
    }

    // Send DMs
    const blocks = buildBlocks(authorName, so.display_id, so.memo || "", customerName, dept, body, portalUrl);
    const plainText = `${authorName} on ${so.display_id}: ${body}`;
    const results: Array<{ userId: string; ok: boolean; error?: string }> = [];

    for (const userId of recipientIds) {
      const user = users.find((u) => u.id === userId);
      if (!user?.slack_user_id || !user.notify_slack) {
        // Log skipped — no Slack linked or opted out
        await supabase.from("slack_notifications").upsert({
          message_id: messageId,
          recipient_id: userId,
          reason: recipientReasons.get(userId) || "all",
          delivered: false,
          error: !user?.slack_user_id ? "no_slack_id" : "opted_out",
        }, { onConflict: "message_id,recipient_id" });
        results.push({ userId, ok: false, error: "no_slack_id" });
        continue;
      }

      // Check notification preferences (quiet hours, day schedule, event toggles)
      const reason = recipientReasons.get(userId) || "all";
      const { data: shouldSend } = await supabase.rpc("should_notify", {
        p_user_id: userId,
        p_event_type: reason,
        p_is_urgent: false,
      });

      if (shouldSend === false) {
        await supabase.from("slack_notifications").upsert({
          message_id: messageId,
          recipient_id: userId,
          reason,
          delivered: false,
          error: "quiet_hours_or_prefs",
        }, { onConflict: "message_id,recipient_id" });
        results.push({ userId, ok: false, error: "quiet_hours" });
        continue;
      }

      try {
        // Open or reuse DM channel
        let dmChannel = user.slack_dm_channel;
        if (!dmChannel) {
          dmChannel = await openDM(token, user.slack_user_id);
          if (dmChannel) {
            // Cache the DM channel for next time
            await supabase
              .from("user_profiles")
              .update({ slack_dm_channel: dmChannel })
              .eq("id", user.id);
          }
        }

        if (!dmChannel) {
          await supabase.from("slack_notifications").upsert({
            message_id: messageId,
            recipient_id: userId,
            reason: recipientReasons.get(userId) || "all",
            delivered: false,
            error: "could_not_open_dm",
          }, { onConflict: "message_id,recipient_id" });
          results.push({ userId, ok: false, error: "could_not_open_dm" });
          continue;
        }

        // Send the DM
        const slackRes = await sendDM(token, dmChannel, plainText, blocks);

        // Log success
        await supabase.from("slack_notifications").upsert({
          message_id: messageId,
          recipient_id: userId,
          slack_ts: slackRes.ts,
          slack_channel: dmChannel,
          reason: recipientReasons.get(userId) || "all",
          delivered: slackRes.ok === true,
          error: slackRes.ok ? null : slackRes.error,
        }, { onConflict: "message_id,recipient_id" });

        // Store Slack thread ts on the message for reply threading
        if (slackRes.ok && slackRes.ts) {
          await supabase
            .from("messages")
            .update({ slack_ts: slackRes.ts, slack_channel: dmChannel })
            .eq("id", messageId)
            .is("slack_ts", null); // only set once (first DM)
        }

        results.push({ userId, ok: slackRes.ok });
      } catch (err) {
        await supabase.from("slack_notifications").upsert({
          message_id: messageId,
          recipient_id: userId,
          reason: recipientReasons.get(userId) || "all",
          delivered: false,
          error: String(err),
        }, { onConflict: "message_id,recipient_id" });
        results.push({ userId, ok: false, error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, notified: results.length, results }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
