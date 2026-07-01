// Uniform Builder — AI design generator.
//
// Takes a coach's plain-English brief ("aggressive red and black with camo
// sleeves") plus the garment they're on, and asks Claude to return a structured
// design spec: a color + pattern for each zone, a fabric, and number/name
// typography. Claude is forced through a tool schema so the output is always a
// JSON object, never prose. The client re-validates via designSpec.normalizeSpec
// before rendering, so this function only has to produce a best-effort shape.
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

// Zone ids per garment so the model only names zones that exist on that garment.
const GARMENT_ZONES = {
  crew_jersey: ['body', 'yoke', 'sleeveL', 'sleeveR', 'collar', 'sidePanelL', 'sidePanelR'],
  shorts: ['waistband', 'legL', 'legR', 'sidePanelL', 'sidePanelR'],
  hoodie: ['body', 'sleeveL', 'sleeveR', 'hood', 'pocket', 'cuff', 'collar'],
};

const SYSTEM = [
  'You are a senior team-apparel designer. Turn a coach\'s brief into a concrete uniform design.',
  'Return your answer ONLY by calling the apply_uniform_design tool. Do not write prose.',
  'Guidelines:',
  '- Use real, legible team colors. Prefer strong contrast between the body and lettering so numbers read from the stands.',
  '- Colors are 6-digit hex (e.g. #1f2a44). Patterns other than "solid" also need a secondaryColor.',
  '- Only reference zone ids that exist on the given garment. Not every zone needs a pattern; solid is fine.',
  '- Pick a fabric and number/name fonts that fit the vibe (block/anton & bebas for bold, graduate for collegiate, pirata for gothic, pacifico for script).',
  '- Numbers are short (1-2 digits); names are UPPERCASE last names when the brief implies a player look, otherwise leave name empty.',
].join('\n');

const zoneSchema = {
  type: 'object',
  properties: {
    color: { type: 'string', description: '6-digit hex like #1f2a44' },
    secondaryColor: { type: 'string', description: '6-digit hex; used when pattern is not solid' },
    pattern: { type: 'string', enum: PATTERNS },
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
  },
};

const TOOL = {
  name: 'apply_uniform_design',
  description: 'Apply a complete uniform design.',
  input_schema: {
    type: 'object',
    properties: {
      fabric: { type: 'string', enum: FABRICS },
      teamName: { type: 'string' },
      zones: { type: 'object', additionalProperties: zoneSchema, description: 'Map of zoneId -> {color, secondaryColor?, pattern?}' },
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
  },
};

// Map the tool output (which uses secondaryColor) into the client's zone shape
// (which uses color2). Everything else the client re-validates.
function toClientSpec(garmentId, out) {
  const zones = {};
  const valid = GARMENT_ZONES[garmentId] || GARMENT_ZONES.crew_jersey;
  const src = (out && out.zones) || {};
  for (const id of Object.keys(src)) {
    if (!valid.includes(id)) continue;
    const z = src[id] || {};
    zones[id] = { color: z.color, color2: z.secondaryColor || z.color2, pattern: z.pattern || 'solid' };
  }
  return {
    garmentId,
    fabric: out && out.fabric,
    zones,
    text: (out && out.text) || undefined,
    meta: { teamName: (out && out.teamName) || '', notes: (out && out.rationale) || '' },
  };
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
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Describe the design you want.' }) };

  const userMsg = [
    `Garment: ${garmentId}`,
    `Available zone ids: ${GARMENT_ZONES[garmentId].join(', ')}`,
    `Coach's brief: ${prompt}`,
  ].join('\n');

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'apply_uniform_design' },
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: `Anthropic ${resp.status}`, detail: t.slice(0, 300) }) };
    }
    const data = await resp.json();
    const toolUse = (data.content || []).find((b) => b && b.type === 'tool_use' && b.name === 'apply_uniform_design');
    if (!toolUse) return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'AI did not return a design.' }) };
    const spec = toClientSpec(garmentId, toolUse.input || {});
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, spec, rationale: (toolUse.input && toolUse.input.rationale) || '' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: (e && e.message) || 'AI request failed.' }) };
  }
};
