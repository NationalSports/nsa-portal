# NSA Connect: the portal as a phone app

Reps install the portal on their home screen (it opens full screen, with its own icon)
and get push notifications. This is the web-app (PWA) step; the App Store / Play Store
build comes next and reuses all of it.

## What's in the code

- `public/manifest.webmanifest`, icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`, `badge-96.png`). The manifest is attached only after a staff
  sign-in (`src/lib/pushClient.js` → `setupAppShell`), so store and coach pages don't offer
  "install the staff portal".
- `public/sw.js`: service worker for notifications only. No offline cache on purpose, so
  nobody gets stuck on an old build. Tapping a notification opens its link (`?so=`, `?est=`,
  `?inv=`, `?cust=`, AI Notes), on the phone and on desktop.
- `netlify/functions/push-subscribe.js`: subscribe / unsubscribe / test / @mention.
  `_push.js` sends; dead devices are removed automatically; every event is sent once
  (`push_sent`).
- Notifications: coach approves art or asks for changes, coach approves a quote
  (`portal-action.js`), customer pays online (`_shared.js` reconcile), AI notes ready
  (`_meetingPipeline.js`), @mentions in messages (App message save).
- Phone: More → **App & alerts** (install steps for iPhone/Android, turn on, send a test),
  plus a dismissible card on the home screen.

## Setup (one time)

1. Apply `supabase/migrations/20261006120000_push_subscriptions.sql`.
2. Make the keys on your Mac: `npx web-push generate-vapid-keys`
3. In Netlify → Site configuration → Environment variables, add:
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key (keep it secret)
   - optional `VAPID_SUBJECT` = `mailto:hello@nationalsportsapparel.com`
4. Redeploy. Then on a phone: open the portal → More → App & alerts.

## iPhone notes

- Notifications on iPhone need iOS 16.4+ and the app added to the Home Screen from Safari.
- If a rep blocks notifications, they turn them back on in Settings → Notifications → NSA Connect.
