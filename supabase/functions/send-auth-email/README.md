# send-auth-email

Supabase Auth **Send Email** hook. GoTrue calls this function for every
transactional auth email (password recovery, signup confirmation, magic link,
invite, email change, reauthentication) instead of sending it through SMTP. We
render a branded email and send it via **Brevo**.

## Why

GoTrue's custom-SMTP path was delivering **broken reset links**. The
confirmation URL (`.../auth/v1/verify?token=<hash>&type=recovery&...`) was sent
in a quoted-printable body without escaping the `=` in `token=` to `=3D`. Mail
clients then decoded `=` + the first two hex chars of the token as a single
byte, so every link arrived mangled at the `token=` boundary and failed /
looked like it had no link.

Sending through Brevo's JSON API avoids quoted-printable encoding entirely, so
the link is delivered intact.

## One-time setup (production)

These steps happen in the Supabase dashboard / CLI — they are **not** part of
the Netlify deploy and must be done once for the fix to take effect.

1. **Set function secrets** (Project Settings → Edge Functions → Secrets, or
   `supabase secrets set`):
   - `BREVO_API_KEY` — already present for the other functions.
   - `SEND_EMAIL_HOOK_SECRET` — the `v1,whsec_...` value generated in step 3.
   - *(optional)* `AUTH_EMAIL_SENDER_NAME` (default `National Sports Apparel`)
   - *(optional)* `AUTH_EMAIL_SENDER_EMAIL` (default
     `noreply@nationalsportsapparel.com`)

2. **Deploy without JWT verification** — GoTrue authenticates with a Standard
   Webhooks signature, not a Supabase JWT:
   ```
   supabase functions deploy send-auth-email --no-verify-jwt
   ```

3. **Enable the hook**: Authentication → Hooks → **Send Email** → enable, set
   the URL to this function
   (`https://<project-ref>.supabase.co/functions/v1/send-auth-email`), and copy
   the generated secret into `SEND_EMAIL_HOOK_SECRET` (step 1).

## Verify

Trigger a password reset from the Portal login screen ("Forgot your
password?"). The email should arrive from Brevo with a working **Reset
Password** button whose URL contains an intact `token=<hash>`.

Rollback: disable the Send Email hook in the dashboard — GoTrue reverts to its
built-in SMTP emails immediately.
