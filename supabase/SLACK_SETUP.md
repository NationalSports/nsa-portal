# Slack Integration Setup — NSA Portal

## How It Works

```
Portal Message → Supabase DB → slack-notify Edge Function → Slack DM
Slack Reply    → Slack Events API → slack-reply Edge Function → Portal Message
```

- Someone posts a message on an SO (e.g. warehouse asks about navy XLs)
- Anyone @mentioned or subscribed to that department gets a Slack DM
- They reply in the Slack thread → reply posts back to the SO in the portal
- Full bidirectional: Slack ↔ Portal

---

## Step 1: Create a Slack Workspace

1. Go to https://slack.com/get-started#/createnew
2. Create workspace (e.g. "NSA Teamwear")
3. Invite your team (Steve, Denis, Liliana, Laura, Mike)

## Step 2: Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: `NSA Portal Bot`
4. Workspace: select your workspace
5. Click **Create App**

### Bot Token Scopes

Go to **OAuth & Permissions** → **Bot Token Scopes** and add:

| Scope | Why |
|-------|-----|
| `chat:write` | Send DMs |
| `im:write` | Open DM conversations |
| `im:history` | Read thread replies |
| `users:read` | Look up user info |
| `users:read.email` | Match Slack users to portal users |

### Event Subscriptions

Go to **Event Subscriptions** → toggle ON:

1. **Request URL**: `https://<your-supabase-project>.supabase.co/functions/v1/slack-reply`
   - Slack will send a verification challenge — the Edge Function handles this automatically
2. Under **Subscribe to bot events**, add:
   - `message.im` (DM messages — catches thread replies)

### Install to Workspace

Go to **Install App** → **Install to Workspace** → Authorize

Copy two values:
- **Bot User OAuth Token** (`xoxb-...`)
- **Signing Secret** (under Basic Information → App Credentials)

## Step 3: Configure Supabase

### Option A: Via SQL (Supabase SQL Editor)

```sql
UPDATE public.app_settings SET value = 'xoxb-YOUR-BOT-TOKEN' WHERE key = 'slack_bot_token';
UPDATE public.app_settings SET value = 'YOUR-SIGNING-SECRET'  WHERE key = 'slack_signing_secret';
```

### Option B: Via environment variables

Set these as Supabase Edge Function secrets:

```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-...
supabase secrets set SLACK_SIGNING_SECRET=...
```

## Step 4: Set Up Database Webhook

In Supabase Dashboard → **Database** → **Webhooks**:

1. Click **Create a new hook**
2. **Name**: `slack-notify-on-message`
3. **Table**: `messages`
4. **Events**: `INSERT`
5. **Type**: Supabase Edge Functions
6. **Function**: `slack-notify`
7. Save

## Step 5: Link Team Members

Each person needs their Slack Member ID linked in the portal.

To find a Slack Member ID:
1. In Slack, click on someone's profile
2. Click the "..." menu → **Copy member ID**

Then update their profile:

```sql
UPDATE public.user_profiles
SET slack_user_id = 'U04XXXXXXXX'
WHERE full_name = 'Steve Peterson';

UPDATE public.user_profiles
SET slack_user_id = 'U04YYYYYYYY'
WHERE full_name = 'Denis';

-- ... repeat for each team member
```

## Step 6: Deploy Edge Functions

```bash
supabase functions deploy slack-notify
supabase functions deploy slack-reply
```

---

## What Each Person Gets

| Event | Who gets notified |
|-------|-------------------|
| `@Steve` in a message | Steve gets a DM |
| Message tagged `@Production` | Anyone subscribed to production dept |
| Any message on an SO | The rep who owns that SO |
| Reply in Slack thread | Posts back to portal automatically |

## Notification Preferences

Users can control notifications via their profile:

```sql
-- Opt out of Slack notifications entirely
UPDATE user_profiles SET notify_slack = false WHERE full_name = 'Denis';

-- Only get notified for specific departments
UPDATE user_profiles SET notify_depts = '{production,warehouse}' WHERE full_name = 'Liliana';

-- Get notified for everything (default)
UPDATE user_profiles SET notify_depts = '{}' WHERE full_name = 'Steve Peterson';
```

## Testing

1. Post a message on any SO in the portal with `@Steve` in the text
2. Steve should get a Slack DM within ~2 seconds
3. Steve replies in the Slack thread
4. The reply should appear in the portal's SO message thread

Check `slack_notifications` table for delivery logs if something isn't working:

```sql
SELECT sn.*, up.full_name, m.body
FROM slack_notifications sn
JOIN user_profiles up ON up.id = sn.recipient_id
JOIN messages m ON m.id = sn.message_id
ORDER BY sn.created_at DESC
LIMIT 20;
```
