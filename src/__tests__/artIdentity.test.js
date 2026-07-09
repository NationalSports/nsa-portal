/* eslint-disable */
/**
 * Cross-customer art identity — the SO-1057 / football-on-volleyball class.
 *
 * SAFE: pure helpers only. No DB, no UI, no network.
 */
const {
  artLogoKey,
  artNameKey,
  buildTeamArtLibrary,
  resolvePriorMockKey,
  prevArtAutoWireTargets,
  artWriteMatches,
} = require('../lib/artIdentity');

describe('artLogoKey / artNameKey', () => {
  test('logo key includes deco_type; blank name falls back to id', () => {
    expect(artLogoKey({ name: 'Front Logo', deco_type: 'screen_print' })).toBe('front logo||screen_print');
    expect(artLogoKey({ name: '  Front Logo  ', deco_type: 'embroidery' })).toBe('front logo||embroidery');
    expect(artLogoKey({ id: 'af1', name: '', deco_type: 'screen_print' })).toBe('__id__af1');
  });
  test('name key is lowercased trim of name (or id)', () => {
    expect(artNameKey({ name: 'Front Logo Tees Dolphin' })).toBe('front logo tees dolphin');
    expect(artNameKey({ id: 'caf9' })).toBe('caf9');
  });
});

describe('buildTeamArtLibrary — parent must not clobber team art', () => {
  const teamId = 'vb-team';
  const parentId = 'school-parent';
  const vbArt = {
    id: 'caf-vb',
    name: 'Front Logo',
    deco_type: 'screen_print',
    preview_url: '',
    mockup_files: [],
  };
  const fbArt = {
    id: 'caf-fb',
    name: 'Front Logo', // same name as volleyball — the contamination vector
    deco_type: 'screen_print',
    preview_url: 'https://cdn.example/football.png',
    mockup_files: [{ url: 'https://cdn.example/football-mock.png' }],
  };

  test('parent library art with the same name does NOT replace the team record', () => {
    const lib = buildTeamArtLibrary({
      teamArt: [vbArt],
      parentArt: [fbArt],
      teamId,
      parentId,
      parentLabel: 'School library',
    });
    const byId = Object.fromEntries(lib.map((a) => [a.id, a]));
    // Team id must still be present and authoritative.
    expect(byId['caf-vb']).toBeTruthy();
    expect(byId['caf-vb']._srcCustId).toBe(teamId);
    // Parent copy must NOT appear under the team's name slot (and must not steal the id).
    expect(lib.find((a) => a.id === 'caf-fb')).toBeUndefined();
    // The name-keyed entry the store→SO path would resolve is still the volleyball id.
    expect(lib.find((a) => artNameKey(a) === 'front logo').id).toBe('caf-vb');
  });

  test('parent art with a UNIQUE name is still available for intentional reuse', () => {
    const unique = { id: 'caf-school', name: 'School Crest', deco_type: 'embroidery', preview_url: 'https://cdn.example/crest.png' };
    const lib = buildTeamArtLibrary({
      teamArt: [vbArt],
      parentArt: [unique],
      teamId,
      parentId,
    });
    expect(lib.map((a) => a.id).sort()).toEqual(['caf-school', 'caf-vb']);
    expect(lib.find((a) => a.id === 'caf-school')._srcCustId).toBe(parentId);
  });

  test('order art for the team is kept even when parent has a same-name preview', () => {
    const orderCopy = { ...vbArt, id: 'af-so-vb', preview_url: '' };
    const lib = buildTeamArtLibrary({
      teamArt: [],
      parentArt: [fbArt],
      orderArt: [{ art: orderCopy, label: 'SO-1057', srcCustId: teamId }],
      teamId,
      parentId,
    });
    expect(lib.find((a) => a.id === 'af-so-vb')).toBeTruthy();
    expect(lib.find((a) => a.id === 'caf-fb')).toBeUndefined();
  });
});

describe('resolvePriorMockKey — M10 deco_type required', () => {
  const keyByDesign = { design_abc: 'front logo||screen_print' };
  const keyByNameDeco = {
    'front logo||screen_print': 'front logo||screen_print',
    'front logo||embroidery': 'front logo||embroidery',
  };

  test('design_id wins when present', () => {
    expect(resolvePriorMockKey(
      { design_id: 'design_abc', name: 'Other Name', deco_type: 'embroidery' },
      { keyByDesign, keyByNameDeco },
    )).toBe('front logo||screen_print');
  });

  test('name match requires deco_type equality (no bare-name fallback)', () => {
    expect(resolvePriorMockKey(
      { name: 'Front Logo', deco_type: 'screen_print' },
      { keyByDesign, keyByNameDeco },
    )).toBe('front logo||screen_print');
    // Same name, different deco — must NOT match the screen-print key.
    expect(resolvePriorMockKey(
      { name: 'Front Logo', deco_type: 'heat_transfer' },
      { keyByDesign, keyByNameDeco },
    )).toBeNull();
  });
});

describe('prevArtAutoWireTargets — do not steal every empty slot', () => {
  const clone = { id: 'af-new', name: 'Football Logo', deco_type: 'screen_print', design_id: 'd1' };

  test('a single untyped empty art deco on the order IS auto-wired', () => {
    const items = [{ decorations: [{ kind: 'art', art_file_id: null }] }];
    expect(prevArtAutoWireTargets(items, [], clone)).toEqual([{ ii: 0, di: 0 }]);
  });

  test('multiple empty art decos without matching deco_type are NOT all stolen', () => {
    // Multi-logo order: two unwired art slots. Old M14 pointed BOTH at the reused
    // football art — that is the SO-1057 auto-wire bug.
    const items = [{
      decorations: [
        { kind: 'art', art_file_id: null },
        { kind: 'art', art_file_id: null },
      ],
    }];
    expect(prevArtAutoWireTargets(items, [], clone)).toEqual([]);
  });

  test('empty slots whose deco_type matches the clone ARE wired', () => {
    const items = [{
      decorations: [
        { kind: 'art', art_file_id: null, deco_type: 'screen_print' },
        { kind: 'art', art_file_id: null, deco_type: 'embroidery' },
      ],
    }];
    expect(prevArtAutoWireTargets(items, [], clone)).toEqual([{ ii: 0, di: 0 }]);
  });

  test('ART TBD of matching type is wired; wrong type is not', () => {
    const items = [{
      decorations: [
        { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print' },
        { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'embroidery' },
      ],
    }];
    expect(prevArtAutoWireTargets(items, [], clone)).toEqual([{ ii: 0, di: 0 }]);
  });

  test('empty same-design placeholder (waiting_for_art) is wired by design_id', () => {
    const existing = [{ id: 'af-old', name: 'Football Logo', deco_type: 'screen_print', design_id: 'd1', status: 'waiting_for_art' }];
    const items = [{ decorations: [{ kind: 'art', art_file_id: 'af-old' }] }];
    expect(prevArtAutoWireTargets(items, existing, clone)).toEqual([{ ii: 0, di: 0 }]);
  });

  test('already-approved art is never stolen', () => {
    const existing = [{ id: 'af-old', name: 'Football Logo', deco_type: 'screen_print', design_id: 'd1', status: 'approved' }];
    const items = [{ decorations: [{ kind: 'art', art_file_id: 'af-old' }] }];
    expect(prevArtAutoWireTargets(items, existing, clone)).toEqual([]);
  });
});

describe('artWriteMatches — source-customer scoped name writes', () => {
  test('same art id always matches', () => {
    expect(artWriteMatches({ id: 'af1', name: 'Logo', deco_type: 'screen_print' }, {
      artId: 'af1', name: 'Other', decoType: 'embroidery', soCustomerId: 'vb', srcCustId: 'fb',
    })).toBe(true);
  });

  test('name+deco match is refused when SO customer differs from art source', () => {
    // Parent view editing volleyball "Front Logo" must not rewrite football SO art.
    expect(artWriteMatches({ id: 'af-fb', name: 'Front Logo', deco_type: 'screen_print' }, {
      artId: 'af-vb', name: 'Front Logo', decoType: 'screen_print',
      soCustomerId: 'fb-team', srcCustId: 'vb-team',
    })).toBe(false);
  });

  test('name+deco match is allowed on the source customer\'s own SOs', () => {
    expect(artWriteMatches({ id: 'af-vb2', name: 'Front Logo', deco_type: 'screen_print' }, {
      artId: 'af-vb', name: 'Front Logo', decoType: 'screen_print',
      soCustomerId: 'vb-team', srcCustId: 'vb-team',
    })).toBe(true);
  });
});
