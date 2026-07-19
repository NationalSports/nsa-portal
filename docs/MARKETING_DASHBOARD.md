# Marketing Command Center (`?pg=marketing`)

One portal page for NSA's whole online presence, behind the normal staff
login: the SEO Command Center's data (mirrored from the marketing site), plus
Google reviews (with AI-drafted replies), Yelp, and Brevo email campaigns.
Replaces the standalone passcode-gated `seo-command.html` on
nationalsportsapparel.com (which stays up as a fallback for now).

## How it works

```
Claude SEO Autopilot (weekly, nsa-website repo)
        └─ writes  nsa-website/public/seo/data.json   ← source of truth for SEO/AI data
                                    │  read daily
marketing-sync  (Netlify function, cron 13:00 UTC via marketing-sync-cron)
  ├─ seo     → fetches that data.json                       (no credentials)
  ├─ brevo   → api.brevo.com campaigns + rollup             (BREVO_API_KEY — already set)
  ├─ yelp    → Yelp Fusion rating + recent reviews          (YELP_API_KEY + YELP_BUSINESS_ID)
  └─ google  → GBP OAuth (full, reply-capable) or Places API (read-only fallback)
        └─ upserts  marketing_data (snapshot) + marketing_history (append)   [Supabase, RLS: staff read]
                                    │  read (staff JWT)
                    /marketing page (src/MarketingPage.js)
                      ├─ "Draft with AI"  → marketing-draft-reply  (ANTHROPIC_API_KEY — already set)
                      └─ "Post reply"     → marketing-gbp-reply    (GBP OAuth secrets)
```

- The SEO autopilot pipeline in `nsa-website` is untouched — the portal only
  reads its output. Don't move that logic here.
- A source with no credentials reports `skipped: missing_key`; its panel shows
  an awaiting-setup card. Nothing breaks while keys are pending.
- Review replies are strictly human-in-the-loop: the AI draft fills an
  editable box; only the text Steve confirms is posted, via his own GBP OAuth.
- Manual run: the page's **Sync now** button (staff JWT), or the daily cron.

## Secrets checklist (Netlify env vars — Site settings → Environment variables)

| Var | Status | Where to get it |
|---|---|---|
| `BREVO_API_KEY` | ✅ already set (transactional email uses it) | — |
| `ANTHROPIC_API_KEY` | ✅ already set (AI features use it) | — |
| `YELP_API_KEY` | ⬜ needed for Yelp panel | yelp.com/developers/v3/manage_app → create app |
| `YELP_BUSINESS_ID` | ⬜ | the slug in NSA's Yelp URL (e.g. `national-sports-apparel-orange`) |
| `GOOGLE_PLACES_API_KEY` | ⬜ Google fast path (read-only) | Google Cloud (`nsa-seo` project) → enable **Places API** → API key |
| `NSA_PLACE_ID` | ⬜ | Google "Place ID Finder" for the NSA listing |
| `GBP_CLIENT_ID` / `GBP_CLIENT_SECRET` / `GBP_REFRESH_TOKEN` | ⬜ Google full path (**enables replies**) | see below |
| `MARKETING_REPLY_MODEL` | optional | override the reply-draft model (default `claude-sonnet-5`) |

When both Google paths are configured, GBP wins (it carries reply capability
and all reviews, not just 5). Places is worth setting up first anyway — the
panel goes live the same day, while GBP API access approval can take days.

## GBP OAuth one-time setup (for review replies)

Google requires a real owner/manager of the Business Profile to consent —
a service account does NOT work for review replies.

1. Google Cloud, `nsa-seo` project: enable **Google Business Profile API**
   (and the legacy **My Business API v4**, which still serves reviews), and
   request access via Google's *Business Profile APIs access request form*
   (approval can take a few days — start early).
2. Configure the OAuth consent screen; create an **OAuth Client (Web
   application)** → that's `GBP_CLIENT_ID` / `GBP_CLIENT_SECRET`.
3. Mint a refresh token as the Google account that manages NSA's profile,
   scope `https://www.googleapis.com/auth/business.manage` — easiest via the
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
   (gear icon → "Use your own OAuth credentials", authorize the scope,
   exchange for tokens) → the refresh token is `GBP_REFRESH_TOKEN`.
4. Set all three in Netlify env, redeploy (env changes need a redeploy),
   press **Sync now** on the page — the Google panel switches to the GBP
   provider and Reply buttons appear.

## Pieces

| Piece | File |
|---|---|
| Page | `src/MarketingPage.js` (routed as `pg==='marketing'` in `src/App.js`) |
| Sync (all sources) | `netlify/functions/marketing-sync.js` |
| Daily trigger | `netlify/functions/marketing-sync-cron.js` + schedule in `netlify.toml` |
| AI reply drafts | `netlify/functions/marketing-draft-reply.js` |
| Post reply to Google | `netlify/functions/marketing-gbp-reply.js` |
| Tables + RLS | `supabase/migrations/00221_marketing_dashboard.sql` (applied live) |

Later sources (GA4 traffic, Instagram/Facebook, X, TikTok) follow the same
pattern: add a fetcher to `marketing-sync.js`'s `SOURCES` map storing under a
new `source` key, and a panel in `MarketingPage.js` reading that key.
