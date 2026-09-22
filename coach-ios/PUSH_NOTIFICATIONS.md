# Push notifications — NSA Team Portal

The one coach feature a webview can't do on its own: pushing an alert to the
phone (e.g. **"Your order shipped — tap to track"**). The plumbing is built and
**dormant**; this doc is how to turn it on.

## What's already built (this branch)

| Piece | File | State |
|---|---|---|
| Device-token table | `supabase/migrations/00231_coach_push_tokens.sql` | Ready to apply (not yet applied to prod) |
| Token registration endpoint | `netlify/functions/coach-register-push.js` | Live-safe; stores tokens |
| APNs sender (JWT + HTTP/2, no deps) | `netlify/functions/_apnsPush.js` | Dormant until env vars set |
| App-side registration | `coach-ios/www/app.js` (`registerPush`) | Wired, gated by `ENABLE_PUSH=false` |

Nothing sends or even asks for notification permission until you complete the
steps below, so this can ship in a build with push still "off."

## Flow

```
app launch (team open) ──▶ iOS asks permission ──▶ APNs device token
      │                                                    │
      └──────────── POST /coach-register-push ─────────────┘
                     { alpha_tag, token, platform:'ios' }
                              │  (service role verifies alpha_tag → customer)
                              ▼
                     coach_push_tokens row

order ships / art ready ──▶ _apnsPush.sendToCustomer(admin, customerId, {…}) ──▶ APNs ──▶ phone
```

## Turn it on

**1. Create an APNs Auth Key** — Apple Developer → Keys → **+** → enable Apple
Push Notifications service (APNs). Download the `.p8` **once**. Note the **Key ID**
and your **Team ID**.

**2. Xcode capabilities** — target → Signing & Capabilities → **+ Capability**:
add **Push Notifications** (and **Background Modes → Remote notifications** for
silent pushes later).

**3. Netlify env vars** (portal site — Site settings → Environment variables):
```
APNS_KEY_ID    = <10-char Key ID>
APNS_TEAM_ID   = <Apple Developer Team ID>
APNS_KEY       = <contents of the .p8 — paste the PEM, or base64 it>
APNS_BUNDLE_ID = com.nationalsportsapparel.teamportal   # optional; this is the default
```
(`_apnsPush.js` accepts the key as raw PEM, base64 of the PEM, or with literal `\n`.)

**4. Apply the migration** — run `00231_coach_push_tokens.sql` against Supabase
(your normal migration path).

**5. Flip the app flag** — in `coach-ios/www/app.js` set `ENABLE_PUSH = true`,
then `npx cap copy ios` and rebuild.

## Wire the sends (the product decision — which events)

The sender is one call. From any portal serverless function that already has a
service-role client (`getSupabaseAdmin()` from `_shared`) and the order's
`customer_id`:

```js
const { sendToCustomer } = require('./_apnsPush');
await sendToCustomer(admin, customerId, {
  title: 'Your order shipped 📦',
  body: `${carrier} tracking ${tracking} — tap to track`,
  data: { portal: alphaTag, kind: 'shipped', tracking, carrier },
});
```

`sendToCustomer` loads that team's live tokens, sends, and self-heals dead tokens
(disables on APNs 410). It no-ops with `{skipped:true}` whenever APNs env vars are
absent, so adding the call is safe before you finish setup.

Suggested trigger points (each is a small, additive hook — intentionally left
un-wired pending your call on which to enable and the exact copy):

- **Order shipped + tracking** — where a Sales Order's shipment/tracking is
  recorded. Note `netlify/functions/shipstation-webhook.js` already emails the
  **parent buyer** for team-store orders; the *coach* push is a separate, new
  hook (likely when the coach's SO — not each parent order — ships, to avoid
  per-parent spam).
- **Artwork ready to approve** — when staff sends art to the coach
  (`art_status='waiting_approval'`, `sent_to_coach_at` set).
- **Estimate ready to approve** — when an estimate is sent to the coach
  (`status='sent'`).
- **Team store closing soon / launched** — optional engagement nudges.

Because each event fires from staff/webhook code paths in the portal repo, keep
the copy and the "which events" list a deliberate choice — start with shipped +
art approval (the two coaches ask about most) and expand from there.

## Test

- Simulators can't receive real APNs pushes — test on a physical device.
- A build signed with a **development** provisioning profile yields **sandbox**
  tokens; register those with `environment:'sandbox'` (the app can pass it) or
  point a test at `api.sandbox.push.apple.com`. TestFlight/App Store builds use
  production.
- Quick check: after a real launch, confirm a row lands in `coach_push_tokens`,
  then call `sendToCustomer` from a scratch function with your team's id.
