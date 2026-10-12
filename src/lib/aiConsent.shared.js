const AI_CONSENT_VERSION = 'anthropic-chat-v1';
const AI_CONSENT = Object.freeze({ provider: 'Anthropic', version: AI_CONSENT_VERSION, accepted: true });
function hasAiConsent(value) { return !!value && value.accepted === true && value.provider === 'Anthropic' && value.version === AI_CONSENT_VERSION; }
module.exports = { AI_CONSENT_VERSION, AI_CONSENT, hasAiConsent };
