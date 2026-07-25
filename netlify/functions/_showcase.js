const dns = require('dns').promises;
const net = require('net');

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/edits';
const PROMPT_VERSION = 'showcase-v5-subtle-hero-angle';
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const DEFAULT_IMAGE_HOSTS = new Set([
  'static.momentecbrands.com',
  'cdnp.sanmar.com',
  'cdnm.sanmar.com',
  'cdn.ssactivewear.com',
  'b2bprod-res.cloudinary.com',
  'underarmour.scene7.com',
  'images.salsify.com',
  'lh3.googleusercontent.com',
  'res.cloudinary.com',
  'assetly.ordermygear.com',
  'static.augustasportswear.com',
]);

function normalizeMode(value) {
  return value === 'showcase' ? 'showcase' : 'standard';
}

function getKimiConfig() {
  return {
    key: process.env.MOONSHOT_API_KEY
      || process.env.KIMI_API_KEY
      || process.env.AIUNIBUILDER_KIMI_API_KEY
      || process.env.AIUniBuilder
      || '',
    model: process.env.SHOWCASE_KIMI_MODEL || 'kimi-k2.6',
  };
}

function getOpenAiConfig() {
  return {
    key: process.env.OPENAI_API_KEY
      || process.env.AIUNIBUILDER_OPENAI_API_KEY
      || '',
    model: process.env.SHOWCASE_IMAGE_MODEL || 'gpt-image-2',
  };
}

function isPublicAddress(address) {
  if (!address) return false;
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return !(
      p[0] === 10
      || p[0] === 127
      || p[0] === 0
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
      || (p[0] === 198 && (p[1] === 18 || p[1] === 19))
      || p[0] >= 224
    );
  }
  if (net.isIP(address) === 6) {
    const a = address.toLowerCase();
    return !(
      a === '::'
      || a === '::1'
      || a.startsWith('fc')
      || a.startsWith('fd')
      || a.startsWith('fe8')
      || a.startsWith('fe9')
      || a.startsWith('fea')
      || a.startsWith('feb')
      || a.startsWith('::ffff:127.')
      || a.startsWith('::ffff:10.')
      || a.startsWith('::ffff:192.168.')
    );
  }
  return false;
}

function isAllowedImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (DEFAULT_IMAGE_HOSTS.has(host) || host.endsWith('.supabase.co')) return true;
  const configured = String(process.env.SHOWCASE_ALLOWED_IMAGE_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return configured.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function assertPublicImageUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch (_) { throw new Error('Source image URL is invalid'); }
  if (url.protocol !== 'https:') throw new Error('Source images must use HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('Source image host is not allowed');
  if (!isAllowedImageHost(host)) throw new Error(`Source image host is not approved for Showcase generation: ${host}`);
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('Source image host is not public');
    return url;
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new Error('Source image host does not resolve to a public address');
  }
  return url;
}

async function fetchRemoteImage(rawUrl, redirects = 0) {
  if (redirects > 3) throw new Error('Source image redirected too many times');
  const url = await assertPublicImageUrl(rawUrl);
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' },
  });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get('location');
    if (!next) throw new Error('Source image redirect had no location');
    return fetchRemoteImage(new URL(next, url).toString(), redirects + 1);
  }
  if (!res.ok) throw new Error(`Source image returned HTTP ${res.status}`);
  const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|webp)$/.test(contentType)) throw new Error('Source URL did not return a supported image');
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_SOURCE_BYTES) throw new Error('Source image is too large');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('Source image was empty');
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Source image is too large');
  return { bytes, contentType, sourceUrl: url.toString() };
}

function imageExtension(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

function dataUrl(image) {
  return `data:${image.contentType};base64,${image.bytes.toString('base64')}`;
}

function cleanDecorations(decorations) {
  return (Array.isArray(decorations) ? decorations : []).map((d) => ({
    side: d?.side || 'front',
    placement: d?.placement || null,
    x_percent: d?.x ?? null,
    y_percent: d?.y ?? null,
    width_percent: d?.w ?? null,
    decoration_type: d?.decoration_type || d?.type || null,
    artwork_url: d?.art_url || d?.source_url || d?.orig_url || d?.url || d?.image_url || d?.web_logo_url || null,
    locked: true,
  }));
}

function buildAnalysisBrief(product, decorations) {
  return {
    sku: product.sku || '',
    name: product.name || product.display_name || '',
    description: product.description || '',
    brand: product.brand || '',
    color: product.color || '',
    category: product.category || '',
    material: product.material || '',
    decorations: cleanDecorations(decorations),
    output: {
      size: '1024x1024',
      background: 'uniform neutral pure white (#FFFFFF) seamless ecommerce backdrop',
      background_color_hex: '#FFFFFF',
      background_exclusions: ['cream', 'beige', 'ivory', 'warm tint', 'colored cast', 'gradient', 'vignette'],
      subject: 'single garment or product only',
      full_product_visible: true,
      composition: 'premium near-front hero view with a subtle three-quarter turn',
      presentation: 'product-only invisible support with natural on-body volume and drape',
      camera_yaw_degrees: '8–15',
      straight_on_catalog_view_allowed: false,
      flat_lay_allowed: false,
      frame_fill: 'largest practical scale with 5–8% breathing room and no cropping',
      lighting: 'neutral directional studio key with soft fill, controlled edge separation, and dimensional fabric contrast',
      restrained_grounding_shadow: true,
      people_allowed: false,
      body_parts_allowed: false,
      mannequins_allowed: false,
      hangers_allowed: false,
      props_allowed: false,
    },
  };
}

function parseJsonObject(text) {
  const src = String(text || '').trim();
  try { return JSON.parse(src); } catch (_) {
    const first = src.indexOf('{');
    const last = src.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(src.slice(first, last + 1)); } catch (_) {}
    }
  }
  throw new Error('Kimi returned an invalid analysis response');
}

async function analyzeWithKimi({ product, decorations, images }) {
  const config = getKimiConfig();
  if (!config.key) throw new Error('Kimi/Moonshot is not configured');
  const brief = buildAnalysisBrief(product, decorations);
  const content = [
    {
      type: 'text',
      text: [
        'Analyze the supplied product and artwork references for a truthful premium ecommerce image edit.',
        'The first image is the source product. Remaining images are exact locked artwork/brand references.',
        'Return JSON only with keys: garment_invariants (array), protected_elements (array),',
        'decoration_bounds (array), edit_prompt (string), and qa_checklist (array).',
        'The required output is the garment or product alone as the sole centered hero object.',
        'Composition is locked to a premium near-front hero view with only a subtle 8–15 degree turn—about half',
        'the rotation of a typical three-quarter view. Keep the front 85–92% visually dominant, reveal only a hint',
        'of one side, and never exceed 15 degrees. Avoid both a flat straight-on catalog cutout and a pronounced',
        'side view. Create drama through dimensional neutral studio lighting—not excessive rotation or background.',
        'For pants, shorts, and other bottoms, angle the waistband and stagger the legs naturally enough to reveal',
        'a side plane without twisting, crossing, shortening, or changing the product. Keep every edge visible.',
        'Shape the empty garment with believable on-body volume and drape using invisible support only: dimensional',
        'shoulders, chest, sleeves, waist, hips, and legs as appropriate, but absolutely no visible or residual person,',
        'skin, body part, body silhouette, mannequin, dress form, hanger, or support structure.',
        'The background is locked to uniform neutral pure white (#FFFFFF). Never request cream, beige, ivory,',
        'a warm-neutral tint, colored cast, gradient, vignette, or off-white background in edit_prompt.',
        'If the source contains a person, model, body part, mannequin, dress form, hanger, or prop, require its',
        'complete removal. Never include or invent a wearer, display form, lifestyle scene, or secondary object',
        'in edit_prompt. The qa_checklist must explicitly verify the pure white background and that none remain.',
        'Never authorize changing the garment type, cut, color, material, seams, closures, manufacturer marks,',
        'or customer/team artwork. Artwork spelling, geometry, colors, and placement are locked.',
        `STRUCTURED_INPUT=${JSON.stringify(brief)}`,
      ].join('\n'),
    },
    ...images.map((image) => ({ type: 'image_url', image_url: { url: dataUrl(image) } })),
  ];
  const res = await fetch(KIMI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You are an apparel prepress QA and product-only ecommerce specialist. Inspect visual facts; do not invent product details.',
        },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Kimi analysis failed (${res.status}): ${payload?.error?.message || 'unknown provider error'}`);
  const text = payload?.choices?.[0]?.message?.content;
  return {
    analysis: parseJsonObject(text),
    model: config.model,
    providerJobId: payload.id || null,
  };
}

function buildEditPrompt(product, decorations, analysis) {
  const brief = buildAnalysisBrief(product, decorations);
  const modelPrompt = String(analysis?.edit_prompt || '').trim();
  return [
    'Create a premium, photorealistic ecommerce hero image by editing the FIRST supplied product image.',
    'BACKGROUND — REQUIRED: use a uniform neutral pure white (#FFFFFF) seamless ecommerce backdrop.',
    'Pixels outside the product and its restrained neutral light-gray grounding shadow must read as #FFFFFF.',
    'No cream, beige, ivory, tan, warm tint, warm-neutral cast, colored cast, gradient, vignette, or off-white.',
    'OUTPUT SUBJECT: the garment or product alone, centered as the sole hero object.',
    'If the source includes a person, model, face, head, hair, skin, hand, arm, leg, foot, body, silhouette,',
    'mannequin, dress form, hanger, prop, or scenery, remove it completely. Do not preserve or invent a wearer.',
    'The final image must contain no people, models, body parts, mannequins, dress forms, hangers, lifestyle',
    'props, secondary objects, scenery, text, or watermarks—only the complete hero garment or product.',
    'COMPOSITION — REQUIRED: create a premium near-front hero view with a subtle three-quarter suggestion rather',
    'than a flat straight-on catalog cutout or pronounced side view. Rotate the product only approximately 8–15',
    'degrees around its vertical axis—about half a typical three-quarter turn. The front must remain 85–92%',
    'visually dominant, with only a hint of one side plane for depth. Never exceed 15 degrees of visible rotation.',
    'Keep the decorated front panel facing the camera with minimal foreshortening so artwork remains prominent.',
    'Use a subtly elevated camera when it improves the silhouette. The product should feel sculptural, substantial,',
    'and aspirational—not limp, pasted-on, diagrammatic, or orthographic.',
    'PRESENTATION — REQUIRED: shape the garment with polished invisible support so it has believable on-body',
    'volume and natural worn drape, as though occupied, while remaining a product-only image. Tops must have',
    'dimensional shoulders, chest, torso, and sleeves rather than lying flat. Bottoms must have natural volume',
    'through the waist, seat, thighs, knees, and legs rather than hanging as a flat symmetrical diagram.',
    'There must be no visible or residual wearer, skin, body part, human outline, mannequin, dress form, hanger,',
    'support rod, clipping artifact, hollow neck artifact, or transparent body. Only the garment may be visible.',
    'For tops and outerwear, use natural dimensional volume with one side receding slightly. For pants, shorts,',
    'and other bottoms, angle the waistband and stagger the legs subtly to reveal depth while preserving the exact',
    'rise, inseam, taper, cuffs, pockets, proportions, and complete silhouette. Never cross, twist, bend, or shorten',
    'the legs unnaturally. For hats and accessories, show the front plus one side at the same premium three-quarter angle.',
    'Truthfulness is mandatory: preserve the exact garment type, cut, silhouette, color, material, seams,',
    'panels, pockets, closures, hems, sleeves, hat shape, and all manufacturer branding.',
    'Other supplied images are locked artwork references. Reproduce them exactly—never redraw, restyle,',
    'respell, simplify, or invent a logo. Keep each decoration inside the stated production bounds.',
    'Fill the frame at the largest practical scale with roughly 5–8% breathing room while keeping the complete',
    'product visible; do not crop any sleeve, hem, cuff, waistband, brim, logo, or detail.',
    'Use a neutral directional studio key light from the upper-left or upper-right, soft fill, controlled edge',
    'separation, realistic restrained grounding shadow, rich but truthful tonal contrast, and dimensional fabric',
    'depth. The dramatic appeal must come from product angle, scale, form, texture, and lighting; the background',
    'must remain uniform pure white with no gradient or vignette. Embroidery may have subtle raised thread',
    'direction and edge depth; screen print must remain flat and naturally integrated with the fabric.',
    'Do not add seams, pockets, colors, patterns, logos, or decoration.',
    `PRODUCT=${JSON.stringify(brief)}`,
    `LOCKED_INVARIANTS=${JSON.stringify(analysis?.garment_invariants || [])}`,
    `PROTECTED_ELEMENTS=${JSON.stringify(analysis?.protected_elements || [])}`,
    `PRODUCTION_BOUNDS=${JSON.stringify(analysis?.decoration_bounds || [])}`,
    modelPrompt ? `KIMI_EDIT_GUIDANCE=${modelPrompt}` : '',
  ].filter(Boolean).join('\n');
}

async function generateWithOpenAI({ product, decorations, images, analysis }) {
  const config = getOpenAiConfig();
  if (!config.key) throw new Error('OpenAI image generation is not configured');
  const prompt = buildEditPrompt(product, decorations, analysis);
  const form = new FormData();
  images.forEach((image, index) => {
    form.append('image[]', new Blob([image.bytes], { type: image.contentType }), `reference-${index + 1}.${imageExtension(image.contentType)}`);
  });
  form.append('model', config.model);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('n', '1');
  const res = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.key}` },
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI image edit failed (${res.status}): ${payload?.error?.message || 'unknown provider error'}`);
  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image edit returned no image data');
  return {
    bytes: Buffer.from(b64, 'base64'),
    contentType: 'image/png',
    model: config.model,
    providerJobId: payload.id || null,
    prompt,
  };
}

function artworkUrls(decorations, storeArt) {
  const urls = [];
  const add = (value) => {
    if (typeof value !== 'string' || !value.startsWith('https://') || urls.includes(value)) return;
    urls.push(value);
  };
  (Array.isArray(decorations) ? decorations : []).forEach((d) => {
    add(d?.art_url);
    add(d?.source_url);
    add(d?.orig_url);
    add(d?.url);
    add(d?.image_url);
    add(d?.web_logo_url);
    Object.values(d?.cw_by_color || {}).forEach(add);
  });
  (Array.isArray(storeArt) ? storeArt : []).forEach((a) => {
    add(a?.url);
    add(a?.image_url);
    (Array.isArray(a?.web_logos) ? a.web_logos : []).forEach((w) => add(typeof w === 'string' ? w : w?.url));
  });
  return urls.slice(0, 3);
}

module.exports = {
  PROMPT_VERSION,
  normalizeMode,
  getKimiConfig,
  getOpenAiConfig,
  isPublicAddress,
  isAllowedImageHost,
  fetchRemoteImage,
  cleanDecorations,
  buildAnalysisBrief,
  buildEditPrompt,
  analyzeWithKimi,
  generateWithOpenAI,
  artworkUrls,
};
