# AI Notes upgrades

Builds on open CRM PR #2377. Merge this change into that branch first; it is not an independent main-branch feature. Apply the base AI Notes migration before `20261008215038_meeting_notes_recovery_context.sql`. Production currently has neither migration applied. No production settings or migrations were changed during this work.

## Audio lifecycle and limits

- Browser recording requests 64 kbps compressed audio (about 29 MB/hour if honored); browsers determine the actual format and bitrate.
- Each emitted chunk is written to IndexedDB before upload. Only unacknowledged chunks remain there. Successful cloud acknowledgement removes the local copy; explicit discard clears the note's local chunks.
- Local recovery is capped at 150 MiB across this browser profile. Entries expire at 24 hours and are removed on the next recovery read or write; a closed app cannot run a physical cleanup timer. Browser storage can also be evicted by the OS, so this is recovery protection, not a backup guarantee. An interrupted final 30-second chunk may never have been emitted.
- Private cloud audio is bounded at 150 MiB/1000 objects per note by a serialized Storage trigger; each object is also capped at 20 MiB by the bucket. Uploaded files are split into 8 MiB pieces. UI recording cap remains 90 minutes.
- Cloud audio is deleted after the transcript is committed. A cleanup error remains retryable. The hourly sweep removes failed/abandoned audio older than 24 hours (normally within 24–25 hours of creation), and attempts provider-job deletion too.
- User-selected recordings already in Voice Memos/Files remain in their original location; the portal does not delete the user's source file.
- No audio playback or permanent audio archive is introduced. Transcripts, approved notes and photos remain.
- Photos are resized/re-encoded in the browser to JPEG, removing original metadata, capped at six photos/1 MiB each, in a private bucket. Read URLs require note visibility checks and expire in five minutes.

## Behavior

1. **Recovery:** reopen AI Notes and choose Recover & finish saved audio. Only the signed-in rep's folder is recovered. Salvaged recordings are visibly marked potentially incomplete; missing numbered chunks block transcription instead of creating an apparently complete note.
2. **Resumable jobs:** transcription job IDs and completed segments are stored in a service-only table. Retries poll existing jobs. A 14-minute lease prevents overlapping workers, and a scheduled continuation checks pending notes every five minutes. Completed extraction parts are checkpointed too. Provider jobs are deleted after their text is checkpointed, before final processing.
3. **Long sources:** all characters are processed in 30,000-character parts, with combined action items, garments and other structured details. No silent tail truncation. Oversized input or truncated AI output fails explicitly. Multi-part drafts show a review warning; the follow-up email comes from the final part and must be reviewed against the whole meeting.
4. **Ask this account:** read-only questions search excerpts from up to 200 recent approved notes for the account and its immediate child teams. Raw transcripts are supplied only for the owner or admins, matching existing transcript permissions; other staff can search approved notes. Exact quoted evidence, note title/date and source type accompany answers. Invalid or invented quotes are rejected. This is bounded retrieval, not an exhaustive historical audit, and a valid quote is not a mathematical guarantee that every generated claim is correct.
5. **Context:** extraction receives bounded account quotes (including `open`) and orders, garment/style/color/size references, and existing contacts. Actual live `so_items` and text IDs are used. Reference context is explicitly separated from new commitments. Conflicting matches must be flagged, never silently selected.
6. **Highlights/photos:** reps mark important moments, add timed annotations, and attach garment/business-card/whiteboard photos before finishing. Annotations autosave while recording. Photos are supplemental model inputs and appear on review and saved notes.

## Setup and validation

Keep the existing AssemblyAI/Anthropic keys and zero-retention settings from #2377. Deploy the added scheduled function (`meeting-process-resume`) and `meeting-ask`; enable the new private image bucket through the migration. Do not enable the feature before both migrations and transcription configuration are ready.

Tested with mocked provider responses and browser IndexedDB/recorder tests. The base + upgrade migrations and worker lease behavior passed a transaction that was rolled back on the connected database. An additional permission/cloud-byte-cap database check could not complete because the connector returned `Invalid or expired requestState` twice; these checks remain for deployment validation. The production build passes with increased Node heap and source maps disabled. Real AssemblyAI/Claude calls, camera capture, storage uploads and lock/app-switch behavior still require iPhone Safari and Android Chrome pilot checks.

This remains a browser recorder: continuous locked-screen recording requires a native mobile capture module or external recorder. The downstream import/review pipeline can accept uploaded audio already, so such capture can be added without replacing CRM processing.
