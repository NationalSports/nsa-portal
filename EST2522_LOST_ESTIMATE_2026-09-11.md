# EST-2522 lost estimate — investigation and recovery

**Trigger:** Jered sent the customer a PDF for EST-2522 (Glen A Wilson HS Girls Basketball,
"2026 Spirit Pack", $3,428.45). The estimate in the portal shows one line item.

**Method:** forensic reconstruction from `audit_log`, `stale_save_log` and
`document_history_snapshots`, plus a read of the estimate save and poll-merge paths.
Claims marked CONFIRMED have a specific row or quoted line of code behind them.

---

## 1. Executive summary

**Nothing was deleted. Six of the seven garments were never written to the database at all.**

Jered's browser tab was locked out by the optimistic-concurrency ("stale write") guard from
06:29:46 PDT onward. From that moment every save he made was refused by the server. He kept
working for another twelve minutes and printed the customer PDF from his browser's memory —
a document whose contents existed nowhere but in that tab.

The lockout was **permanent, not transient**: once a tab falls behind, the poll-merge in
`App.js` throws away the newer database row wholesale, so the tab's `_version` can never catch
up, so its saves can never succeed. The two mechanisms deadlock against each other.

The trigger is a **string comparison between two different date formats** (§4.1). It is
active March through September. Today is September 11.

**The estimate is fully recoverable** — the complete document survives in
`document_history_snapshots` and matches the customer PDF line-for-line (§3).

---

## 2. What actually happened

All times UTC (subtract 7h for PDT). Reconstructed from `audit_log` (`row_id='EST-2522'`),
`stale_save_log` and `document_history_snapshots`.

| When | Who | What the DB recorded |
|---|---|---|
| 13:26:54 | Jered | Estimate created, v1. One item: `JW6602` Fleece Hood (row 407243) |
| 13:26:55 | Jered | v2 |
| 13:27:23 | Jered | v3. Art file `ART TBD 1` inserted |
| **13:29:46** | **Steve** | **v4 — this is the write that put Jered's tab behind** |
| 13:32:53 → 13:41:35 | Jered | **18 saves REJECTED as stale** (base_version 3 vs cur_version 4). Nothing written |
| 13:44:52 | Steve | v5 — Steve's tab saves its own copy (1 item, qty 12, 5% shipping) |

**CONFIRMED — the missing items were never inserted.** `audit_log` contains exactly one
`estimate_items` row id for this estimate for its entire life: `407243` (`JW6602`). There is no
INSERT, and therefore no DELETE, for `JW6604`, `KB9105`, `JX4476`, `5159512`, `JP4674` or
`JP4675`. Same for art files: only `ART TBD 1` was ever written; `ART TBD 2` and `ART TBD 3`
were not. 11 of the 12 decorations were never written.

**CONFIRMED — Jered was locked out, not merely conflicted.** `stale_save_log` holds
`base_version = 3, cur_version = 4, hits = 18, first_at 13:32:53, last_at 13:41:35`. That row
is upserted with the latest values on every hit, so `base_version` was **still 3 at 13:41:35** —
nine minutes and eighteen rejections after the DB moved to 4. The tab never adopted the new
version, and by design it never could (§4.1).

**Steve's 13:44:52 save is not the cause.** It wrote what his tab legitimately held — the v4
state. It is the reason the estimate today reads qty 12 with 5% shipping rather than qty 11 with
$65 flat, but the six missing garments were already absent before it ran.

---

## 3. What was lost, and where it survives

`document_history_snapshots` captured Jered's tab every ~30s and is append-only, so his work
survives there even though it never reached `estimate_items`. Snapshot **seq 955**
(13:41:38 UTC) is the last complete state.

Its contents reconcile exactly with the customer PDF:

| SKU | Item | Qty | Rate | Decorations |
|---|---|---|---|---|
| JW6602 | Adidas Fleece Hood — Black | 11 | $30.00 | ART TBD 1 front · numbers 2" heat transfer, left sleeve |
| JW6604 | Adidas M Fleece Pant — Black | 11 | $30.00 | ART TBD 2 left leg · numbers 2" heat transfer, back |
| KB9105 | Adidas 3 Stripe LS 1/4 Zip — Black/White | 11 | $42.00 | ART TBD 3 embroidery, left chest |
| JX4476 | Adidas LS Pregame Tee — Black/White | 11 | $21.00 | ART TBD 1 front (underbase) · names, back |
| 5159512 | Adidas Stadium 4 Backpack — Black | 11 (OSFA) | $39.00 | ART TBD 3 front · numbers 1" embroidery · names |
| JP4674 | Adidas Techfit SS Tee — Black | 11 | $22.75 | ART TBD 1 front (underbase) |
| JP4675 | Adidas Techfit SS Tee — White | 11 | $24.00 | ART TBD 1 front |

7 items · 12 decorations · 3 art files · shipping flat $65.

Garments $2,296.25 + decoration $768.40 = **subtotal $3,064.65**, + $65.00 shipping,
+ 9.750% tax on the subtotal ($298.80) = **total $3,428.45** — matching the PDF exactly.

Recovery script: `scripts/restore_est2522.sql`. It replays snapshot 955 through the app's own
`save_estimate` RPC, so versioning, audit rows, `line_id`s and the decoration-shrink guards all
behave as they would for an ordinary save. Pre-restore state is preserved in
`public.est2522_prerestore_backup_20260911`.

---

## 4. Root cause

### 4.1 The lockout deadlock — CONFIRMED

Two guards, each individually reasonable, form a cycle:

**Guard A — the server refuses a stale write.** `save_estimate` compares the client's
`p_base_version` against the row's `_version` and returns `{stale:true}` without writing when the
client is behind. Correct, and the reason nothing was silently clobbered.

**Guard B — the poll-merge keeps the local copy.** `src/App.js:3318`:

```js
const mergeEst = e => {
  const local = localById.get(e.id);
  if (local && local.updated_at && e.updated_at && local.updated_at > e.updated_at) return local;
```

When the local copy looks newer, the freshly-loaded DB row `e` is **discarded entirely** — and
`_version` rides on `e`. So the local copy keeps its stale `_version` forever.

The cycle: the client can only save once its `_version` catches up (A), and its `_version` can
only catch up when the merge accepts the DB row (B), which it refuses to do precisely because the
user has unsaved edits. **The harder someone is working, the more certainly they stay locked out.**

`dbEngine.js:1257` states the intended recovery — *"the realtime/poll merge stops protecting the
local copy and heals it to the DB's current version (rep then re-applies)"*. That healing is what
Guard B prevents.

### 4.2 The trigger: two date formats compared as strings — CONFIRMED

`local.updated_at > e.updated_at` is a **string** comparison, and the two sides are not the same
format:

- The **database** value is set by the `trg_estimates_updated` BEFORE UPDATE trigger
  (`set_updated_at()`) and is ISO: `2026-09-11 13:44:52.177736+00`.
  1,440 of 1,450 estimate rows carry this format.
- The **client** value is set by `new Date().toLocaleString()` — US locale:
  `9/11/2026, 6:39:18 AM`. There are **321** such assignments across `src/`.

So the comparison is `"9/11/2026, ..." > "2026-09-11 ..."` → `'9' > '2'` → **true**, regardless of
the actual times. The local copy wins unconditionally.

Verified across all twelve months — the local copy wrongly wins whenever the local month's first
digit exceeds `'2'`:

| Local month | 1 | 2 | **3–9** | 10 | 11 | 12 |
|---|---|---|---|---|---|---|
| Local wrongly wins | no | no | **yes** | no | no | no |

**The bug is live from March through September and dormant October through February.** This
incident is 11 September.

### 4.3 The warning did not reach the user — inference, not confirmed

The stale path calls `_dbNotify('This estimate changed in another tab. Your edit was NOT saved…')`,
but only `if(!_bgSync…)` — background saves are silent. Whether Jered saw eighteen toasts and
worked through them, or none at all, cannot be determined from server-side data. What is certain
is that nothing blocked him from printing and sending a PDF whose contents were unsaved.

---

## 5. Scope beyond EST-2522

`stale_save_log` currently holds 22 rows. It is UNLOGGED and keyed `user|estimate`, retaining only
the latest hit per pair, so it is a **lower bound** over a short window, not a full history.

Two entries show sustained lockouts rather than a single transient conflict:

| Estimate | User | Base → Cur | Hits | Span | Work lost? |
|---|---|---|---|---|---|
| **EST-2522** | jered@ | 3 → 4 | 18 | 9 min | **Yes — 6 garments, 11 decorations, 2 art files** |
| EST-1898 | jeff@ | 15 → 20 | 8 | 203 min | No — DB (2 items / 0 decos) matches best snapshot |

The remaining 20 rows are single hits that resolved. EST-1898 was locked out for 3.4 hours without
losing content, which is luck rather than design: had Jeff added lines during that window they
would have gone the same way as Jered's.

---

## 6. The fix (implemented)

`src/lib/pollMergeRecency.js` — two pure helpers, imported by the estimate poll-merge in `App.js`:

1. **`localRowIsNewer(localTs, dbTs)`** — parses both sides to epoch ms instead of comparing strings,
   so an ISO DB value and a locale client value order correctly. `toLocaleString` round-trips through
   `Date.parse` in the tab's own timezone — the same tab that produced it — so both land on the right
   instant. If either side fails to parse, the DB row wins, so `_version` always heals.
2. **`keepLocalAdoptVersion(local, dbRow)`** — when the local copy legitimately wins on content, it now
   adopts the DB row's `_version` instead of keeping its own stale one. This is the load-bearing change:
   it breaks the deadlock even if (1) ever judges recency wrong.

`updated_at` deliberately stays the local value in (2). It is the signal (1) reads, so overwriting it
with the DB's older timestamp would make the next poll judge the local copy stale and drop the rep's
unsaved lines — trading a save deadlock for visible content loss.

**Applied to Jered's exact situation:** his local copy (13:39:18) *was* genuinely newer than the DB row
(13:29:46), so the merge keeps his seven items on screen **and** adopts version 4 — his next save
succeeds. Nothing is lost and nothing snaps back.

Covered by `src/__tests__/pollMergeRecency.test.js` (20 tests) using the real EST-2522 timestamps,
including a month-by-month table pinning where the old string compare disagreed with the truth (it is
wrong for ten months of the year — Mar–Sep wrongly favouring the local copy, Oct–Dec wrongly favouring
the DB).

### Not done, deliberately

- **Sustained-lockout visibility.** A tab whose saves have been refused N times in a row should say so
  unmissably. `dbEngine.js` only notifies on foreground saves (`if(!_bgSync…)`), so a background save
  loop can still be refused in silence. Worth doing; a separate change.
- **Standardising the 321 `toLocaleString()` writes onto ISO.** The deeper cleanup, and a large risky
  sweep. Not required to stop this bug, and the parse-based compare handles both formats.
- **The SO poll-merge** (`App.js`, `mergeSO`) does not carry this comparison and was left alone.
