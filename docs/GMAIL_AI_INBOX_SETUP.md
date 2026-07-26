# Gmail AI Inbox setup

This integration imports mail from `sales@nationalsportsapparel.com`, analyzes
the request, checks Connect inventory, prepares a draft estimate, and creates a
reply draft in the original Gmail thread. It never sends Gmail messages.

## 1. Configure Google Workspace

1. In a company-owned Google Cloud project, enable the Gmail API.
2. Configure the OAuth consent screen as **Internal** for the National Sports
   Apparel Workspace organization.
3. Create an OAuth client for a **Desktop app**.
4. Keep the client ID, client secret, and refresh token out of Git.

The integration requests only:

- `gmail.readonly` to read incoming sales messages
- `gmail.compose` to create reply drafts

Google classifies these as restricted Gmail scopes. Keep the OAuth app
internal-only. A public/external app may require Google verification and
additional security review.

Generate the refresh token locally:

```bash
cd /Users/stevepete/nsa-portal
GMAIL_CLIENT_ID='...' GMAIL_CLIENT_SECRET='...' node scripts/gmail-oauth-setup.js
```

Open the printed URL while signed into
`sales@nationalsportsapparel.com`, approve access, and copy the resulting
`GMAIL_REFRESH_TOKEN`.

## 2. Configure secrets

Add these server-only environment variables to the NSA Portal Netlify site:

```text
GMAIL_AI_INBOX=sales@nationalsportsapparel.com
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_AI_SYNC_SECRET=<a long random value>
SUPABASE_SERVICE_ROLE_KEY=...
```

The existing `REACT_APP_SUPABASE_URL` must remain configured. Do not prefix any
Gmail secret with `REACT_APP_`; React would expose it to the browser.

The Supabase project must already have `ANTHROPIC_API_KEY`. Optionally set
`AI_EMAIL_ASSISTANT_MODEL` to override the model used by the email assistant.

## 3. Apply and deploy

From the linked Supabase project:

```bash
supabase db push
supabase functions deploy ai-email-assistant
```

Then deploy the Netlify site. `netlify.toml` runs `gmail-ai-sync` every five
minutes. Netlify scheduled functions run only on published production deploys.

For a manual production smoke test, call the function with the configured
secret:

```bash
curl -H "x-gmail-ai-secret: $GMAIL_AI_SYNC_SECRET" \
  "https://nsa-portal.netlify.app/.netlify/functions/gmail-ai-sync"
```

## 4. Staff workflow

1. Open **AI Inbox** in Connect.
2. Review the AI summary, customer match, item extraction, and stock check.
3. Correct the customer or request details if needed.
4. Choose **Create Draft Estimate**.
5. Review pricing, decoration, shipping, quantities, and availability in the
   normal estimate editor.
6. Open the existing Send Estimate dialog.
7. Choose **Create Gmail Draft**.
8. Open Gmail, review the threaded response and attached PDF, then send it
   manually.

The regular **Send Estimate** button still uses Brevo. Gmail drafting is shown
only for estimates that originated in the AI Inbox.

## Rep-forwarded commands

An active Connect rep or admin can forward a customer's message to
`sales@nationalsportsapparel.com` and put a short command above the standard
forwarded-message header. Examples:

```text
Process FPU basketball's latest estimate and add the Adidas items to CLICK cart.
```

```text
When will the FPU stunt order ship?
```

For a verified rep forward, the assistant separates the rep's instruction from
the untrusted forwarded content, matches relevant customers, estimates, sales
orders, jobs, purchase-order lines, and tracking records, and proposes an
action in **AI Inbox**.

As soon as the verified request is accepted, Gmail automatically replies to
the forwarding rep in the same thread. The acknowledgement says processing has
started and includes a signed-in Connect link to **AI Tasks**. It is sent only
to the verified employee address, never to the forwarded customer.

**AI Tasks** combines:

- current and past rep email requests;
- all queued, scheduled, running, input-needed, and review-needed bot jobs;
- completed and failed bot history;
- acknowledgement delivery status and links back to the source AI Inbox item.

Cart commands are never executed from email alone:

1. A rep or admin reviews the matched customer, estimate, SKUs, sizes, and
   quantities.
2. They click **Approve & Queue CLICK Cart**.
3. The existing `bot-claude` worker signs in to Adidas CLICK and prepares the
   cart.
4. The worker stops before checkout and marks the task for review. It never
   places the order.

If no customer PO exists, the worker leaves the CLICK Customer PO field blank.
It does not invent one. The first version supports Adidas CLICK lines only;
unmatched SKUs, missing sizes, ambiguous records, or non-Adidas items remain
blocked for human clarification.

## Security and operating notes

- Incoming email is untrusted input. The model is instructed not to follow
  embedded instructions, and it cannot send mail.
- Only active `rep`, `admin`, and `super_admin` addresses can create rep
  commands. A normal customer email can never authorize a cart change.
- Automatic acknowledgements are restricted to those verified employee
  forwards. They contain no customer attachment and do not authorize vendor
  activity.
- Cart commands require a second approval from an authenticated Connect rep or
  admin and are idempotent per inbox message.
- Gmail and Supabase credentials are used only by server functions.
- Inbox records are hidden from anonymous users and limited to authenticated,
  active staff through RLS.
- Estimate pricing and stock must be reviewed by staff before a Gmail draft is
  created.
- The Gmail endpoint accepts drafts only from an authenticated Connect staff
  session and caps attachment payload size.
