// The signed-in user is restored from localStorage synchronously, while the
// authoritative team row arrives with the database load. Resolve permissions
// directly from that row as soon as it is ready instead of waiting one extra
// render for the cache-sync effect to update the user object.
export const resolveAccessUser = (cachedUser, teamMembers, teamReady = true) => {
  if (!cachedUser || !teamReady || !Array.isArray(teamMembers)) return cachedUser;
  const current = teamMembers.find((member) => member.id === cachedUser.id);
  if (!current) return cachedUser;
  return {
    ...cachedUser,
    role: current.role || cachedUser.role,
    access: current.access == null ? null : current.access,
  };
};
