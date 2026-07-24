// Uniform Builder — Kimi-guided concept generation.
//
// Kimi's public API supports multimodal understanding and JSON output, but it
// does not expose a raster image-generation endpoint. This function therefore
// asks Kimi for three garment-grounded visual directions and renders each
// direction into a safe SVG concept board. The selected direction is then sent
// to uniform-ai-design, where Kimi maps it into the builder's editable schema.
//
// The concept SVG is visual direction only. It is never used as production art.

const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const MODEL = process.env.UNIFORM_CONCEPT_MODEL || process.env.UNIFORM_AI_MODEL || 'kimi-k2.6';

const DAILY_LIMIT = Number(process.env.UNIFORM_IMAGE_DAILY_LIMIT || 90);
const DAILY_IP_LIMIT = Number(process.env.UNIFORM_IMAGE_DAILY_IP_LIMIT || 9);

const MOTIFS = new Set(['splatter', 'diagonal', 'geometric', 'hex', 'waves', 'fade', 'stripes', 'solid']);
const LAYOUTS = new Set(['allover', 'side-heavy', 'lower-third', 'shoulder', 'center-burst']);

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
      const { data } = await sb.from('app_counters').select('value').eq('key', keys[index]).maybeSingle();
      const next = (Number(data && data.value) || 0) + 1;
      await sb.from('app_counters').upsert({ key: keys[index], value: next });
      if (next > limits[index]) return false;
    }
    return true;
  } catch (_error) {
    return true;
  }
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!match) return null;
  const data = match[2].replace(/\s/g, '');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) return null;
  return { mediaType: match[1], data, bytes };
}

function cleanHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
}

function cleanHexes(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => /^#[0-9a-f]{6}$/i.test(String(value || '')))
    .slice(0, 6)
    .map((value) => String(value).toUpperCase());
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildConceptPrompt(input) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const locked = context.lockedRules && typeof context.lockedRules === 'object' ? context.lockedRules : {};
  const colors = cleanHexes(context.teamColors);
  const count = Math.min(3, Math.max(1, Number(input.count) || 3));
  return [
    'You are a senior custom team-apparel art director.',
    `Create ${count} genuinely different visual directions for the exact blank garment shown in the attached reference image(s).`,
    'Preserve the garment cut, neckline, sleeves/arm openings, proportions and reversible/non-reversible construction.',
    'The directions must be reproducible with vector geometry, gradients, stripes, splatter, hex, waves or clean sublimation shapes.',
    'Do not suggest photographs, copyrighted characters, manufacturer branding, fabric geometry changes, or effects that cannot wrap across garment panels.',
    `Sport: ${String(context.sport || 'team sport').slice(0, 30)}.`,
    `Program: ${String(context.program || "men's").slice(0, 20)}.`,
    context.reversible ? 'This is reversible; coordinate two distinct faces.' : 'This is a standard front/back garment.',
    colors.length ? `Locked team palette: ${colors.join(', ')}.` : '',
    locked.teamName ? `Spell the locked team name exactly: "${String(locked.teamName).slice(0, 40)}".` : '',
    locked.frontIdentity ? `Front identity: ${String(locked.frontIdentity).slice(0, 12)}.` : '',
    `Front number height: ${Number(locked.frontNumberInches) || 4} inches. Back number height: ${Number(locked.backNumberInches) || 8} inches.`,
    locked.playerNamesEnabled ? 'Reserve a player-name area above the back number.' : 'Do not add a player name.',
    `Coach direction: ${String(input.prompt || '').trim().slice(0, 800)}`,
    '',
    'Return valid JSON only in this exact shape:',
    '{"concepts":[{"name":"2-3 words","bodyColor":"#RRGGBB","secondaryColor":"#RRGGBB","accentColor":"#RRGGBB","accentColor2":"#RRGGBB","motif":"splatter|diagonal|geometric|hex|waves|fade|stripes|solid","layout":"allover|side-heavy|lower-third|shoulder|center-burst","numberFill":"#RRGGBB","numberOutline":"#RRGGBB","typography":"short description","rationale":"one sentence"}]}',
  ].filter(Boolean).join('\n');
}

function parseJsonContent(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (_nestedError) { return null; }
    }
    return null;
  }
}

function normalizeConcept(raw, index, palette) {
  const fallback = palette.length ? palette : ['#172554', '#B91C1C', '#FFFFFF', '#111827'];
  const motif = MOTIFS.has(raw && raw.motif) ? raw.motif : 'geometric';
  const layout = LAYOUTS.has(raw && raw.layout) ? raw.layout : 'allover';
  return {
    name: String((raw && raw.name) || `Visual ${index + 1}`).trim().slice(0, 30),
    bodyColor: cleanHex(raw && raw.bodyColor, fallback[0]),
    secondaryColor: cleanHex(raw && raw.secondaryColor, fallback[1] || fallback[0]),
    accentColor: cleanHex(raw && raw.accentColor, fallback[2] || '#FFFFFF'),
    accentColor2: cleanHex(raw && raw.accentColor2, fallback[3] || '#111827'),
    motif,
    layout,
    numberFill: cleanHex(raw && raw.numberFill, fallback[2] || '#FFFFFF'),
    numberOutline: cleanHex(raw && raw.numberOutline, '#111827'),
    typography: String((raw && raw.typography) || 'athletic block').slice(0, 80),
    rationale: String((raw && raw.rationale) || '').slice(0, 220),
  };
}

function motifMarkup(concept, id) {
  const c2 = concept.secondaryColor;
  const c3 = concept.accentColor;
  const c4 = concept.accentColor2;
  if (concept.motif === 'splatter') {
    const dots = [
      [80, 95, 26], [145, 65, 10], [205, 120, 18], [265, 80, 8], [325, 145, 22],
      [390, 90, 13], [455, 155, 28], [120, 225, 16], [200, 270, 34], [300, 235, 12],
      [375, 315, 30], [465, 260, 15], [95, 390, 25], [180, 430, 12], [275, 385, 36],
      [350, 475, 14], [445, 420, 28], [145, 560, 30], [250, 525, 10], [420, 575, 40],
    ].map(([x, y, r], index) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${index % 3 ? c2 : c3}"/>`).join('');
    return `<g opacity=".96"><path d="M-30 420 L180 180 L520 40 L365 265 L545 170 L280 510 L30 650 Z" fill="${c2}"/>${dots}</g>`;
  }
  if (concept.motif === 'diagonal' || concept.motif === 'stripes') {
    return `<g transform="rotate(-24 270 340)"><rect x="-120" y="125" width="780" height="90" fill="${c2}"/><rect x="-120" y="235" width="780" height="34" fill="${c3}"/><rect x="-120" y="288" width="780" height="120" fill="${c4}"/><rect x="-120" y="430" width="780" height="48" fill="${c2}"/></g>`;
  }
  if (concept.motif === 'hex') {
    return `<rect width="540" height="700" fill="url(#hex-${id})" opacity=".96"/>`;
  }
  if (concept.motif === 'waves') {
    return `<g fill="none" stroke-linecap="round"><path d="M-20 210 C90 120 170 300 285 210 S485 120 575 220" stroke="${c2}" stroke-width="76"/><path d="M-20 355 C90 265 170 445 285 355 S485 265 575 365" stroke="${c3}" stroke-width="42"/><path d="M-20 490 C90 400 170 580 285 490 S485 400 575 500" stroke="${c4}" stroke-width="58"/></g>`;
  }
  if (concept.motif === 'fade') {
    return `<rect width="540" height="700" fill="url(#fade-${id})"/>`;
  }
  if (concept.motif === 'solid') return `<path d="M0 470 H540 V700 H0 Z" fill="${c2}"/>`;
  return `<g opacity=".96"><path d="M0 560 L175 240 L330 365 L540 90 V700 H0 Z" fill="${c2}"/><path d="M0 650 L205 360 L350 480 L540 270 V700 H0 Z" fill="${c3}"/><path d="M0 700 L235 485 L370 585 L540 420 V700 Z" fill="${c4}"/></g>`;
}

function renderConceptSvg(concept, context = {}, index = 0) {
  const id = `c${index}-${crypto.createHash('md5').update(JSON.stringify(concept)).digest('hex').slice(0, 8)}`;
  const basketball = String(context.sport || '').toLowerCase().includes('basket');
  const reversible = !!context.reversible;
  const teamName = escapeXml(context.lockedRules && context.lockedRules.teamName);
  const frontIdentity = String(context.lockedRules && context.lockedRules.frontIdentity);
  const showName = teamName && frontIdentity !== 'logo';
  const number = '23';
  const bodyPath = basketball
    ? 'M155 40 L235 12 Q270 64 305 12 L385 40 L430 135 L386 164 L370 650 Q270 692 170 650 L154 164 L110 135 Z'
    : 'M155 45 L225 12 Q270 58 315 12 L385 45 L505 122 L452 215 L390 180 L370 650 Q270 692 170 650 L150 180 L88 215 L35 122 Z';
  const secondBody = reversible ? concept.secondaryColor : concept.bodyColor;
  const secondMotif = reversible ? concept.bodyColor : concept.secondaryColor;
  const layoutTransform = {
    'side-heavy': 'translate(150 0) scale(.78 1)',
    'lower-third': 'translate(0 250)',
    shoulder: 'translate(0 -245)',
    'center-burst': 'translate(0 70) scale(1 .82)',
    allover: '',
  }[concept.layout] || '';
  const garment = (x, fill, motifFill, isBack) => `
    <g transform="translate(${x} 142)">
      <path d="${bodyPath}" fill="${fill}" filter="url(#shadow)" stroke="#0F172A" stroke-opacity=".18" stroke-width="3"/>
      <clipPath id="clip-${id}-${x}"><path d="${bodyPath}"/></clipPath>
      <g clip-path="url(#clip-${id}-${x})" transform="translate(0 0)" opacity="${isBack ? '.92' : '1'}">
        <g transform="${layoutTransform}">${motifMarkup({ ...concept, secondaryColor: motifFill }, id)}</g>
        <path d="M150 180 Q270 140 390 180" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="10"/>
      </g>
      <path d="${basketball ? 'M220 16 Q270 84 320 16 M155 44 Q145 120 112 136 M385 44 Q395 120 428 136' : 'M224 16 Q270 76 316 16'}" fill="none" stroke="${concept.accentColor}" stroke-width="14" stroke-linecap="round"/>
      ${!isBack && showName ? `<text x="270" y="255" text-anchor="middle" fill="${concept.numberFill}" stroke="${concept.numberOutline}" stroke-width="4" paint-order="stroke" font-family="Arial Black,Arial,sans-serif" font-size="${teamName.length > 12 ? 36 : 48}" font-weight="900">${teamName}</text>` : ''}
      <text x="270" y="${!isBack && showName ? 410 : 360}" text-anchor="middle" fill="${concept.numberFill}" stroke="${concept.numberOutline}" stroke-width="10" paint-order="stroke" font-family="Arial Black,Arial,sans-serif" font-size="150" font-weight="900" font-style="${/italic|slant|diagonal/i.test(concept.typography) ? 'italic' : 'normal'}">${number}</text>
    </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
    <defs>
      <filter id="shadow" x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="0" dy="22" stdDeviation="18" flood-color="#0F172A" flood-opacity=".24"/></filter>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#F8FAFC"/><stop offset="1" stop-color="#E2E8F0"/></linearGradient>
      <linearGradient id="fade-${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${concept.bodyColor}" stop-opacity="0"/><stop offset=".58" stop-color="${concept.secondaryColor}"/><stop offset="1" stop-color="${concept.accentColor2}"/></linearGradient>
      <pattern id="hex-${id}" width="48" height="42" patternUnits="userSpaceOnUse"><path d="M12 2 H36 L47 21 L36 40 H12 L1 21 Z" fill="none" stroke="${concept.secondaryColor}" stroke-width="8"/><path d="M12 2 H36 L47 21 L36 40 H12 L1 21 Z" fill="${concept.accentColor}" fill-opacity=".18"/></pattern>
    </defs>
    <rect width="1536" height="1024" fill="url(#bg)"/>
    <ellipse cx="768" cy="870" rx="620" ry="55" fill="#64748B" opacity=".15"/>
    ${garment(95, concept.bodyColor, concept.secondaryColor, false)}
    ${garment(806, secondBody, secondMotif, !reversible)}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'POST only' }) };

  const apiKey = process.env.AIUniBuilder || process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key', error: 'Kimi is not configured yet. Add AIUniBuilder in Netlify.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_error) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid request.' }) };
  }
  const prompt = String(body.prompt || '').trim().slice(0, 800);
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Describe the design you want.' }) };
  if (!(await underBudget(event))) {
    return { statusCode: 429, headers, body: JSON.stringify({ ok: false, reason: 'rate_limited', error: 'AI concepts have reached today’s demo limit.' }) };
  }

  const count = Math.min(3, Math.max(1, Number(body.count) || 3));
  const references = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
    .map(parseImageDataUrl).filter(Boolean).slice(0, 3);
  const content = references.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }));
  content.push({ type: 'text', text: buildConceptPrompt({ ...body, count }) });

  try {
    const response = await fetch(KIMI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Return precise JSON only. Never wrap JSON in Markdown.' },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_completion_tokens: 4096,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message;
      return { statusCode: response.status >= 500 ? 502 : response.status, headers, body: JSON.stringify({ ok: false, error: message || `Kimi ${response.status}` }) };
    }
    const parsed = parseJsonContent(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    const palette = cleanHexes(body.context && body.context.teamColors);
    const raw = parsed && Array.isArray(parsed.concepts) ? parsed.concepts : [];
    const concepts = raw.slice(0, count).map((item, index) => {
      const direction = normalizeConcept(item, index, palette);
      return {
        id: `concept-${index + 1}`,
        name: direction.name,
        image: renderConceptSvg(direction, body.context || {}, index),
        direction,
        revisedPrompt: direction.rationale,
      };
    });
    if (!concepts.length) return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'Kimi returned no usable concepts.' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, concepts, model: MODEL, format: 'safe-svg-direction' }) };
  } catch (error) {
    console.error('uniform-ai-concept Kimi request failed', error && error.message);
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'Could not reach Kimi. Please try again.' }) };
  }
};

exports._test = {
  buildConceptPrompt,
  cleanHexes,
  normalizeConcept,
  parseImageDataUrl,
  parseJsonContent,
  renderConceptSvg,
};
