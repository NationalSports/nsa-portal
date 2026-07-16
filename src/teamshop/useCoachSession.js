import { useState, useEffect, useCallback } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';

// Tracks the coach's Supabase Auth session for the Team Shop chunk, so any
// teamshop page can know who (if anyone) is signed in without re-deriving it.
// Uses the isolated supabaseCoach client (separate storageKey — see
// lib/supabaseCoach.js) so a teamshop sign-in never collides with the admin
// portal's session, same as src/storefront/AdidasInventory.js.
//
// The coach's profile (name) + linked customers are NOT loaded here — that
// needs the JWT this hook exposes, sent to netlify/functions/teamshop-context.js
// (see TeamPicker.js), so this hook stays a thin session tracker.
export default function useCoachSession() {
  const [session, setSession] = useState(undefined); // undefined = not loaded yet, null = signed out

  useEffect(() => {
    let alive = true;
    supabaseCoach.auth.getSession().then(({ data }) => { if (alive) setSession((data && data.session) || null); });
    const { data: sub } = supabaseCoach.auth.onAuthStateChange((_event, sess) => { if (alive) setSession(sess || null); });
    return () => { alive = false; if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(() => { supabaseCoach.auth.signOut().catch(() => {}); }, []);

  return {
    loading: session === undefined,
    signedIn: !!session,
    email: (session && session.user && session.user.email) || null,
    accessToken: (session && session.access_token) || null,
    signOut,
  };
}
