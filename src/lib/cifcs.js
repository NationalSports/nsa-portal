// Pure helpers for the CIFCS (cifcshome.org) public school-directory widget.
//
// The widget is backed by two UNAUTHENTICATED endpoints (no key, no login):
//   1. Section directory (HTML) — every school in a section as a <button data-id>:
//        GET /widget/school/directory?section_id=<n>
//   2. School detail (JSON) — that school's faculty + coaches, with emails:
//        GET /widget/get-school-details/<schoolId>/details
//
// These helpers build the URLs and normalize the payloads into flat prospect rows.
// There is NO network here on purpose — the Netlify sync function supplies the
// fetch — so this module stays unit-testable and safe to import anywhere.
//
// It's an undocumented internal widget, so parsing is defensive: missing fields
// degrade to empty, and only contacts that actually carry an email are emitted
// (an email is the whole point of a marketing prospect).

const CIFCS_BASE = 'https://www.cifcshome.org';

// Sections the widget exposes (value = section_id). Central first — it's NSA's
// home section — then the other CA sections, then the out-of-state ones. The
// widget's "No Section" (14) bucket is intentionally omitted.
const CIFCS_SECTIONS = [
  { id: 9, name: 'Central Section' },
  { id: 4, name: 'Central Coast Section' },
  { id: 6, name: 'Los Angeles City Section' },
  { id: 7, name: 'North Coast Section' },
  { id: 8, name: 'Northern Section' },
  { id: 2, name: 'Oakland Section' },
  { id: 5, name: 'SAC-Joaquin Section' },
  { id: 3, name: 'San Diego Section' },
  { id: 13, name: 'San Francisco Section' },
  { id: 1, name: 'Southern Section' },
  { id: 10, name: 'FHSAA' },
  { id: 11, name: 'North Carolina' },
  { id: 12, name: 'New Jersey' },
];

function sectionName(sectionId) {
  const s = CIFCS_SECTIONS.find((x) => x.id === Number(sectionId));
  return s ? s.name : null;
}

function directoryUrl(sectionId) {
  return `${CIFCS_BASE}/widget/school/directory?section_id=${encodeURIComponent(sectionId)}`;
}

function schoolDetailUrl(schoolId) {
  return `${CIFCS_BASE}/widget/get-school-details/${encodeURIComponent(schoolId)}/details`;
}

// Extract every school ({ id, name }) from a section directory page. Each school is
// a `<button class="... school-btn ..." ... data-id="1711">Name</button>`.
function parseSchoolListFromHtml(html) {
  const out = [];
  const seen = new Set();
  if (!html || typeof html !== 'string') return out;
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (!/\bschool-btn\b/.test(attrs)) continue; // only the school list buttons
    const idMatch = /\bdata-id\s*=\s*"(\d+)"/.exec(attrs);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    if (!id || seen.has(id)) continue;
    const name = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

function normEmail(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  // Basic sanity — a marketing prospect needs a real-looking address.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}

function slug(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Stable per-person key so re-syncs update in place. Keyed on school + role + sport
// + name (email is the mutable attribute we want to refresh, so it's NOT in the key).
// Falls back to email when the person has no name.
function sourceRef(schoolId, role, sport, first, last, email) {
  const namePart = `${slug(first)} ${slug(last)}`.trim();
  const who = namePart || normEmail(email);
  return `${schoolId}|${slug(role)}|${slug(sport)}|${who}`;
}

// Normalize a /details JSON payload into flat prospect rows (faculty + coaches).
// Only rows with a valid email are emitted; "position not filled" coaches are skipped.
// Rows are the exact insert shape for marketing_contacts (minus server-set columns).
function normalizeSchoolDetail(detail, opts = {}) {
  const out = [];
  if (!detail || typeof detail !== 'object') return out;
  const school = detail.school || {};
  const schoolId = school.id != null ? Number(school.id) : (opts.schoolId != null ? Number(opts.schoolId) : null);
  if (schoolId == null) return out;

  const sectionId = opts.sectionId != null ? Number(opts.sectionId) : (school.section_id != null ? Number(school.section_id) : null);
  const secName = opts.sectionName || (school.section != null ? String(school.section) : null);

  const base = {
    source: 'cifcs',
    school_id: schoolId,
    school_name: clean(school.name) || clean(school.full_name),
    section_id: sectionId,
    section_name: secName ? String(secName) : null,
    school_city: clean(school.city),
    school_state: clean(school.physical_state),
    school_website: clean(school.website),
  };

  const push = (role, sport, person) => {
    if (!person) return;
    const email = normEmail(person.email);
    if (!email) return; // no email → not a usable prospect
    const first = clean(person.firstname);
    const last = clean(person.lastname);
    out.push({
      ...base,
      source_ref: sourceRef(schoolId, role, sport, first, last, email),
      role: clean(role),
      sport: sport ? clean(sport) : null,
      first_name: first,
      last_name: last,
      email,
      phone: clean(person.work_phone),
      ext: clean(person.work_extension),
    });
  };

  const faculties = Array.isArray(detail.athleticFaculties) ? detail.athleticFaculties : [];
  for (const f of faculties) push(f && f.aft_name, null, f);

  const coaches = Array.isArray(detail.coaches) ? detail.coaches : [];
  for (const c of coaches) {
    if (!c) continue;
    if (c.na_coach === 1 || c.na_coach === '1' || c.na_coach === true) continue; // position not filled
    push(c.aft_name, c.sport, c);
  }

  // De-dupe within a school on source_ref (a person can appear once per role/sport).
  const byKey = new Map();
  for (const r of out) if (!byKey.has(r.source_ref)) byKey.set(r.source_ref, r);
  return Array.from(byKey.values());
}

module.exports = {
  CIFCS_BASE,
  CIFCS_SECTIONS,
  sectionName,
  directoryUrl,
  schoolDetailUrl,
  parseSchoolListFromHtml,
  normalizeSchoolDetail,
  normEmail,
  sourceRef,
};
