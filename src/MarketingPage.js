import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { authFetch } from './utils';

// Marketing Command Center: a portal-native mirror of the standalone SEO
// Command Center dashboard (nsa-website/public/seo-command.html), plus the
// review/email channels that dashboard doesn't cover. All data lives in one
// Supabase table (marketing_data, one row per source) refreshed by the daily
// marketing-sync Netlify function; this page only reads it and, for Google
// reviews, can draft/post a reply through two more functions.

const SEO_AWAITING_MSG = "SEO data hasn't synced yet — it runs on the daily marketing sync — press Sync now.";

// ---- small formatting helpers ----

function fmtDateShort(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTimeShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtNum(n) {
  return n == null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US');
}

function starStr(n) {
  return '★'.repeat(Math.max(0, Math.round(Number(n) || 0)));
}

function reportUrl(file) {
  return `https://nationalsportsapparel.com/${String(file || '').replace(/^\/+/, '')}`;
}

function ownerBadge(owner) {
  return owner === 'steve' ? <span className="badge badge-amber">yours</span> : <span className="badge badge-gray">claude</span>;
}
function statusBadge(status) {
  const map = { active: 'badge-blue', complete: 'badge-green', blocked: 'badge-red', proposed: 'badge-gray' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}
function priorityBadge(p) {
  const map = { P1: 'badge-red', P2: 'badge-amber', P3: 'badge-gray' };
  return <span className={`badge ${map[p] || 'badge-gray'}`}>{p}</span>;
}

// ---- small shared presentational pieces ----

function AwaitingSetup({ msg }) {
  return <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>{msg}</div>;
}

function StatBlock({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

const th = { padding: '8px 10px', textAlign: 'left' };
const thRight = { padding: '8px 10px', textAlign: 'right' };
const td = { padding: '8px 10px' };
const tdRight = { padding: '8px 10px', textAlign: 'right' };
const trBorder = { borderBottom: '1px solid #f1f5f9' };
const theadRow = { background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };

function TableHead({ cols }) {
  return <thead><tr style={theadRow}>{cols.map((c, i) => <th key={i} style={c.r ? thRight : th}>{c.l}</th>)}</tr></thead>;
}

function EmptyRow({ span, text }) {
  return <tr><td colSpan={span} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>{text}</td></tr>;
}

function ReviewEntry({ name, date, stars, text, children }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 13, color: '#1e293b' }}>{name}</strong>
        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDateShort(date)}</span>
      </div>
      <div style={{ color: '#f59e0b', fontSize: 13, letterSpacing: 1 }}>{starStr(stars)}</div>
      <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>{text}</div>
      {children}
    </div>
  );
}

export default function MarketingPage() {
  const [sources, setSources] = useState(null); // { [source]: { data, fetched_at } }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncWarnings, setSyncWarnings] = useState(null);

  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusy, setReviewBusy] = useState({});
  const [reviewErrors, setReviewErrors] = useState({});

  const loadData = useCallback(async () => {
    if (!supabase) { setErr('No DB connection'); setLoading(false); setRefreshing(false); return; }
    setErr(null);
    try {
      const { data, error } = await supabase.from('marketing_data').select('source,data,fetched_at');
      if (error) throw error;
      const by = {};
      (data || []).forEach((r) => { by[r.source] = { data: r.data, fetched_at: r.fetched_at }; });
      setSources(by);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(() => { setRefreshing(true); loadData(); }, [loadData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncWarnings(null);
    try {
      const res = await authFetch('/.netlify/functions/marketing-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(json.error || `Sync failed (HTTP ${res.status})`);
      } else {
        // Per-source outcomes are nested under json.results ({seo:{ok|skipped|error},...})
        const failed = Object.entries(json.results || {}).filter(([, v]) => v && typeof v === 'object' && v.ok === false);
        if (failed.length) setSyncWarnings(failed.map(([k, v]) => `${k}: ${v.error || 'failed'}`));
      }
      await loadData();
    } catch (e) {
      setSyncError(e.message || String(e));
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const setDraftText = (id, text) => setReviewDrafts((prev) => ({ ...prev, [id]: text }));

  const draftReply = useCallback(async (review) => {
    setReviewErrors((prev) => ({ ...prev, [review.id]: null }));
    setReviewBusy((prev) => ({ ...prev, [review.id]: 'drafting' }));
    try {
      const res = await authFetch('/.netlify/functions/marketing-draft-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewText: review.text, starRating: review.stars, reviewerName: review.author }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setReviewErrors((prev) => ({ ...prev, [review.id]: json.error || json.reason || `Draft failed (HTTP ${res.status})` }));
      } else {
        setReviewDrafts((prev) => ({ ...prev, [review.id]: json.draft || '' }));
      }
    } catch (e) {
      setReviewErrors((prev) => ({ ...prev, [review.id]: e.message || String(e) }));
    } finally {
      setReviewBusy((prev) => ({ ...prev, [review.id]: null }));
    }
  }, []);

  const postReply = useCallback(async (review) => {
    const text = reviewDrafts[review.id] || '';
    setReviewErrors((prev) => ({ ...prev, [review.id]: null }));
    setReviewBusy((prev) => ({ ...prev, [review.id]: 'posting' }));
    try {
      const res = await authFetch('/.netlify/functions/marketing-gbp-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewName: review.id, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setReviewDrafts((prev) => { const n = { ...prev }; delete n[review.id]; return n; });
        await loadData();
      } else {
        setReviewErrors((prev) => ({ ...prev, [review.id]: json.error || json.reason || `Post failed (HTTP ${res.status})` }));
      }
    } catch (e) {
      setReviewErrors((prev) => ({ ...prev, [review.id]: e.message || String(e) }));
    } finally {
      setReviewBusy((prev) => ({ ...prev, [review.id]: null }));
    }
  }, [reviewDrafts, loadData]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>;

  if (err) {
    return (
      <div className="card" style={{ borderLeft: '3px solid #dc2626' }}>
        <div className="card-body" style={{ color: '#991b1b', fontSize: 13 }}>
          Error loading marketing data: {err}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const seo = sources?.seo?.data || null;
  const google = sources?.google?.data || null;
  const googleFetchedAt = sources?.google?.fetched_at || null;
  const yelp = sources?.yelp?.data || null;
  const yelpFetchedAt = sources?.yelp?.fetched_at || null;
  const brevo = sources?.brevo?.data || null;
  const brevoFetchedAt = sources?.brevo?.fetched_at || null;

  const audit = seo?.audit || {};
  const metrics = audit.metrics || {};
  const checks = audit.checks || [];
  const passing = checks.filter((c) => c.ok).length;
  const scoreColor = audit.score == null ? '#64748b' : audit.score >= 90 ? '#16a34a' : audit.score >= 70 ? '#d97706' : '#dc2626';

  // Latest-per-query dedupe, mirroring seo-command.html: later entries in the
  // results array win, so forEach-and-overwrite (not a filter) is intentional.
  const latestByQuery = {};
  (seo?.aiVisibility?.results || []).forEach((r) => { latestByQuery[r.query] = r; });
  const latestVisList = Object.values(latestByQuery);
  const queriesTotal = (seo?.aiVisibility?.queries || []).length;
  const queriesWon = latestVisList.filter((r) => r.nsaAppears).length;

  const history = seo?.history || [];
  const maxKB = Math.max(...history.map((h) => h.homepageKB || 0), 1);

  const openActions = (seo?.actionQueue || []).filter((q) => q.status === 'open').slice()
    .sort((a, b) => a.priority.localeCompare(b.priority));

  const runsReversed = (seo?.runs || []).slice().reverse();
  const reportsReversed = (seo?.reports || []).slice().reverse();
  const sc = seo?.searchConsole;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          SEO last run: <strong style={{ color: '#1e293b' }}>{seo?.lastRun || '—'}</strong>
          {' · '}Google {fmtDateTimeShort(googleFetchedAt) || '—'}
          {' · '}Yelp {fmtDateTimeShort(yelpFetchedAt) || '—'}
          {' · '}Brevo {fmtDateTimeShort(brevoFetchedAt) || '—'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={handleRefresh} disabled={refreshing || syncing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn btn-primary btn-sm" onClick={handleSync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>
      </div>

      {(syncError || syncWarnings) && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #dc2626' }}>
          <div className="card-body" style={{ color: '#991b1b', fontSize: 13 }}>
            {syncError && <div>Sync error: {syncError}</div>}
            {syncWarnings && <div>Some sources failed to sync — {syncWarnings.join('; ')}</div>}
          </div>
        </div>
      )}

      {/* Health tiles */}
      <div className="stats-row">
        <StatBlock label="Audit score" value={audit.score ?? '—'} color={scoreColor} sub={seo ? `${passing}/${checks.length} checks passing` : 'awaiting sync'} />
        <StatBlock label="Homepage weight" value={<>{metrics.homepageKB ?? '—'}<span style={{ fontSize: 14, color: '#94a3b8' }}> KB</span></>} sub="was 452 KB in June" />
        <StatBlock label="Sitemap URLs" value={metrics.sitemapURLs ?? '—'} sub="was 25 pre-engagement" />
        <StatBlock
          label="Target queries won"
          value={<>{queriesWon}<span style={{ fontSize: 14, color: '#94a3b8' }}>/{queriesTotal}</span></>}
          color={queriesWon === queriesTotal ? '#16a34a' : '#d97706'}
          sub="NSA present in retrieval"
        />
        <StatBlock
          label="Google rating"
          value={google ? (google.rating != null ? `${google.rating}★` : '—') : '—'}
          color={google ? undefined : '#94a3b8'}
          sub={google ? `${fmtNum(google.total)} reviews · ${google.provider === 'gbp' ? 'GBP' : 'Places'}` : 'awaiting setup'}
        />
        <StatBlock
          label="Yelp rating"
          value={yelp ? (yelp.rating != null ? `${yelp.rating}★` : '—') : '—'}
          color={yelp ? undefined : '#94a3b8'}
          sub={yelp ? `${fmtNum(yelp.review_count)} reviews` : 'awaiting setup'}
        />
        <StatBlock
          label="Email open rate"
          value={brevo ? `${brevo.rollup?.avgOpenRate ?? '—'}%` : '—'}
          color={brevo ? undefined : '#94a3b8'}
          sub={brevo ? `last 90d · ${fmtNum(brevo.rollup?.count90d)} campaigns` : 'awaiting setup'}
        />
      </div>

      {/* Homepage weight history + audit checks */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12, marginTop: 12 }}>
        <div className="card">
          <div className="card-header"><h2>Homepage weight history</h2></div>
          <div className="card-body">
            {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : history.length ? (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 130, padding: '8px 4px 0' }}>
                  {history.map((h, i) => (
                    <div key={i} title={`${h.date} — ${h.note || ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 50 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{h.homepageKB}</div>
                      <div style={{ width: 30, background: 'linear-gradient(180deg,#60a5fa,#1d4ed8)', borderRadius: '4px 4px 0 0', height: Math.max(8, 90 * (h.homepageKB || 0) / maxKB) }} />
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{(h.date || '').slice(5)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>HTML transfer size of / — smaller loads faster and lets AI crawlers reach the content. Hover a bar for the date.</div>
              </>
            ) : <div style={{ color: '#94a3b8', fontSize: 13 }}>No history yet.</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2>Audit checks</h2></div>
          <div className="card-body">
            {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHead cols={[{ l: 'Check' }, { l: 'Status' }]} />
                  <tbody>
                    {checks.map((c) => (
                      <tr key={c.id} style={trBorder}>
                        <td style={td}>{c.label}{c.detail && !c.ok && <span style={{ color: '#94a3b8' }}> ({c.detail})</span>}</td>
                        <td style={td}><span className={`badge ${c.ok ? 'badge-green' : 'badge-red'}`}>{c.ok ? 'PASS' : 'FAIL'}</span></td>
                      </tr>
                    ))}
                    {checks.length === 0 && <EmptyRow span={2} text="No checks yet." />}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Google reviews */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header">
          <h2>Reviews — Google</h2>
          {google && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{google.rating != null ? `${google.rating}★` : '—'} · {fmtNum(google.total)} reviews</span>
              <span className="badge badge-blue">{google.provider === 'gbp' ? 'GBP' : 'Places'}</span>
            </div>
          )}
        </div>
        <div className="card-body">
          {!google ? (
            <AwaitingSetup msg="Google reviews aren't connected yet — add GOOGLE_PLACES_API_KEY + NSA_PLACE_ID (read-only) or the GBP OAuth secrets (enables replies) in Netlify env, then Sync now." />
          ) : (
            <>
              {google.provider === 'places' && !google.canReply && (
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Read-only via Places API — reply capability arrives with the GBP OAuth setup.</div>
              )}
              {(google.reviews || []).length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>No reviews yet.</div>}
              {(google.reviews || []).map((r) => (
                <ReviewEntry key={r.id || `${r.author}-${r.createTime}`} name={r.author} date={r.createTime} stars={r.stars} text={r.text}>
                  {r.reply && (
                    <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid #e2e8f0', color: '#64748b', fontSize: 12 }}>
                      <em>Your reply · {fmtDateShort(r.reply.updateTime)}</em>
                      <div>{r.reply.text}</div>
                    </div>
                  )}
                  {google.canReply && r.id && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ marginBottom: 6 }}>
                        <button className="btn btn-secondary btn-sm" disabled={reviewBusy[r.id] === 'drafting'} onClick={() => draftReply(r)}>
                          {reviewBusy[r.id] === 'drafting' ? 'Drafting…' : 'Draft with AI'}
                        </button>
                      </div>
                      <textarea className="form-textarea" value={reviewDrafts[r.id] || ''} onChange={(e) => setDraftText(r.id, e.target.value)} placeholder="Write a reply…" />
                      <div style={{ marginTop: 6 }}>
                        <button className="btn btn-primary btn-sm" disabled={reviewBusy[r.id] === 'posting' || !(reviewDrafts[r.id] || '').trim()} onClick={() => postReply(r)}>
                          {reviewBusy[r.id] === 'posting' ? 'Posting…' : 'Post reply'}
                        </button>
                      </div>
                      {reviewErrors[r.id] && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{reviewErrors[r.id]}</div>}
                    </div>
                  )}
                </ReviewEntry>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Yelp reviews */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header">
          <h2>Reviews — Yelp</h2>
          {yelp && <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{yelp.rating != null ? `${yelp.rating}★` : '—'} · {fmtNum(yelp.review_count)} reviews</span>}
        </div>
        <div className="card-body">
          {!yelp ? (
            <AwaitingSetup msg="Yelp reviews aren't connected yet — add YELP_API_KEY + YELP_BUSINESS_ID in Netlify env, then Sync now." />
          ) : (
            <>
              {yelp.url && <div style={{ marginBottom: 10 }}><a href={yelp.url} target="_blank" rel="noopener noreferrer">View on Yelp</a></div>}
              {(yelp.reviews || []).length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>No reviews yet.</div>}
              {(yelp.reviews || []).map((r, i) => (
                <ReviewEntry key={i} name={r.user} date={r.time_created} stars={r.rating} text={r.text} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Brevo email */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header"><h2>Email — Brevo</h2></div>
        <div className="card-body">
          {!brevo ? (
            <AwaitingSetup msg="Email campaign stats aren't connected yet — BREVO_API_KEY is already configured for transactional email; campaign stats appear here after the first sync." />
          ) : (
            <>
              <div className="stats-row" style={{ marginBottom: 16 }}>
                <StatBlock label="Sent 90d" value={fmtNum(brevo.rollup?.sent90d)} />
                <StatBlock label="Avg open %" value={`${brevo.rollup?.avgOpenRate ?? '—'}%`} />
                <StatBlock label="Avg click %" value={`${brevo.rollup?.avgClickRate ?? '—'}%`} />
                <StatBlock label="Campaigns 90d" value={fmtNum(brevo.rollup?.count90d)} />
              </div>
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHead cols={[{ l: 'Name' }, { l: 'Sent date' }, { l: 'Sent', r: 1 }, { l: 'Delivered', r: 1 }, { l: 'Unique opens', r: 1 }, { l: 'Clicks', r: 1 }, { l: 'Bounces', r: 1 }, { l: 'Unsubs', r: 1 }]} />
                  <tbody>
                    {(brevo.campaigns || []).map((c) => (
                      <tr key={c.id} style={trBorder}>
                        <td style={td}>{c.name}<div style={{ fontSize: 11, color: '#94a3b8' }}>{c.subject}</div></td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateShort(c.sentDate)}</td>
                        <td style={tdRight}>{fmtNum(c.stats?.sent)}</td>
                        <td style={tdRight}>{fmtNum(c.stats?.delivered)}</td>
                        <td style={tdRight}>{fmtNum(c.stats?.uniqueOpens)} ({c.stats?.openRate ?? '—'}%)</td>
                        <td style={tdRight}>{fmtNum(c.stats?.clicks)} ({c.stats?.clickRate ?? '—'}%)</td>
                        <td style={tdRight}>{fmtNum(c.stats?.bounces)}</td>
                        <td style={tdRight}>{fmtNum(c.stats?.unsubscriptions)}</td>
                      </tr>
                    ))}
                    {(brevo.campaigns || []).length === 0 && <EmptyRow span={8} text="No campaigns yet." />}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* AI answer visibility */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header"><h2>AI answer visibility</h2></div>
        <div className="card-body">
          {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (
            <>
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHead cols={[{ l: 'Query' }, { l: 'NSA' }, { l: 'Last checked' }, { l: 'Notes' }]} />
                  <tbody>
                    {latestVisList.map((r, i) => (
                      <tr key={i} style={trBorder}>
                        <td style={td}>{r.query}</td>
                        <td style={td}>{r.nsaAppears ? <span className="badge badge-green">✓ {r.position || 'present'}</span> : <span className="badge badge-red">✕ absent</span>}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date}</td>
                        <td style={{ ...td, color: '#64748b' }}>{r.note}</td>
                      </tr>
                    ))}
                    {latestVisList.length === 0 && <EmptyRow span={4} text="No visibility checks yet." />}
                  </tbody>
                </table>
              </div>
              {seo.aiVisibility?.note && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{seo.aiVisibility.note}</div>}
            </>
          )}
        </div>
      </div>

      {/* Search performance */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header"><h2>Search performance</h2></div>
        <div className="card-body">
          {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : sc && sc.configured && (sc.queries || []).length ? (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                Top queries · {sc.range || ''} · <strong style={{ color: '#1e293b' }}>{fmtNum(sc.totals?.clicks)}</strong> clicks /{' '}
                <strong style={{ color: '#1e293b' }}>{fmtNum(sc.totals?.impressions)}</strong> impressions (as of {sc.asOf || '—'})
              </div>
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHead cols={[{ l: 'Query' }, { l: 'Clicks', r: 1 }, { l: 'Impr.', r: 1 }, { l: 'CTR%', r: 1 }, { l: 'Avg pos.', r: 1 }]} />
                  <tbody>
                    {sc.queries.map((q, i) => (
                      <tr key={i} style={trBorder}>
                        <td style={td}>{q.query}</td>
                        <td style={tdRight}>{fmtNum(q.clicks)}</td>
                        <td style={tdRight}>{fmtNum(q.impressions)}</td>
                        <td style={tdRight}>{q.ctr}%</td>
                        <td style={tdRight}>{q.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              {(sc && sc.note) || 'Not connected yet — add a Search Console service-account key to the environment and the Monday autopilot fills this in.'}
            </div>
          )}
        </div>
      </div>

      {/* Campaigns */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header"><h2>Campaigns</h2></div>
        <div className="card-body">
          {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (seo.campaigns || []).length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>No campaigns yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
              {seo.campaigns.map((c) => (
                <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>{c.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>{statusBadge(c.status)}{ownerBadge(c.owner)}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{c.goal}</div>
                  {(c.notes || []).length > 0 && <ul style={{ margin: '0 0 0 16px', fontSize: 12, color: '#64748b' }}>{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action queue */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header"><h2>Action queue</h2></div>
        <div className="card-body">
          {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <TableHead cols={[{ l: 'Priority' }, { l: 'Action' }, { l: 'Owner' }, { l: 'Added' }]} />
                <tbody>
                  {openActions.map((q, i) => (
                    <tr key={i} style={trBorder}>
                      <td style={td}>{priorityBadge(q.priority)}</td>
                      <td style={td}>{q.title}</td>
                      <td style={td}>{ownerBadge(q.owner)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{q.added}</td>
                    </tr>
                  ))}
                  {openActions.length === 0 && <EmptyRow span={4} text="No open actions." />}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Run log + Reports */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12, marginTop: 12 }}>
        <div className="card">
          <div className="card-header"><h2>Run log</h2></div>
          <div className="card-body">
            {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (
              <div className="table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHead cols={[{ l: 'Date' }, { l: 'Kind' }, { l: 'Summary' }]} />
                  <tbody>
                    {runsReversed.map((r, i) => (
                      <tr key={i} style={trBorder}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date}</td>
                        <td style={td}>{r.kind}</td>
                        <td style={td}>{r.summary}</td>
                      </tr>
                    ))}
                    {runsReversed.length === 0 && <EmptyRow span={3} text="No runs logged yet." />}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2>Reports</h2></div>
          <div className="card-body">
            {!seo ? <AwaitingSetup msg={SEO_AWAITING_MSG} /> : (
              <>
                {reportsReversed.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>No reports yet.</div>
                ) : (
                  <ul style={{ margin: '0 0 12px 16px', fontSize: 13, color: '#334155' }}>
                    {reportsReversed.map((r, i) => <li key={i} style={{ marginBottom: 4 }}><a href={reportUrl(r.file)} target="_blank" rel="noopener noreferrer">{r.date} — {r.title}</a></li>)}
                  </ul>
                )}
                <div style={{ fontSize: 12, color: '#94a3b8' }}>The weekly SEO autopilot in the website repo refreshes the underlying data every Monday.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
