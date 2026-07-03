// Uniform Builder — AI design generator.
//
// Takes a coach's plain-English brief ("aggressive red and black with camo
// sleeves") plus the garment they're on, and asks Claude to return structured
// design candidates: a color + pattern for each zone, a fabric, cut, lettering
// treatment, and number/name typography. Claude is forced through a tool schema
// so the output is always JSON, never prose. The client re-validates via
// designSpec.normalizeSpec before rendering, so this function only has to
// produce a best-effort shape.
//
// The wizard asks for 2-3 candidates in one call (cheaper than N calls and the
// model is told to make them genuinely different); the advanced editor's older
// single-design path still works — `spec` in the response is candidate #1.
//
// Degrades gracefully: with no ANTHROPIC_API_KEY it returns ok:false + a reason
// so the builder can show a friendly message instead of breaking. Kept auth-free
// so the standalone /uniform-builder demo works for logged-out coaches; the only
// side effect is a single bounded Claude call (no DB writes).

const { corsHeaders } = require('./_shared');

const MODEL = process.env.UNIFORM_AI_MODEL || 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Vocabularies the model must stay inside. Kept in sync with src/uniform/*.
const PATTERNS = ['solid', 'stripes', 'boldstripe', 'pinstripe', 'chevron', 'fade', 'dots', 'camo', 'digicamo', 'carbon', 'hex'];
const FABRICS = ['matte', 'mesh', 'heather', 'sublimated', 'gloss'];
const FONTS = ['anton', 'bebas', 'saira', 'oswald', 'graduate', 'squada', 'rye', 'pirata', 'pacifico', 'baloo'];
const NECK_STYLES = ['vneck', 'crew'];
const FRONT_NUMBER = ['right', 'left', 'center', 'none'];
const NAME_ARCH = ['arched', 'straight'];

// Zone ids per garment so the model only names zones that exist on that garment.
const GARMENT_ZONES = {
  crew_jersey: ['body', 'yoke', 'sleeveL', 'sleeveR', 'collar', 'sidePanelL', 'sidePanelR'],
  sahrul_jersey: ['body', 'sleeveL', 'sleeveR', 'collar'],
  octa_jersey: ['body', 'sleeveL', 'sleeveR', 'collar'],
  shorts: ['waistband', 'legL', 'legR', 'sidePanelL', 'sidePanelR'],
  hoodie: ['body', 'sleeveL', 'sleeveR', 'hood', 'pocket', 'cuff', 'collar'],
};

const SYSTEM = [
  'You are a senior team-apparel designer. Turn a coach\'s brief into concrete uniform designs.',
  'Return your answer ONLY by calling the propose_uniform_designs tool. Do not write prose.',
  'Guidelines:',
  '- When asked for multiple designs, make them GENUINELY different takes on the brief — different color balance, different pattern strategy, different lettering — not three shades of the same idea. Give each a short evocative name ("Midnight Camo", "Home Classic").',
  '- Use real, legible team colors. Prefer strong contrast between the body and lettering so numbers read from the stands. If team colors are provided, build around them.',
  '- Colors are 6-digit hex (e.g. #1f2a44). Patterns other than "solid" also need a secondaryColor.',
  '- If a list of print patterns is provided, you may set a zone\'s printPattern to one of those exact names instead of a built-in pattern — these are the shop\'s premium sublimation prints; tintable ones recolor to the zone\'s colors (color/secondaryColor, plus accentColor/accentColor2 for 4-color prints). Use at most one print pattern per design, usually on the body.',
  '- Only reference zone ids that exist on the given garment. Not every zone needs a pattern; solid is fine.',
  '- Pick a fabric and number/name fonts that fit the vibe (block/anton & bebas for bold, graduate for collegiate, pirata for gothic, pacifico for script).',
  '- neckStyle picks the cut; frontNumber places the chest number (right chest is the classic kit look; none drops it).',
  '- outline is the number\'s border; outline2 adds a second border ring outside the first (the pro "double border" look) — use it when the brief wants extra pop, otherwise "none".',
  '- nameArch "arched" curves the back name over the number (classic); "straight" is modern.',
  '- Numbers are short (1-2 digits); names are UPPERCASE last names when the brief implies a player look, otherwise leave name empty.',
].join('\n');

const zoneSchema = {
  type: 'object',
  properties: {
    color: { type: 'string', description: '6-digit hex like #1f2a44' },
    secondaryColor: { type: 'string', description: '6-digit hex; used when pattern is not solid' },
    pattern: { type: 'string', enum: PATTERNS },
    printPattern: { type: 'string', description: 'EXACT name of one of the provided print patterns (overrides pattern)' },
    accentColor: { type: 'string', description: '6-digit hex; 3rd color for 4-color tintable prints' },
    accentColor2: { type: 'string', description: '6-digit hex; 4th color for 4-color tintable prints' },
  },
  required: ['color'],
};
const textSchema = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    font: { type: 'string', enum: FONTS },
    fill: { type: 'string', description: '6-digit hex' },
    outline: { type: 'string', description: '6-digit hex, or "auto", or "none"' },
    outline2: { type: 'string', description: '6-digit hex for a second outer outline, or "none"' },
  },
};

const designSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short evocative name for this look, 2-3 words' },
    fabric: { type: 'string', enum: FABRICS },
    neckStyle: { type: 'string', enum: NECK_STYLES },
    frontNumber: { type: 'string', enum: FRONT_NUMBER },
    nameArch: { type: 'string', enum: NAME_ARCH },
    nameSpacing: { type: 'number', description: 'Back-name letter spacing as % of font size, 0-30' },
    teamName: { type: 'string' },
    zones: { type: 'object', additionalProperties: zoneSchema, description: 'Map of zoneId -> {color, secondaryColor?, pattern?, printPattern?}' },
    text: {
      type: 'object',
      properties: {
        front: { type: 'object', properties: { number: textSchema, name: textSchema } },
        back: { type: 'object', properties: { number: textSchema, name: textSchema } },
      },
    },
    rationale: { type: 'string', description: 'One short sentence describing the look.' },
  },
  required: ['zones'],
};

const TOOL = {
  name: 'propose_uniform_designs',
  description: 'Propose one or more complete uniform designs.',
  input_schema: {
    type: 'object',
    properties: { designs: { type: 'array', items: designSchema, minItems: 1, maxItems: 3 } },
    required: ['designs'],
  },
};

// Map one tool-output design (which uses secondaryColor) into the client's zone
// shape (which uses color2). Everything else the client re-validates.
function toClientSpec(garmentId, out) {
  const zones = {};
  const valid = GARMENT_ZONES[garmentId] || GARMENT_ZONES.crew_jersey;
  const src = (out && out.zones) || {};
  for (const id of Object.keys(src)) {
    if (!valid.includes(id)) continue;
    const z = src[id] || {};
    zones[id] = {
      color: z.color, color2: z.secondaryColor || z.color2, pattern: z.pattern || 'solid',
      ...(z.printPattern ? { printPattern: String(z.printPattern).slice(0, 60) } : {}),
      ...(z.accentColor ? { color3: z.accentColor } : {}),
      ...(z.accentColor2 ? { color4: z.accentColor2 } : {}),
    };
  }
  return {
    garmentId,
    fabric: out && out.fabric,
    zones,
    text: (out && out.text) || undefined,
    meta: { teamName: (out && out.teamName) || '', notes: (out && out.rationale) || '' },
  };
}

// Cut/placement/lettering choices the wizard applies as config, not spec.
function toStyling(out) {
  const s = {};
  if (NECK_STYLES.includes(out && out.neckStyle)) s.neckStyle = out.neckStyle;
  if (FRONT_NUMBER.includes(out && out.frontNumber)) s.frontNumber = out.frontNumber;
  if (NAME_ARCH.includes(out && out.nameArch)) s.nameArch = out.nameArch;
  if (Number.isFinite(out && out.nameSpacing)) s.nameSpacing = Math.min(30, Math.max(0, out.nameSpacing));
  return s;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key', error: 'AI design is not configured yet (no API key).' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { /* ignore */ }
  const prompt = String(body.prompt || '').trim().slice(0, 800);
  const garmentId = GARMENT_ZONES[body.garmentId] ? body.garmentId : 'crew_jersey';
  const count = Math.min(3, Math.max(1, Number.isFinite(body.count) ? body.count : 1));
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Describe the design you want.' }) };

  // Optional context the wizard sends: sport/program, the coach's declared team
  // colors, and the shop's print-pattern library (names only — images stay
  // client-side).
  const ctx = (body.context && typeof body.context === 'object') ? body.context : {};
  const teamColors = Array.isArray(ctx.teamColors) ? ctx.teamColors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [];
  const prints = Array.isArray(ctx.printPatterns)
    ? ctx.printPatterns
        .filter((p) => p && typeof p.name === 'string')
        .slice(0, 40)
        .map((p) => `"${p.name.slice(0, 60)}"${p.tintable ? ` (tintable, ${p.tintMode || 'solid'} mode)` : ' (fixed colors)'}`)
    : [];

  const userMsg = [
    `Garment: ${garmentId}`,
    `Available zone ids: ${GARMENT_ZONES[garmentId].join(', ')}`,
    ctx.sport ? `Sport: ${String(ctx.sport).slice(0, 30)}` : '',
    ctx.program ? `Program: ${String(ctx.program).slice(0, 20)} (men's/women's/youth cut)` : '',
    teamColors.length ? `Team colors: ${teamColors.join(', ')}` : '',
    prints.length ? `Available print patterns: ${prints.join(', ')}` : '',
    `Number of designs to propose: ${count}${count > 1 ? ' (make them genuinely different)' : ''}`,
    `Coach's brief: ${prompt}`,
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'propose_uniform_designs' },
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: `Anthropic ${resp.status}`, detail: t.slice(0, 300) }) };
    }
    const data = await resp.json();
    const toolUse = (data.content || []).find((b) => b && b.type === 'tool_use' && b.name === 'propose_uniform_designs');
    const raw = toolUse && toolUse.input && Array.isArray(toolUse.input.designs) ? toolUse.input.designs : [];
    if (!raw.length) return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'AI did not return a design.' }) };
    const designs = raw.slice(0, count).map((d) => ({
      name: (typeof d.name === 'string' && d.name.trim()) ? d.name.trim().slice(0, 30) : 'Design',
      spec: toClientSpec(garmentId, d),
      styling: toStyling(d),
      rationale: (typeof d.rationale === 'string' ? d.rationale : '').slice(0, 200),
    }));
    // Back-compat: older callers (the advanced editor) read `spec` directly.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, designs, spec: designs[0].spec, rationale: designs[0].rationale }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: (e && e.message) || 'AI request failed.' }) };
  }
};
