// AI meeting notes: the extraction prompt, the draft shape, and its validation,
// kept in one file so the prompt/model can change without touching the pipeline
// (docs/AI_MEETING_NOTES_V1_SPEC.md). The model is one env var.
const MODEL = process.env.MEETING_NOTES_MODEL || 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TRANSCRIPT_CHARS = 120000; // ~90 minutes of talk
const STAGES = ['lead', 'contacted', 'quoted', 'won', 'reorder_due'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (v) => {
  if (!DATE_RE.test(String(v || ''))) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const SYSTEM = `You turn a sales rep's meeting, voice memo, or pasted conversation into structured CRM notes for National Sports Apparel, a team outfitter that sells uniforms, apparel and spirit wear to high school and college athletic programs.

Return ONLY a JSON object with exactly these keys:
{
  "headline": "One sentence: what happened and what's next",
  "summary": "3-5 sentences for a manager who wasn't there",
  "sections": {
    "products_discussed": ["short strings"],
    "pricing_and_budget": "string or null",
    "timeline": "string or null",
    "decisions": ["short strings"],
    "concerns": ["short strings"]
  },
  "action_items": [
    {"text": "imperative, specific task", "owner": "rep, or the person's name", "due_date": "YYYY-MM-DD or null", "speaker": "speaker letter who raised it, or null"}
  ],
  "people_mentioned": [{"name": "string", "role": "string or null"}],
  "line_items": [
    {"name": "garment as described", "brand": "string or null", "sku_guess": "style number if said, else null", "color": "string or null", "quantity": 0, "sizes": {"S": 0, "M": 0}, "decoration": "string or null"}
  ],
  "opportunities": [
    {"text": "future order they mentioned", "est_value": 0, "date": "YYYY-MM-DD or null"}
  ],
  "competitors": [
    {"name": "company", "detail": "what was said", "price": "string or null"}
  ],
  "sports": ["string"],
  "suggested_stage": "lead|contacted|quoted|won|reorder_due|null",
  "suggested_next_action_date": "YYYY-MM-DD or null",
  "follow_up_email": {"subject": "string", "body": "string"},
  "confidence": 0.0
}

Rules:
- Only use what is actually said. Never invent products, quantities, prices, dates or people.
- Resolve relative dates ("next Friday", "end of the month", "two weeks out") against the meeting date given. If a date is vague or not stated, use null.
- Action items are things someone committed to or clearly needs to do next (send a quote, mock up art, confirm sizes). Owner "rep" means the NSA rep. Skip vague pleasantries.
- people_mentioned: only people named in the conversation (not the rep). Include role/title if stated (Head Coach, AD, booster president). Do not list the rep.
- Speaker letters (A, B, C) come from the transcript; carry them into action_items.speaker. If the transcript has no letters, use null.
- follow_up_email is written in the rep's voice to the main customer contact: short, friendly, recaps what was agreed, ends with one clear ask. Plain text, no placeholders like [Name] unless the name is unknown.
- suggested_stage: lead (first contact), contacted (conversation happening), quoted (pricing sent/being prepared), won (order confirmed), reorder_due (existing customer due to reorder). null if unclear.
- line_items: garments the customer wants quoted or ordered now, one per style/color. quantity is the total if stated (else null); sizes only when a size breakdown is actually given (size -> count). decoration is logo/print/embroidery details if stated. Empty if nothing specific was requested.
- opportunities: future orders mentioned for later ("new uniforms next spring", "reorder hoodies for winter"). est_value is a dollar estimate only if a budget, price or quantity makes one reasonable, else null. date is when to follow up (roughly a month before they need it), or null.
- competitors: other vendors mentioned (BSN, Varsity, a local shop, Amazon, etc.) with what was said and any price quoted.
- confidence: 0-1, how complete and clear the source was.
- Keep every string concise. Empty lists are fine.`;

const str = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+\n/g, '\n').trim();
  return s ? s.slice(0, max) : null;
};
const strList = (v, maxItems, maxLen) => (Array.isArray(v) ? v : [])
  .map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems);

// Validate and clamp whatever the model returned into the draft shape the
// review screen and approve handler rely on. `knownNames` (lowercased) marks
// which people are already contacts on the account.
function normalizeDraft(raw, { knownNames = new Set() } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const sec = r.sections && typeof r.sections === 'object' ? r.sections : {};
  const headline = str(r.headline, 200);
  const summary = str(r.summary, 2000);
  if (!headline && !summary) throw new Error('AI draft had no headline or summary');
  const seenPeople = new Set();
  const people = (Array.isArray(r.people_mentioned) ? r.people_mentioned : [])
    .map((p) => ({ name: str(p && p.name, 80), role: str(p && p.role, 80) }))
    .filter((p) => p.name && !seenPeople.has(p.name.toLowerCase()) && seenPeople.add(p.name.toLowerCase()))
    .slice(0, 15)
    .map((p) => ({ ...p, is_new: !knownNames.has(p.name.toLowerCase()) }));
  const email = r.follow_up_email && typeof r.follow_up_email === 'object'
    ? { subject: str(r.follow_up_email.subject, 200) || '', body: str(r.follow_up_email.body, 3000) || '' }
    : null;
  const conf = Number(r.confidence);
  return {
    headline: headline || summary.split(/(?<=[.!?])\s/)[0].slice(0, 200),
    summary: summary || headline,
    sections: {
      products_discussed: strList(sec.products_discussed, 20, 200),
      pricing_and_budget: str(sec.pricing_and_budget, 600),
      timeline: str(sec.timeline, 600),
      decisions: strList(sec.decisions, 15, 300),
      concerns: strList(sec.concerns, 15, 300),
    },
    action_items: (Array.isArray(r.action_items) ? r.action_items : [])
      .map((a) => ({
        text: str(a && a.text, 300),
        owner: str(a && a.owner, 80) || 'rep',
        due_date: isRealDate(a && a.due_date) ? a.due_date : null,
        speaker: /^[A-Z]$/.test(String(a && a.speaker || '')) ? a.speaker : null,
      }))
      .filter((a) => a.text)
      .slice(0, 15),
    people_mentioned: people,
    line_items: (Array.isArray(r.line_items) ? r.line_items : []).map((l) => {
      const sizes = {};
      if (l && l.sizes && typeof l.sizes === 'object') {
        Object.entries(l.sizes).slice(0, 20).forEach(([k, v]) => {
          const n = Math.round(Number(v));
          const key = String(k).trim().toUpperCase().slice(0, 8);
          if (key && Number.isFinite(n) && n > 0 && n < 10000) sizes[key] = n;
        });
      }
      const q = Math.round(Number(l && l.quantity));
      return {
        name: str(l && l.name, 120),
        brand: str(l && l.brand, 40),
        sku_guess: str(l && l.sku_guess, 40),
        color: str(l && l.color, 60),
        quantity: Number.isFinite(q) && q > 0 && q < 100000 ? q : null,
        sizes,
        decoration: str(l && l.decoration, 200),
      };
    }).filter((l) => l.name).slice(0, 25),
    opportunities: (Array.isArray(r.opportunities) ? r.opportunities : []).map((o) => {
      const v = Number(o && o.est_value);
      return { text: str(o && o.text, 300), est_value: Number.isFinite(v) && v > 0 && v < 10000000 ? Math.round(v) : null, date: isRealDate(o && o.date) ? o.date : null };
    }).filter((o) => o.text).slice(0, 10),
    competitors: (Array.isArray(r.competitors) ? r.competitors : []).map((c) => ({
      name: str(c && c.name, 80), detail: str(c && c.detail, 300), price: str(c && c.price, 80),
    })).filter((c) => c.name).slice(0, 10),
    sports: strList(r.sports, 10, 40),
    suggested_stage: STAGES.includes(r.suggested_stage) ? r.suggested_stage : null,
    suggested_next_action_date: isRealDate(r.suggested_next_action_date) ? r.suggested_next_action_date : null,
    follow_up_email: email && (email.subject || email.body) ? email : null,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}

// Transcript text for the model. Recorded meetings keep speaker letters;
// a dictated memo is one voice, so letters would only add noise.
function transcriptForModel({ mode, utterances, sourceText }) {
  if (mode === 'pasted' || !Array.isArray(utterances) || !utterances.length) return String(sourceText || '');
  if (mode === 'dictated') return utterances.map((u) => u.text).join('\n');
  return utterances.map((u) => `${u.speaker || '?'}: ${u.text}`).join('\n');
}

// Returns { draft, usage: { input_tokens, output_tokens }, model }.
async function extractDraft({ apiKey, mode, transcript, meetingDate, repName, customerName, sports, contacts = [] }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const text = String(transcript || '').trim();
  if (text.length < 20) throw new Error('Not enough speech or text to take notes from');
  const knownNames = new Set(contacts.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean));
  const user = [
    `Meeting date: ${meetingDate}`,
    `Rep: ${repName || 'the rep'}`,
    `Account: ${customerName || 'not chosen yet'}`,
    sports && sports.length ? `Account sports: ${sports.join(', ')}` : '',
    contacts.length ? `Known contacts on the account: ${contacts.map((c) => `${c.name}${c.role ? ' (' + c.role + ')' : ''}`).join('; ').slice(0, 1500)}` : 'Known contacts on the account: none',
    `Source: ${mode === 'recorded' ? 'recorded conversation, speakers labeled by letter' : mode === 'dictated' ? "the rep's own voice memo" : 'text the rep pasted (email, text thread, or transcript)'}`,
    '',
    '--- BEGIN SOURCE ---',
    text.slice(0, MAX_TRANSCRIPT_CHARS),
    '--- END SOURCE ---',
  ].filter((l) => l !== '').join('\n');

  const usage = { input_tokens: 0, output_tokens: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 200));
    }
    const data = await resp.json();
    usage.input_tokens += Number(data.usage?.input_tokens) || 0;
    usage.output_tokens += Number(data.usage?.output_tokens) || 0;
    const out = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    const match = out.match(/\{[\s\S]*\}/);
    if (match) {
      try { return { draft: normalizeDraft(JSON.parse(match[0]), { knownNames }), usage, model: MODEL }; } catch (_) { /* retry once */ }
    }
  }
  const err = new Error('AI returned unreadable notes');
  err.usage = usage;
  throw err;
}

module.exports = { MODEL, STAGES, SYSTEM, isRealDate, normalizeDraft, transcriptForModel, extractDraft };
