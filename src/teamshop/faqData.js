// Team Shop FAQ content — re-exported from src/lib/teamshopFaq.js, the
// dual-consumer CJS single source of truth (same pattern as decoPricing.js).
// The data moved there so netlify/functions/teamshop-assistant.js can require
// the SAME facts to build the AI system prompt — one FAQ, no hand-synced
// copies (FABLE_SYSTEM_AUDIT rule). All existing importers of this module
// (FAQPage.js, Search.js, tests) are unchanged.
import { FAQ_CATEGORIES, FAQS } from '../lib/teamshopFaq';

export { FAQ_CATEGORIES, FAQS };
