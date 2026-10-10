# Portal access audit and fixes

Administrative commission reports, overrides and compensation state are restricted to Steve by stable identity plus active admin role and an assigned Commissions or Financials section. Reps retain own-only commission rows; another admin role does not grant access to other reps' commission data.

The branch enforces assigned sections in browser navigation, mobile routes, standalone tools, server endpoints and PostgreSQL policies. These changes are prepared for review; neither database migration has been applied to production. Production retains the vulnerabilities observed during the read-only audit until rollout is complete.

| Finding | Implemented correction |
| --- | --- |
| Browser shared-password override could impersonate staff | Removed override and user picker. Staff must authenticate with their own verified account and active team profile. |
| Role defaults could override explicit assignments | Shared policy honors explicit arrays, including empty arrays and reduced admin access; unknown sections deny access. Protected identity allowlists also respect explicit removal. |
| Staff could change their own or another user's privileges | Team writes require active admin authorization plus the Team section. Role helpers derive authority from protected team records rather than editable user profiles. |
| Anonymous database access exposed invoices and other core records | Restrictive RLS guards intersect existing policies, closing anonymous core reads and anonymous writes. Public catalog/configuration exceptions are enumerated in the data matrix. |
| Staff authentication alone permitted unrelated API actions | Netlify and Edge handlers require their relevant sections; callers' active assignments are rechecked for every request. Internal service callers retain server-only credentials. |
| Standalone station/queue/payable tools bypassed section checks | Verified active profile and Production, Warehouse or QuickBooks entitlement required. Deliberate machine/share tokens remain separately scoped. |
| Mobile, deep links, search and assistant could surface excluded sections | Shared checks govern routes, search sources/results, assistant tools and record actions. |
| Shared-device or permission-change caches could retain prior access | Clear company caches when principal or assignments change. Refresh active profile on focus and periodically; server and SQL checks do not rely on the browser polling interval. |
| Coach links used predictable customer tags as access credentials | Separate authenticated coach loader. Tags only select a route; verified coach identity and explicit customer grants scope data and roster actions. Child grants do not inherit siblings. Nested internal fields are removed from coach responses. Legacy anonymous roster email endpoint is retired. |
| Privileged RPCs could bypass table RLS | Classified security-definer RPCs receive section-checking wrappers. Unclassified privileged RPCs become service-only. Existing scoped business logic remains inside private implementations. |

## Policy sources and data dependencies

`src/lib/portalAccess.json` defines sections, role defaults/caps, aliases and protected identities. The browser and server share `portalAccess.shared.js`; generated SQL is tested for parity. `portalDataAccess.json` explicitly maps table read/write dependencies, and `docs/PORTAL_SERVER_SECTIONS.json` records endpoint assignments.

Section access is not a promise that each section has an entirely disjoint set of database tables. Orders need customer/product lookups; Art, Production and Warehouse need order/job context. Those dependencies are explicit in the matrix. Staff column-level minimization and public catalog pricing privacy require a separate data-classification review; published catalog tables retain their existing public reads. Coaches receive a scoped, redacted projection instead of the staff loader.

## Validation

`node scripts/test-portal-rls.cjs` applies both actual migrations to an isolated PostgreSQL engine and checks anonymous denial, self-promotion denial, reduced admin access, own commissions, protected state keys, privileged RPC checks, immediate permission revocation, inactive accounts, coach ownership/sibling isolation and JS/SQL parity. It does not connect to production.

Jest regressions cover login, current section enforcement, coach grants, mobile/search guards, cache clearing, proxies, station workflows, AI consent and account deletion requests. The production build compiles successfully. Final validation: 7,570 Jest tests passed across 571 suites; 1,452 isolated PostgreSQL permission/parity assertions passed; the production build passed. Tests ran with America/Los_Angeles for date-only storefront business-day expectations.

## Coordinated rollout

1. Apply both migrations to staging in order: `20261010101040_app_readiness_staff_permissions.sql`, then `20261010103840_portal_section_authorization.sql`. Test against the actual staging schema and existing business policies; the isolated fixtures are not a production schema clone.
2. Confirm role defaults and individual assignments. Verify the eight staff without linked individual Auth identities can register/confirm their matching team email and sign in. No invitations were sent during this work.
3. Exercise representative users: full admin, reduced admin, rep, accounting, artist with Art/Messages only, Production, Warehouse, inactive staff, coach and anonymous storefront customer. Test allowed and denied direct API/table access, existing-session revocation and shared-device switching.
4. Exercise complete business writes, especially Art/Production saves that historically used whole-order transactions. Restrictive policies deliberately deny writes outside assigned entitlements; split such transactions into narrowly authorized operations rather than reopening full-table writes. Also test privileged RPC callers, coach roster submission/reopening, payments, exports and public storefront checkout/tracking.
5. Deploy compatible UI, Netlify and Edge functions together with migrations. Remove obsolete browser override hash configuration. Verify production policies before app distribution; keep a rollback/recovery plan that does not restore anonymous core access.

No authenticated end-to-end staging/production user matrix has been run. These changes are not a native app or an App Store submission certification. Account deletion is currently a request/queue workflow; actual deletion processing remains a separate readiness requirement.

Commission follow-up validation: 1,498 PostgreSQL permission/parity assertions passed, including denial of another admin's access to Steve's compensation settings, own-only snapshots and Steve's allowed access. Focused commission/Financials/access Jest suites and the updated production build passed.
