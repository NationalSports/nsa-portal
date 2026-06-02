# NSA Brevo Relay (static-IP egress)

**Problem this solves:** Brevo emails Steve a *"someone used your API key from a
new IP"* security alert every time the key is used from an IP it hasn't seen.
Our senders run on serverless (Netlify Lambda + a Supabase edge cron), which
egress from a constantly-rotating pool of AWS IPs — so Brevo fired ~50 of those
alerts a day.

**The fix:** run this tiny relay on **one host with a stable outbound IP**.
Every portal sender points at the relay instead of `api.brevo.com`. The relay
holds the real API key and forwards to Brevo, so Brevo only ever sees that one
IP — which you authorize once. The alerts stop *and* you get to keep Brevo's
IP-security feature on.

```
portal senders ──(BREVO_RELAY_URL + x-relay-secret)──▶ relay ──(stable IP)──▶ api.brevo.com
   (Netlify fns, Supabase edge cron)                  (this box)
```

---

## 1. Pick a host with a stable OUTBOUND IP

What matters is the **egress** IP (what Brevo sees), not the inbound one.

- ✅ **Plain VPS** — DigitalOcean / Hetzner / Linode droplet (~$4–6/mo) or **AWS
  EC2 + Elastic IP**. The box's public IPv4 is also its egress IP. **Recommended
  — simplest and the IP is genuinely fixed.**
- ⚠️ **Fly.io** — a *dedicated IPv4* is for **inbound**; outbound traffic is
  NAT'd through a shared pool, so Brevo may still see rotating IPs. Don't use Fly
  for this unless you've confirmed a static egress IP.
- ⚠️ **Render / Railway** — only if the plan documents **static outbound IPs**
  (authorize *all* of them in Brevo). Otherwise same caveat as Fly.

When in doubt, use a VPS.

## 2. Deploy

### Option A — VPS with systemd (recommended)

```bash
# on the box (Node 18+ installed)
git clone <repo> && cd nsa-portal/brevo-relay
sudo tee /etc/brevo-relay.env >/dev/null <<'EOF'
BREVO_API_KEY=xkeysib-...your real key...
RELAY_SECRET=...generate with: openssl rand -hex 32...
PORT=8080
EOF
sudo chmod 600 /etc/brevo-relay.env

sudo tee /etc/systemd/system/brevo-relay.service >/dev/null <<EOF
[Unit]
Description=NSA Brevo relay
After=network.target
[Service]
EnvironmentFile=/etc/brevo-relay.env
WorkingDirectory=$(pwd)
ExecStart=$(command -v node) server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now brevo-relay
curl localhost:8080/health   # -> {"ok":true}
```

Put it behind HTTPS (Caddy/nginx + your domain, or Cloudflare) so callers can
reach `https://brevo-relay.yourdomain.com`. **Outbound** to Brevo still leaves
from the box's own IP regardless of the inbound proxy.

### Option B — Docker

```bash
docker build -t brevo-relay .
docker run -d --restart=always -p 8080:8080 \
  -e BREVO_API_KEY=xkeysib-... \
  -e RELAY_SECRET=$(openssl rand -hex 32) \
  brevo-relay
```

## 3. Authorize the relay's IP in Brevo

1. Find the box's outbound IP — from the box: `curl -4 ifconfig.me`.
2. Brevo dashboard → your account → **Security → Authorized IPs** → add that IP.
3. Keep the feature **enabled**. From now on every send comes from that one IP,
   so no more alerts. (If you previously disabled it, re-enable it now.)

## 4. Point the portal at the relay

Set these and the senders automatically route through the relay (code already
falls back to calling Brevo directly if `BREVO_RELAY_URL` is unset):

**Netlify** (Site settings → Environment variables):
- `BREVO_RELAY_URL` = `https://brevo-relay.yourdomain.com`
- `BREVO_RELAY_SECRET` = the same `RELAY_SECRET` as the relay
- You can **remove** `BREVO_API_KEY` / `REACT_APP_BREVO_API_KEY` from Netlify
  once the relay is confirmed working — the key now lives only on the relay.

**Supabase** (Edge Functions → `send-scheduled-emails` → Secrets):
- `BREVO_RELAY_URL` and `BREVO_RELAY_SECRET` (same values).

Redeploy/clear cache so functions pick up the new env. Send a test email
(e.g. trigger an order confirmation) and confirm it arrives and that Brevo's
**API logs** show the call coming from the relay IP.

## Rollback

Unset `BREVO_RELAY_URL` (and restore `BREVO_API_KEY`) on Netlify/Supabase — the
senders immediately go back to calling Brevo directly. No code change needed.

## Security notes

- `RELAY_SECRET` is the only thing stopping a stranger from sending mail through
  your key — generate a long random value and treat it like a password.
- The relay only proxies `/v3/*` and only when the secret matches; everything
  else is 404/401.
