# Staff app groundwork

This branch is groundwork for a staff-first app, not an App Store-ready native application.

- Real staff login replaces the shared browser admin override. Resolve the blockers in PORTAL_ACCESS_AUDIT.md before app distribution.
- Chat AI widgets disclose Anthropic sharing and require explicit consent before sending chat messages. Endpoints reject absent/outdated consent markers; internal assistant authenticates staff and derives admin role server-side. Consent currently lasts only for the mounted widget/session. Audit other automated AI processors, persistence and logging separately.
- `/privacy.html` provides initial privacy information; verify providers, retention, contact details and actual practices before publication or store submission.
- Account > Request account deletion initiates a durable authenticated request. The Team page exposes an admin-only request queue. The migration must be applied before this feature works. No automatic account deletion or notification has been implemented.

## Deletion processing that must be completed before submission

Assign a responsible operator, publish an accurate completion timeframe and establish queue monitoring. Verify the requester against the stored Auth ID; never take another user's ID from a browser request. Inventory associated personal data, sessions, uploaded files, AI transcripts and third-party copies. Document company record/legal retention separately from personal account deletion, minimize retained identity, and explain exceptions to the requester. Process the request server-side using privileged Auth deletion only after required associated-data handling; revoke sessions and test that the deleted login cannot return. Record status `processing`, then `completed` with `completed_at` and a non-sensitive completion note only when deletion is actually finished. Do not delete company orders/invoices wholesale or mark a request complete on submission. Test failure/retry behavior and provide a contact route for a user who cannot sign in.

Choose the native shell/platform only after authorization is enforced end to end. Then implement and test device navigation, secure session storage, camera/QR permissions, deep links, push notifications if required, offline/cache behavior, accessibility, store screenshots/metadata and distribution approach. Repeat platform-specific launch checks against the native project; the original launcher scanner skipped this repository's oversized primary app/editor files and cannot certify them.
