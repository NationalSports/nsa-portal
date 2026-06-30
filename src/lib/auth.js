// Shared Supabase auth helpers for the pre-auth login gate.
//
// These let the login screen (rendered from index.js) authenticate a user
// WITHOUT pulling in the full portal bundle (App.js, ~2.6MB). App.js keeps its
// own byte-identical inline copies of these wrappers for the in-session /
// logout gate; this module exists so a logged-out visitor can sign in against a
// tiny entry bundle and only download App.js once a session is established.
//
// The client is the shared one from ./supabase — it uses the same Supabase auth
// storage key and the same per-tab auth lock as App.js's client, so a session
// established here is visible to App.js the moment it mounts.
import { supabase } from './supabase';

export { supabase };

export const sbSignIn = async (email, password) => {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { user: data.user, session: data.session };
};

export const sbSignUp = async (email, password) => {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  if (error) return { error: error.message };
  return { user: data.user };
};

export const sbResendSignup = async (email) => {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } });
  if (error) return { error: error.message };
  return { success: true };
};

export const sbResetPassword = async (email) => {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/auth/reset' });
  if (error) return { error: error.message };
  return { success: true };
};

export const sbSignOut = async () => { if (supabase) await supabase.auth.signOut(); };

export const sbGetSession = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
};

export const sbLinkTeamAuth = async (teamId, authId) => {
  if (!supabase) return;
  await supabase.rpc('link_team_auth', { p_team_id: teamId, p_auth_id: authId });
};

export const sbGetMyProfile = async () => {
  if (!supabase) return null;
  const { data } = await supabase.rpc('get_my_profile');
  return data?.[0] || null;
};

// Team roster for the gate's first-time-setup and admin-impersonation modes.
// Small table (dozens of rows); a normal sign-in never blocks on it — the gate
// seeds reps from localStorage/defaults and refreshes with this in the
// background. Mirrors App.js's `_safeQuery('team_members',{order:'name'})`.
export const sbGetTeam = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase.from('team_members').select('*').order('name');
  if (error) return [];
  return data || [];
};
