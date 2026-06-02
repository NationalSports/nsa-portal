// NSA Brevo relay — a tiny static-IP egress for all Brevo API traffic.
//
// WHY THIS EXISTS
// ---------------
// Brevo emails Steve a "someone used your API key from a new IP" security
// alert every time the key is used from an IP it hasn't seen before. Our
// senders run on serverless (Netlify Lambda + a Supabase edge cron), which
// egress from a constantly-rotating pool of AWS IPs, so Brevo fired ~50 of
// those alerts a day.
//
// This relay runs on ONE host with a stable outbound IP. Every portal sender
// points at it (BREVO_RELAY_URL) instead of api.brevo.com. The relay holds the
// real key and forwards to Brevo, so Brevo only ever sees this one IP — which
// you authorize once. Bonus: the API key now lives in exactly one place
// instead of being copied across 8 serverless functions.
//
// IMPORTANT — host choice: what matters is a stable *outbound* IP. A plain VPS
// (DigitalOcean / Hetzner / Linode) or EC2 + Elastic IP gives you that: the
// box's public IPv4 is also its egress IP. See README.md for the caveat about
// platforms (Fly.io, some Render tiers) that NAT egress through a shared/rotating
// pool — those won't reliably solve the problem.
//
// Auth: callers must send  x-relay-secret: $RELAY_SECRET .

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const BREVO_BASE = 'https://api.brevo.com';

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

// Constant-time secret comparison (avoids leaking the secret via timing).
function secretOk(provided) {
  if (!RELAY_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(RELAY_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Health check for the host's process supervisor / load balancer.
  if (url.pathname === '/health') return send(res, 200, { ok: true });

  // Only proxy the Brevo v3 API surface; reject anything else.
  if (!url.pathname.startsWith('/v3/')) return send(res, 404, { error: 'not found' });

  if (!secretOk(req.headers['x-relay-secret'])) return send(res, 401, { error: 'unauthorized' });
  if (!BREVO_API_KEY) return send(res, 500, { error: 'BREVO_API_KEY not configured on relay' });

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    try {
      const upstream = await fetch(BREVO_BASE + url.pathname + url.search, {
        method: req.method,
        headers: {
          accept: 'application/json',
          'content-type': req.headers['content-type'] || 'application/json',
          'api-key': BREVO_API_KEY,
        },
        body: isBodyless ? undefined : body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(text);
    } catch (e) {
      send(res, 502, { error: `relay upstream failed: ${e.message}` });
    }
  });
});

server.listen(PORT, () => console.log(`brevo-relay listening on :${PORT}`));
