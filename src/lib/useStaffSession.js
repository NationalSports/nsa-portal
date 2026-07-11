// Session tracker for the main staff `supabase` client — mirrors
// src/teamshop/useCoachSession.js, but against staff auth, not the isolated
// supabaseCoach client. Shared by the staff-only lazy chunks that sit outside
// App.js's own login flow (src/teamshopqueue/TeamShopQueue.js,
// src/floorstation/FloorStation.js).
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export function useStaffSession() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession((data && data.session) || null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => { if (alive) setSession(sess || null); });
    return () => { alive = false; if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);

  return {
    loading: session === undefined,
    signedIn: !!session,
    email: (session && session.user && session.user.email) || null,
  };
}
