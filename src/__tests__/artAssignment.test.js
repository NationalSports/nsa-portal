import { artAssignmentOwner, artistCanSeeWork } from '../lib/artAssignment';
import { filterArtRequests } from '../lib/standaloneArtRequests';

const erik = { id: 'erik', name: 'Erik', role: 'artist', is_active: true };
const mo = { id: 'mo', name: 'Mo', role: 'artist', is_active: true };
// SO-2898: approval completed the original art request, but the same artist
// still owes the Jaguar Head separation. Roster availability must not reroute it.
const separation = {
  id: 'JOB-2898-02', art_status: 'production_files_needed', assigned_artist: erik.id,
  art_requests: [{ artist: erik.id, status: 'completed' }],
};

test.each([
  ['full roster', [erik, mo]],
  ['only current artist loaded', [mo]],
  ['empty roster', []],
  ['partial member fields', [{ id: erik.id }, mo]],
  ['legacy defaults', [{ id: 'old-erik', role: 'art' }, { id: 'old-mo', role: 'art' }]],
])('separations stay with Erik with %s', (_, members) => {
  expect(artistCanSeeWork(separation, mo.id, members)).toBe(false);
  expect(artistCanSeeWork(separation, erik.id, members)).toBe(true);
  expect(artAssignmentOwner(separation, members)).toBe(erik.id);
});

test('reassignment takes precedence over an old open request to Mo', () => {
  const job = { ...separation, art_requests: [{ artist: mo.id, status: 'in_progress' }] };
  expect(artistCanSeeWork(job, mo.id, [erik, mo])).toBe(false);
  expect(artistCanSeeWork(job, erik.id, [erik, mo])).toBe(true);
});

test('latest open request owns work when no job artist is assigned', () => {
  const job = { art_requests: [
    { artist: mo.id, status: 'requested' }, { artist: erik.id, status: 'in_progress' },
  ] };
  expect(artistCanSeeWork(job, mo.id, [])).toBe(false);
  expect(artAssignmentOwner(job, [])).toBe(erik.id);
});

test('explicitly retired owner can fall back to a current request', () => {
  const job = { assigned_artist: 'retired', art_requests: [{ artist: erik.id, status: 'requested' }] };
  expect(artAssignmentOwner(job, [{ id: 'retired', role: 'art', is_active: false }])).toBe(erik.id);
  expect(artistCanSeeWork(job, mo.id, [{ id: 'retired', role: 'art', is_active: false }])).toBe(false);
});

test('genuinely unassigned and explicitly unavailable work remains claimable', () => {
  const members = [mo, { ...erik, is_active: false }];
  for (const job of [{}, { assigned_artist: '' }, { assigned_artist: erik.id }]) {
    expect(artAssignmentOwner(job, members)).toBe(null);
    expect(artistCanSeeWork(job, mo.id, members)).toBe(true);
  }
});

test('recalled and completed requests do not resurrect previous ownership', () => {
  const job = { art_requests: [{ artist: erik.id, status: 'recalled' }, { artist: mo.id, status: 'completed' }] };
  expect(artAssignmentOwner(job, [erik, mo])).toBe(null);
  expect(artistCanSeeWork(job, null, [])).toBe(false);
});

test.each([[[]], [[mo]], [[erik, mo]]])('standalone requests obey the same ownership with roster %j', reps => {
  const rows = [{ id: 'eriks', assigned_artist: erik.id }, { id: 'mos', assigned_artist: mo.id }, { id: 'pool' }];
  expect(filterArtRequests(rows, { cu: mo, reps }).map(r => r.id)).toEqual(['mos', 'pool']);
  expect(filterArtRequests(rows, { cu: erik, reps }).map(r => r.id)).toEqual(['eriks', 'pool']);
});
