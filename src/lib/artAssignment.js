// The stored assignment owns the work, including post-approval separations.
// A missing roster row is not evidence that an artist is inactive: startup can
// temporarily supply defaults or an incomplete team list. Never broadcast that
// artist's jobs to everyone (SO-2898).
const unavailableArtist = (id, members) => {
  const member = members.find(m => m.id === id);
  return !!member && (member.is_active === false || (member.role && !['art', 'artist'].includes(member.role)));
};

export function artAssignmentOwner(job, members = []) {
  const assigned = job?.assigned_artist;
  if (assigned && !unavailableArtist(assigned, members)) return assigned;
  // Only fall back when no owner is assigned or the roster explicitly confirms
  // that owner is unavailable. An older request must not override a reassignment.
  const requests = Array.isArray(job?.art_requests) ? job.art_requests : [];
  for (let i = requests.length - 1; i >= 0; i--) {
    const request = requests[i];
    if (['requested', 'in_progress'].includes(request?.status) && request.artist
      && !unavailableArtist(request.artist, members)) return request.artist;
  }
  return null;
}

export function artistCanSeeWork(job, artistId, members = []) {
  const owner = artAssignmentOwner(job, members);
  return !!artistId && (!owner || owner === artistId);
}
