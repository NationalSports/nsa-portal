// Uniform Builder — garment-grounded concept image generation.
//
// This is deliberately separate from uniform-ai-design:
//   1. GPT Image creates a high-fidelity visual direction using the approved
//      blank garment proof as a reference.
//   2. The coach selects a concept.
//   3. uniform-ai-design translates that concept into the builder's smaller,
//      production-safe vocabulary of editable zones, colors, motifs and type.
//
// The generated image is art direction, not production artwork. The builder
// labels it accordingly and never exports it as a production file.

const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');

const OPENAI_URL = 'https://api.openai.com/v1/images';
const MODEL = process.env.UNIFORM_IMAGE_MODEL || 'gpt-image-2';
const QUALITY = process.env.UNIFORM_IMAGE_QUALITY || 'medium';
const SIZE = process.env.UNIFORM_IMAGE_SIZE || '1536x1024';
const OUTPUT_FORMAT = 'jpeg';
const OUTPUT_COMPRESSION = Number(process.env.UNIFORM_IMAGE_COMPRESSION || 68);

// Concept images are materially more expensive than the structured design
// call, so they have their own conservative anonymous-demo budget.
const DAILY_LIMIT = Number(process.env.UNIFORM_IMAGE_DAILY_LIMIT || 90);
const DAILY_IP_LIMIT = Number(process.env.UNIFORM_IMAGE_DAILY_IP_LIMIT || 9);

async function underBudget(event) {
  try {
    const sb = getSupabaseAdmin();
    const day = new Date().toISOString().slice(0, 10);
    const ip = String(event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '')
      .split(',')[0].trim() || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const keys = [`uniform_image:${day}:ip:${ipHash}`, `uniform_image:${day}:all`];
    const limits = [DAILY_IP_LIMIT, DAILY_LIMIT];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const { data } = await sb.from('app_counters').select('value').eq('key', key).maybeSingle();
      const next = (Number(data && data.value) || 0) + 1;
      await sb.from('app_counters').upsert({ key, value: next });
      if (next > limits[index]) return false;
    }
    return true;
  } catch (_error) {
    // Cost counters are operational protection, not an authentication boundary.
    return true;
  }
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) return null;
  return { mediaType: match[1], bytes };
}

function cleanHexes(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => /^#[0-9a-f]{6}$/i.test(String(value || '')))
    .slice(0, 6)
    .map((value) => String(value).toUpperCase());
}

function buildConceptPrompt(input) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const locked = context.lockedRules && typeof context.lockedRules === 'object'
    ? context.lockedRules
    : {};
  const colors = cleanHexes(context.teamColors);
  const reversible = !!context.reversible;
  const identity = String(locked.frontIdentity || 'wordmark');
  const teamName = String(locked.teamName || '').trim().slice(0, 40);
  const frontSize = Number.isFinite(locked.frontNumberInches) ? locked.frontNumberInches : 4;
  const backSize = Number.isFinite(locked.backNumberInches) ? locked.backNumberInches : 8;
  const program = String(context.program || "men's").slice(0, 20);
  const sport = String(context.sport || 'team sport').slice(0, 30);

  return [
    'Create one premium, photorealistic custom team-uniform concept board.',
    'Use the supplied blank garment reference as the exact physical template.',
    'LOCKED GARMENT RULES:',
    '- Preserve the exact neckline, arm openings or sleeves, hem, proportions, seams, cut and camera silhouette from the reference.',
    '- Do not turn it into a different sport, garment cut, mock neck, sleeve length or fashion silhouette.',
    reversible
      ? '- This is reversible. Show coordinated Side A and Side B garments together, each with its own complete colorway.'
      : '- Show the same design as a clean front and back pair, side-by-side.',
    '- Make the sublimated artwork visibly wrap across the garment panels without changing the garment geometry.',
    '- Render realistic performance-poly fabric, subtle knit, seams, folds, soft studio lighting and crisp artwork boundaries.',
    '- Neutral light-gray studio background. No people, hangers, props, captions, arrows, labels or manufacturer branding.',
    `Sport: ${sport}. Program/cut: ${program}.`,
    colors.length ? `Locked team palette: ${colors.join(', ')}. Use these as the principal colors.` : '',
    teamName ? `Locked team/program name: "${teamName}". Spell it exactly.` : '',
    identity === 'logo'
      ? '- The front identity is a logo. If a separate logo reference is supplied, preserve it; otherwise leave a clean logo placement area rather than inventing a brand.'
      : identity === 'both'
        ? '- The front must include the exact team name and a restrained logo placement. Do not repeat the team name on the back.'
        : '- The front must include the exact team name once. Do not put the team name on the back.',
    `Use an athletic number approximately ${frontSize}" tall on the front and ${backSize}" tall on the back; the back number is vertically movable but centered horizontally.`,
    locked.playerNamesEnabled
      ? '- Reserve a clean player-name position above the back number.'
      : '- Do not add a player name.',
    'The visual should feel high-end enough for customer approval, but keep the motif reproducible as vector shapes, gradients, stripes, splatter, geometric forms or other clean sublimation artwork.',
    `Coach direction: ${String(input.prompt || '').trim().slice(0, 800)}`,
    'Return only the finished garment concept image.',
  ].filter(Boolean).join('\n');
}

async function openAiRequest({ apiKey, prompt, referenceImages, count }) {
  const common = {
    model: MODEL,
    prompt,
    n: count,
    size: SIZE,
    quality: QUALITY,
    output_format: OUTPUT_FORMAT,
    output_compression: Math.max(20, Math.min(90, OUTPUT_COMPRESSION)),
    background: 'opaque',
  };

  if (referenceImages.length) {
    const form = new FormData();
    Object.entries(common).forEach(([key, value]) => form.append(key, String(value)));
    referenceImages.forEach((image, index) => {
      const extension = image.mediaType.split('/')[1].replace('jpeg', 'jpg');
      form.append('image[]', new Blob([image.bytes], { type: image.mediaType }), `uniform-reference-${index + 1}.${extension}`);
    });
    return fetch(`${OPENAI_URL}/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  }

  return fetch(`${OPENAI_URL}/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(common),
  });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        reason: 'missing_api_key',
        error: 'Concept image generation is not configured yet.',
      }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid request.' }) };
  }

  const prompt = String(body.prompt || '').trim().slice(0, 800);
  if (!prompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Describe the design you want.' }) };
  }
  if (!(await underBudget(event))) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        ok: false,
        reason: 'rate_limited',
        error: 'Image concepts have reached today’s demo limit. Your guided setup is still saved.',
      }),
    };
  }

  const count = Math.min(3, Math.max(1, Number(body.count) || 3));
  const referenceImages = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
    .map(parseImageDataUrl)
    .filter(Boolean)
    .slice(0, 3);
  const conceptPrompt = buildConceptPrompt({ ...body, prompt });

  try {
    const response = await openAiRequest({
      apiKey,
      prompt: conceptPrompt,
      referenceImages,
      count,
    });
    const requestId = response.headers.get('x-request-id') || '';
    const data = await response.json();
    if (!response.ok) {
      const message = data && data.error && data.error.message;
      console.error('uniform-ai-concept OpenAI error', response.status, requestId, message || 'unknown');
      return {
        statusCode: response.status >= 500 ? 502 : response.status,
        headers,
        body: JSON.stringify({
          ok: false,
          reason: data && data.error && data.error.code,
          error: message || 'The image service could not create concepts.',
        }),
      };
    }

    const concepts = (Array.isArray(data.data) ? data.data : [])
      .map((item, index) => item && item.b64_json ? {
        id: `concept-${index + 1}`,
        name: `Visual ${index + 1}`,
        image: `data:image/${OUTPUT_FORMAT};base64,${item.b64_json}`,
        revisedPrompt: String(item.revised_prompt || '').slice(0, 1200),
      } : null)
      .filter(Boolean);

    if (!concepts.length) {
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'The image service returned no concepts.' }) };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, concepts, model: MODEL, requestId }),
    };
  } catch (error) {
    console.error('uniform-ai-concept request failed', error && error.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: 'Could not reach the image service. Please try again.' }),
    };
  }
};

exports._test = {
  buildConceptPrompt,
  cleanHexes,
  parseImageDataUrl,
};
