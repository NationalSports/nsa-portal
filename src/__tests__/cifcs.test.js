/* Tests for the CIFCS directory-widget parsing/normalization (src/lib/cifcs.js).
 *
 * These lock the two things the sync depends on staying correct: pulling every
 * school id out of a section directory page, and flattening a /details JSON
 * payload into email-bearing prospect rows with a stable upsert key. Fixtures
 * mirror the real endpoint shapes (verified against cifcshome.org). Pure — no
 * network, no DB. */

const cifcs = require('../lib/cifcs');

// ── A trimmed but real-shaped section directory page. ──
const DIRECTORY_HTML = `
  <div class="content-container">
    <button class="  school-btn btn text-left  px-2 w-100" id="school-button-1707" data-id="1707">
      Alpaugh
    </button>
    <button class="  school-btn btn text-left  border-top  px-2 w-100" id="school-button-1711" data-id="1711">
      Bakersfield
    </button>
    <button class="  school-btn btn text-left  border-top  px-2 w-100" id="school-button-66" data-id="66">
      Cabrillo/Lompoc
    </button>
    <button class="some-other-btn" data-id="999">Not A School</button>
    <button class="school-btn" id="school-button-1711" data-id="1711">Bakersfield Dupe</button>
  </div>
`;

// ── A trimmed but real-shaped /details JSON payload. ──
const DETAIL = {
  school: {
    id: 1711,
    name: 'Bakersfield',
    full_name: 'Bakersfield High School',
    city: 'Bakersfield',
    physical_state: 'California',
    website: 'https://bhs.kernhigh.org',
    section: 'Central Section',
  },
  athleticFaculties: [
    { aft_name: 'Athletic Director', firstname: 'Matthew', lastname: 'Ornelaz', email: 'Matthew_Ornelaz@kernhigh.org', work_phone: '661-555-0100', work_extension: '123' },
    { aft_name: 'Principal', firstname: 'Ryan', lastname: 'Geivet', email: 'ryan_geivet@kernhigh.org', work_phone: null, work_extension: null },
    { aft_name: 'Athletic Trainer', firstname: 'Cleveland', lastname: 'McDonald', email: '', work_phone: null, work_extension: null }, // no email → dropped
  ],
  coaches: [
    { aft_name: 'Head Coach', firstname: 'Mario', lastname: 'Garza', email: 'mario_garza@kernhigh.org', sport: 'Baseball', sport_id: 1, level_id: 1, na_coach: 0 },
    { aft_name: 'Head Coach', firstname: 'Wes', lastname: 'Coach', email: 'wes@kernhigh.org', sport: 'Basketball, Boys', sport_id: 2, level_id: 1, na_coach: 0 },
    { aft_name: 'Assistant Coach', firstname: '', lastname: '', email: '', sport: 'Football', sport_id: 3, level_id: 1, na_coach: 1 }, // position not filled → dropped
  ],
};

describe('parseSchoolListFromHtml', () => {
  test('extracts every school button, dedupes, ignores non-school buttons', () => {
    const list = cifcs.parseSchoolListFromHtml(DIRECTORY_HTML);
    expect(list).toEqual([
      { id: 1707, name: 'Alpaugh' },
      { id: 1711, name: 'Bakersfield' },
      { id: 66, name: 'Cabrillo/Lompoc' },
    ]);
  });

  test('empty / bad input yields []', () => {
    expect(cifcs.parseSchoolListFromHtml('')).toEqual([]);
    expect(cifcs.parseSchoolListFromHtml(null)).toEqual([]);
    expect(cifcs.parseSchoolListFromHtml('<div>no buttons</div>')).toEqual([]);
  });
});

describe('normalizeSchoolDetail', () => {
  const rows = cifcs.normalizeSchoolDetail(DETAIL, { sectionId: 9, sectionName: 'Central Section' });

  test('emits only email-bearing, filled contacts', () => {
    // 2 faculty w/ email + 2 head coaches w/ email = 4 (trainer no email, football unfilled dropped)
    expect(rows).toHaveLength(4);
    const emails = rows.map((r) => r.email).sort();
    expect(emails).toEqual([
      'mario_garza@kernhigh.org',
      'matthew_ornelaz@kernhigh.org',
      'ryan_geivet@kernhigh.org',
      'wes@kernhigh.org',
    ]);
  });

  test('normalizes email to lowercase', () => {
    const ad = rows.find((r) => r.role === 'Athletic Director');
    expect(ad.email).toBe('matthew_ornelaz@kernhigh.org');
  });

  test('faculty have null sport; coaches carry their sport', () => {
    const ad = rows.find((r) => r.role === 'Athletic Director');
    expect(ad.sport).toBeNull();
    const baseball = rows.find((r) => r.sport === 'Baseball');
    expect(baseball.role).toBe('Head Coach');
  });

  test('denormalizes school + section context onto each row', () => {
    for (const r of rows) {
      expect(r.school_id).toBe(1711);
      expect(r.school_name).toBe('Bakersfield');
      expect(r.section_id).toBe(9);
      expect(r.section_name).toBe('Central Section');
      expect(r.school_state).toBe('California');
      expect(r.source).toBe('cifcs');
    }
  });

  test('source_ref is stable and unique per person/role/sport', () => {
    const ad = rows.find((r) => r.role === 'Athletic Director');
    expect(ad.source_ref).toBe('1711|athletic director||matthew ornelaz');
    const baseball = rows.find((r) => r.sport === 'Baseball');
    expect(baseball.source_ref).toBe('1711|head coach|baseball|mario garza');
    // unique across the set
    const refs = rows.map((r) => r.source_ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  test('re-normalizing the same payload yields identical keys (idempotent upsert)', () => {
    const again = cifcs.normalizeSchoolDetail(DETAIL, { sectionId: 9, sectionName: 'Central Section' });
    expect(again.map((r) => r.source_ref).sort()).toEqual(rows.map((r) => r.source_ref).sort());
  });

  test('bad input yields []', () => {
    expect(cifcs.normalizeSchoolDetail(null)).toEqual([]);
    expect(cifcs.normalizeSchoolDetail({})).toEqual([]);
    expect(cifcs.normalizeSchoolDetail({ school: {} })).toEqual([]); // no id
  });
});

describe('url + section helpers', () => {
  test('sectionName maps known ids and rejects unknown', () => {
    expect(cifcs.sectionName(9)).toBe('Central Section');
    expect(cifcs.sectionName(1)).toBe('Southern Section');
    expect(cifcs.sectionName(999)).toBeNull();
  });

  test('directoryUrl / schoolDetailUrl build the verified endpoints', () => {
    expect(cifcs.directoryUrl(9)).toBe('https://www.cifcshome.org/widget/school/directory?section_id=9');
    expect(cifcs.schoolDetailUrl(1711)).toBe('https://www.cifcshome.org/widget/get-school-details/1711/details');
  });

  test('normEmail validates and lowercases', () => {
    expect(cifcs.normEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(cifcs.normEmail('not-an-email')).toBe('');
    expect(cifcs.normEmail(null)).toBe('');
  });
});
