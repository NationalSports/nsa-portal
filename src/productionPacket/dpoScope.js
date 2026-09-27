export const dpoSelectionKey = dpo => dpo ? `${dpo.soId}\u0000${dpo.id}` : '';

// Query parameters describe the view; the existing token in the fragment
// remains the sole recipient grant and never travels in the HTTP URL.
export function dpoShareUrl(token, dpo, origin = window.location.origin) {
  const query = new URLSearchParams();
  if (dpo) {
    query.set('dpo', dpo.id);
    query.set('dpo_so', dpo.soId);
  }
  return `${origin}/production-packet${query.toString() ? `?${query}` : ''}#token=${encodeURIComponent(token)}`;
}
