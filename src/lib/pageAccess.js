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

// AI Inbox contains the full contents of the shared sales mailbox. Keep this
// identity-based so another admin cannot gain access through a role change or
// an editable page-access array.
export const AI_INBOX_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export const canViewAiInbox = (user) =>
  !!user?.id && String(user.id) === AI_INBOX_OWNER_ID;
