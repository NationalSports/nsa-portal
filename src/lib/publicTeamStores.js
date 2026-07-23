// Public team-store directory data — the ONE query path for finding a team's
// webstore by name, shared by the portal-level /team-stores finder
// (src/storefront/TeamStores.js) and the Team Shop storefront's Team Stores
// page (src/teamshop/TeamStoresPage.js). Both read the anon-readable
// `webstores_public` view (supabase/migrations/00134 + 00163) — extract, don't
// duplicate, per the repo's no-hand-synced-copies rule.
import { supabase } from './supabase';

// Strip characters that would break the PostgREST or() filter syntax.
export const cleanTerm = (q) => String(q || '').replace(/[%,()*:]/g, ' ').trim();

// Human label for a store's close date; null when there's no usable date
// (no close_at, unparseable, or already past).
export function closesLabel(close_at) {
  if (!close_at) return null;
  const d = new Date(close_at);
  if (isNaN(d)) return null;
  const days = Math.ceil((d - Date.now()) / 86400000);
  if (days < 0) return null;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return days <= 7 ? `Closes ${date} · ${days <= 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's')} left` : `Open until ${date}`;
}

// Search publicly-listed stores by name/slug. `statuses` defaults to open-only
// (the /team-stores finder's pre-existing behavior); the Team Shop page passes
// ['open','closed'] so recently-closed stores still show up, marked closed.
// Returns [] for terms under 2 characters — same threshold both callers use.
export async function searchPublicTeamStores(term, { statuses = ['open'], limit = 24 } = {}) {
  const t = cleanTerm(term);
  if (t.length < 2) return [];
  const { data } = await supabase.from('webstores_public')
    .select('slug,name,status,logo_url,primary_color,accent_color,banner_url,close_at')
    .in('status', statuses)
    .eq('public_listed', true)
    .or(`name.ilike.*${t}*,slug.ilike.*${t}*`)
    .order('name')
    .limit(limit);
  return data || [];
}
