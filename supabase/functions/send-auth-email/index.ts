// supabase/functions/send-auth-email/index.ts
// ─────────────────────────────────────────────────────────
// Supabase Auth "Send Email" hook.
//
// GoTrue calls this function for every transactional auth email
// (signup confirmation, password recovery, magic link, invite,
// email change, reauthentication) INSTEAD of sending the email
// itself. We render a branded email and send it through Brevo —
// the same provider `send-scheduled-emails` and the Netlify
// invite functions already use.
//
// WHY THIS EXISTS
// ---------------
// GoTrue's built-in custom-SMTP path was shipping recovery links
// that arrived broken: the confirmation URL is sent in a
// quoted-printable body, but the `=` in `...?token=<hash>` was not
// escaped to `=3D`, so mail clients decoded `=` + the first two
// hex chars of the token as a single byte. Every reset/confirm
// link landed mangled at the `token=` boundary. Sending via
// Brevo's JSON API sidesteps quoted-printable entirely, so the
// link is delivered intact.
//
// SETUP (Supabase dashboard / project config — see README.md):
//   1. Set the function secrets:
//        BREVO_API_KEY            (already set for other functions)
//        SEND_EMAIL_HOOK_SECRET   (the "v1,whsec_..." value the
//                                  dashboard generates when you add
//                                  the hook)
//      Optional overrides:
//        AUTH_EMAIL_SENDER_NAME   (default "National Sports Apparel")
//        AUTH_EMAIL_SENDER_EMAIL  (default noreply@nationalsportsapparel.com)
//   2. Deploy WITHOUT JWT verification (GoTrue authenticates with a
//      Standard Webhooks signature, not a Supabase JWT):
//        supabase functions deploy send-auth-email --no-verify-jwt
//   3. Auth → Hooks → "Send Email" hook → enable, point it at this
//      function's URL, and paste the generated secret.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
// The dashboard stores the secret as "v1,whsec_<base64>"; the verifier wants the base64 part.
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace(/^v1,whsec_/, "");
const SENDER_NAME = Deno.env.get("AUTH_EMAIL_SENDER_NAME") ?? "National Sports Apparel";
const SENDER_EMAIL = Deno.env.get("AUTH_EMAIL_SENDER_EMAIL") ?? "noreply@nationalsportsapparel.com";

type EmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email_change_current"
  | "email_change_new"
  | "reauthentication";

type HookPayload = {
  user: { email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );

// Build the GoTrue verification URL. Because this is assembled in code and
// shipped as JSON to Brevo (not quoted-printable), the `=` characters survive.
function verifyUrl(tokenHash: string, type: string, redirectTo: string): string {
  const u = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  u.searchParams.set("token", tokenHash);
  u.searchParams.set("type", type);
  if (redirectTo) u.searchParams.set("redirect_to", redirectTo);
  return u.toString();
}

function shell(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#191919;color:white;padding:20px 22px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">${esc(heading)}</h2>
      </div>
      <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        ${bodyHtml}
        <p style="font-size:11.5px;color:#94a3b8;margin-top:18px">National Sports Apparel · Portal</p>
      </div>
    </div>`;
}

function button(url: string, label: string): string {
  return `<a href="${esc(url)}" style="display:inline-block;background:#1e40af;color:#fff;border-radius:8px;padding:12px 26px;font-weight:700;text-decoration:none;font-size:15px">${esc(label)}</a>`;
}

function fallback(url: string): string {
  return `<p style="font-size:12px;color:#64748b;line-height:1.6;margin:16px 0 0">If the button doesn't work, copy and paste this link into your browser:<br><span style="color:#1e40af;word-break:break-all">${esc(url)}</span></p>`;
}

function render(p: HookPayload): { subject: string; html: string } {
  const { email_data } = p;
  const type = email_data.email_action_type;
  const link = verifyUrl(email_data.token_hash, type, email_data.redirect_to);
  const para = (t: string) =>
    `<p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">${t}</p>`;

  switch (type) {
    case "recovery":
      return {
        subject: "Reset your National Sports Apparel Portal password",
        html: shell("Reset your password", [
          para("We received a request to reset the password for your Portal account. Click the button below to choose a new one. This link expires in 1 hour and can be used once."),
          button(link, "Reset Password"),
          para('<span style="font-size:12.5px;color:#64748b">Didn\'t request this? You can safely ignore this email — your password won\'t change.</span>'),
          fallback(link),
        ].join("")),
      };
    case "signup":
      return {
        subject: "Confirm your National Sports Apparel Portal account",
        html: shell("Confirm your account", [
          para("Welcome! Confirm your email address to finish setting up your Portal account."),
          button(link, "Confirm Email"),
          fallback(link),
        ].join("")),
      };
    case "invite":
      return {
        subject: "You've been invited to the National Sports Apparel Portal",
        html: shell("You're invited", [
          para("You've been invited to the National Sports Apparel Portal. Click below to accept the invite and set your password."),
          button(link, "Accept Invite"),
          fallback(link),
        ].join("")),
      };
    case "magiclink":
      return {
        subject: "Your National Sports Apparel Portal sign-in link",
        html: shell("Sign in to the Portal", [
          para("Click the button below to sign in. This link expires in 1 hour and can be used once."),
          button(link, "Sign In"),
          fallback(link),
        ].join("")),
      };
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return {
        subject: "Confirm your new National Sports Apparel Portal email",
        html: shell("Confirm your email change", [
          para("Confirm this address to finish changing the email on your Portal account."),
          button(link, "Confirm Email Change"),
          fallback(link),
        ].join("")),
      };
    case "reauthentication":
      return {
        subject: "Your National Sports Apparel Portal verification code",
        html: shell("Verification code", [
          para("Enter this code to confirm it's you:"),
          `<p style="font-size:28px;font-weight:800;letter-spacing:4px;color:#0f172a;margin:0 0 8px">${esc(email_data.token)}</p>`,
          para('<span style="font-size:12.5px;color:#64748b">This code expires shortly. If you didn\'t request it, you can ignore this email.</span>'),
        ].join("")),
      };
    default:
      return {
        subject: "National Sports Apparel Portal",
        html: shell("National Sports Apparel Portal", [
          para("Click below to continue."),
          button(link, "Continue"),
          fallback(link),
        ].join("")),
      };
  }
}

async function sendViaBrevo(to: string, subject: string, html: string): Promise<void> {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Brevo HTTP ${r.status}: ${detail}`);
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!BREVO_API_KEY || !HOOK_SECRET) {
    return new Response(
      JSON.stringify({ error: { message: "Hook not configured (BREVO_API_KEY / SEND_EMAIL_HOOK_SECRET missing)" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const raw = await req.text();
  const headers = Object.fromEntries(req.headers);

  let payload: HookPayload;
  try {
    const wh = new Webhook(HOOK_SECRET);
    payload = wh.verify(raw, headers) as HookPayload;
  } catch (_e) {
    // Signature mismatch — reject so GoTrue doesn't treat the email as sent.
    console.error("[send-auth-email] Signature verification failed:", (_e as Error).message);
    return new Response(JSON.stringify({ error: { message: "Invalid signature" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.log("[send-auth-email] Verified payload for:", payload.user.email, "type:", payload.email_data?.email_action_type);

  try {
    const { subject, html } = render(payload);
    await sendViaBrevo(payload.user.email, subject, html);
  } catch (e) {
    // GoTrue surfaces a non-2xx as a send failure and will not mark the email sent.
    console.error("[send-auth-email] Brevo error:", (e as Error).message);
    return new Response(JSON.stringify({ error: { message: (e as Error).message } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GoTrue expects an empty 200 on success.
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
