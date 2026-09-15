# Preparation and implementation status

Updated: 2026-09-15.

## Current objective

The owner confirmed live campaign creation/reload and synthetic import use, then event/building-run assignment save/reload after migration 005. [ROADMAP.md](ROADMAP.md) records the agreed sequence and engineering commitments. Hosted private-link/download/submission/results are now implemented locally; migration 006 and the owner's live end-to-end check remain pending. Hosted manual-order/competing-save acceptance remains distinct from the confirmed building-run happy path. The 88-section [PRD](PRD.md) remains unchanged; the user has two physical phones for later acceptance.

## Prepared

- Dedicated local Git repository with agent instructions and Git exclusions. `origin` is connected to `https://github.com/FelipeF2310/jc-outreach.git` and fetched successfully. The GitHub repository is public and `origin/main` contains initial commit `0a1c17c` with a README. This milestone is being saved as a local checkpoint; nothing has been pushed. Preserve the existing remote history and user content without force-pushing.
- Engineering stack selection and boundaries, with official references.
- Synthetic record fixtures and negative-case definitions.
- Acceptance checklist separating automated checks from physical-phone evidence.
- Latest user-provided PRD saved with the authorized review corrections; repository references and related acceptance criteria aligned.

## Preparation verification

Checked on 2026-09-07 using Node: both fixture files parse; the base has 4 people, 3 household keys, 2 building addresses, and the same 21 string-valued source fields on every row. All 10 import-case definitions reference valid base rows. Local links in all 6 Markdown files resolve. Git ignore checks cover example environment files, imports, exports, database dumps, and generated CSV files.

Those were preparation checks only. At that milestone no importer, application, authorization, offline, or deletion tests had run. Current implementation evidence appears below.

PRD revision verification at the earlier documentation milestone: the saved document matched the captured user-provided text with only the seven authorized section edits listed below. All 88 numbered sections remain; 81 are unchanged, including required scope, deferred scope, and the launch gate. Local links in all 7 Markdown files resolved, stale pending-PRD notices were removed, and the PRD whitespace check passed. No application code was added during that amendment.

## First implementation slice

- Next.js 16.3.4, React, strict TypeScript 5.9, idb, Zod, PGlite, Node integration tests and Playwright. Exact dependencies and lockfile are present. Next was updated after the initial audit reported vulnerabilities; final installed-tree audit reported zero.
- Synthetic organizer console, private link issuance, assignment download, building/household/person navigation, contact outcomes, optional help/consented phone, corrections, DNC, building-access failures, local outbox, receipt states and manual sync.
- Real PostgreSQL transactions/constraints in the local test harness; stable operations, identical retries, conflict errors, scoped authorization, contact-result revisions, preserved help-request identity/status, expiration/revocation checks.
- Source formatting and a GitHub CI definition. No commits or pushes were made during implementation; the remote is unchanged.

## Verification evidence — 2026-09-07 local working tree

- Production-mode Next.js build and strict type check pass.
- 15 PostgreSQL integration tests pass: fixture hierarchy/minimization, concurrent idempotent retry, independent visits, optional phone/consent, unknown-field rejection, real child-insert rollback, contact revisions preserving task status, missing dependencies, building counts, foreign IDs, person correction/DNC, upload-only window, revocation, expiration, explicit demo guard.
- 16 browser checks pass (eight each in Chromium 153 and WebKit 26.6, mobile viewport configurations): actual disconnected-proxy reload/reopen and synchronization; lost acknowledgment after real commit; building failure counts; help without permitted phone; actual credential revocation with retained pending work; initial storage failure; minimal shell/DTO and horizontal overflow; a failed local operation write rolls back suppression, keeps the draft, and allows retry.
- Browser screenshots were visually inspected using synthetic records only. These are desktop browser-engine results, not physical-device evidence.
- Initial browser failures identified a localhost-versus-127.0.0.1 Origin comparison bug (fixed and regression-tested), ambiguous test alert selectors (fixed), and unsupported WebKit service-worker network interception. Cross-engine tests now disconnect a real loopback proxy, verify network failure, and exercise native service workers; no tests were skipped or marked expected failures.

## Still required before the field MVP / real-data launch

- Complete HTTPS sign-in/allowlist, rate-limit and secure-recovery verification. Live local-app sign-in and restricted TLS/pooler connectivity are established; those successes do not close the HTTPS deployment/abuse/recovery gates. Expanded privileges require bounded functions and corresponding hosted verification.
- Production administrator-authorized CSV upload path and provenance procedure; full campaign/event/assignment administration and supersession. The import core and synthetic rehearsal now exist, as detailed below.
- Help/correction administration, associated-content revision and withdrawal review, remaining conversation details, completion markers and full assignment lifecycle UI.
- Scheduled deletion and failure visibility, production retention integration, backup/restore safeguards, actual update-with-pending-data tests. Synthetic rehearsal deadlines now use tested New York calendar-day arithmetic.
- Approved reference content, hosting/log/upload verification, physical Safari/Chrome tests and deployment.

All remaining PRD launch gates stay required. The validated import rehearsal does not accept actual file uploads, development guards are not administrator authentication, and expiration checks are not a working deletion schedule.

## Import implementation slice — 2026-09-08

- Strict in-memory UTF-8 CSV validation: the exact 21-column source schema, Tier 1/2-only fail-closed validation, bounded input, preserved text identifiers, duplicate-person checks and household/building consistency checks.
- Explicit 13-field persistence projection. Rejected imports return generic issues and record numbers, not source values or partially accepted residents. Schema conformity is not evidence of approved provenance.
- Explicit preview confirmation followed by server revalidation and atomic finalization. Identical retries return the original receipt; a different file cannot replace a finalized import. Database constraint failure rolls back the entire import.
- Additive, checksummed import migration preserves existing synthetic assignments and visit receipts. See [ARCHITECTURE.md](ARCHITECTURE.md) for schema and migration details.
- Organizer rehearsal creates a synthetic campaign, previews fixed valid/invalid fixture cases, finalizes the import, and issues a private assignment link into the existing field flow. No arbitrary upload endpoint or file picker is exposed.
- Rehearsal history survives console reload. Browser tests use an isolated ephemeral database rather than accumulating their test records in the persistent local demo.

## Verification evidence — 2026-09-08 local working tree

- 37 server/integration tests pass (15 existing and 22 import tests). Added coverage includes all fixture rejection cases, encoding/header/record limits, leading zeros, grouping anomalies, data minimization, concurrent finalization, actual transactional rollback, changed-file rejection, imported assignment visits, raw-upload bypass rejection, DST-safe 30-calendar-day deadlines, and existing-database migration preservation/checksum protection.
- 22 browser checks pass across Chromium and WebKit. Six new checks cover the organizer import-to-field flow, rejected grouping, preview without persistence, unauthorized/bypass requests, concurrent finalization, and reload recovery. Existing offline and sync regression checks remain enabled.
- Strict type checking and production-mode Next.js build pass. Synthetic mobile screenshots were visually inspected. Automated browser-engine checks are not physical-phone evidence.
- No real resident records, production authentication, hosted deployment, or scheduled deletion were exercised. GitHub remains unchanged.

## Layout regression — 2026-09-08

Spacing follow-up (2026-09-08): the finalized-import assignment button and generated link had zero vertical separation in Chromium and WebKit. The paragraph wrapper inherited zero top margin; neither action container supplied spacing. Replaced it with a dedicated vertical action group with a 16px gap. The import browser scenario now checks separation and horizontal overflow at 320px, 390px, and 1280px widths, including wrapped button labels. This is a presentation-only change; import and credential behavior are unchanged.

## Administrator/database foundation — 2026-09-09

- Added passwordless administrator email-code UI at `/admin`, request-scoped server Supabase SDK integration, provider-verified identity and exact email allowlist. HTTP-only scoped cookies, same-origin request checks, no-store responses, session refresh, invalid-code handling and sign-out are implemented. Volunteers still use private links without accounts.
- Added a small shared SQL interface and native PostgreSQL adapter while retaining the existing PGlite practice backend. Transactions reserve one connection; runtime TLS cannot be downgraded through connection-string options.
- Added explicit, transactional EMPTY synthetic database preparation. It refuses to replace existing namespaces or adopt existing roles, enables RLS, revokes client-facing grants, and permits the runtime role only to read synthetic-stage metadata and unexpired campaigns. Hosted resident access, writes and field endpoints are not enabled yet.
- Added [HOSTED-SETUP.md](HOSTED-SETUP.md) with operator account, email-template, secret-handling, role, bootstrap and live-verification steps. No account provisioning, email delivery, hosted migration or deployment has occurred.
- Existing import-button spacing correction remains included. PRD and applied import migration are unchanged; no GitHub push or remote CI run has occurred.

Local verification: 48 server/integration tests, including 11 administrator/configuration cases, pass. Three native PostgreSQL tests pass, covering real adapter transactions/imports/visits, restricted runtime and client-role permissions, expired-row filtering and late-bootstrap rollback. Strict type checking and production-mode build pass. The 26-case Chromium/WebKit suite passes, including four new administrator checks; positive sign-in UI uses a labeled mock transport and the SDK tests use a fake provider, not a live Supabase account. Synthetic sign-in screenshots were visually inspected. These results do not approve real-data use.

## Approved password sign-in change — 2026-09-09

The owner explicitly approved replacing administrator email OTP with email/password after discovering email-template editing required custom SMTP. This does not alter volunteer private-link access or the PRD's provider/allowlist requirements. The app now uses a strict `/api/admin/sign-in` endpoint with `signInWithPassword`, followed by fresh provider identity verification. Old send-code/verify-code routes are removed. Passwords are not trimmed, logged or persisted by the app; the UI supports password managers and clears the field after attempts. HTTP-only scoped cookies, CSRF protection, refresh, logout and confirmed-email/allowlist checks remain intact.

Verification: production build, TypeScript, formatting and whitespace checks pass; 50 server/unit/integration tests, three isolated native PostgreSQL tests and all 26 Chromium/WebKit browser checks pass. Added tests cover password preservation/validation, generic denied responses, no signup/email delivery, provider identity mismatch, rate limiting/outages, password-field clearing and removed OTP routes. Synthetic mobile screenshots were visually inspected. Auth tests use fake provider/mock browser transports, not the owner's passwords. Live account sign-in, hosted deployment and physical-phone acceptance are still unverified. A tested secure recovery process is required before real-data launch. No database bootstrap, deployment, email or GitHub push occurred for this change; `.env.local` remains ignored and the PRD checksum is unchanged.

## Live sign-in confirmation and database connection preparation — 2026-09-09

The owner confirmed successful administrator sign-in and clarified that the error appeared only after loading campaigns. This is user-reported live sign-in evidence, not completion of refresh/logout/recovery or deployed HTTPS acceptance. The campaign error was reproduced locally: `DATABASE_URL` is blank. Missing database setup now returns a clear setup-incomplete message after administrator verification without clearing the valid session; unknown failures remain generic.

The owner authorized proceeding with synthetic database preparation. No connected browser or Supabase CLI is available, and no database-owner connection has been supplied, so no hosted SQL has run. Next operator step: obtain the dashboard's Session pooler connection template with its password placeholder intact. Arrange owner credentials privately outside chat/Git, verify the selected project and absent outreach namespace/reader role with read-only checks, then run the reviewed transactional bootstrap. Configure and test the separate restricted runtime credential over verified TLS; never retain the owner credential in runtime configuration. Public/API grants, actual role privileges, pooler behavior and backup/restore handling remain live verification gates.

Local verification for this follow-up: 51 server/unit/integration tests, three native PostgreSQL checks and 26 browser checks pass; build/type checking, formatting and whitespace checks pass. The added server test verifies authorization precedes setup disclosure and the session remains intact; browser tests cover the setup error and a successful retry. The local app was rebuilt and restarted. No hosted database was changed.

## Pooler certificate diagnosis — 2026-09-15

Operator reported `SSL error: certificate verify failed`. A password-free OpenSSL PostgreSQL handshake reproduced the failure using the helper's Homebrew root bundle. The root cause was the missing Supabase-specific CA, not a TCP port failure. The CA was retrieved over verified HTTPS from the URL confirmed in official Supabase dashboard source and scoped to an ignored project-local certificate file. The helper still requires full certificate/hostname verification. Correct-host TLS verification now passes. No database password was read, no hosted SQL was executed and the runtime database remains unconfigured pending owner authentication and bootstrap. See [HOSTED-SETUP.md](HOSTED-SETUP.md) for provenance and runtime CA requirements.

Verification: real `psql` now passes TLS and stops at `fe_sendauth: no password supplied` when deliberately run without credentials; an incorrect-hostname TLS probe still fails with hostname mismatch. Shell syntax validation passes. Full application tests were not rerun because only the ignored operator helper/certificate and documentation changed. The owner must retry the authenticated read-only check to verify the original end-to-end workflow.

## Authenticated database preflight and initializer handoff — 2026-09-15

The owner supplied successful `psql` output: `connected_role=postgres`, `database_name=postgres`, `outreach_exists=f`, `reader_exists=f`, followed by COMMIT. This is user-provided evidence that the authenticated read-only check passed with no outreach namespace/reader role at that time; it does not mean bootstrap has run. A leftover fragment of the earlier SSL failure preceded the successful output.

Prepared an ignored Terminal initializer with explicit PREPARE confirmation and hidden-password input, piping the password to a new bounded stdin mode on the existing bootstrap CLI. Its session-pooler template must match the configured project and it uses the verified project-local Supabase CA. No owner password is written to a file or passed in arguments/environment. Passwords containing percent signs and other URL-special characters are encoded explicitly, with regression coverage. The existing bootstrap still refuses an existing outreach namespace or conflicting reader role and rolls back failures. Reader password/runtime setup remains separate; do not report the hosted schema initialized until the owner supplies the actual initializer result.

Verification: 54 server/unit/integration tests and three native PostgreSQL tests pass; TypeScript, formatting, shell syntax and whitespace checks pass. Running the wrapper without confirmation cancels before asking for a password or connecting. Browser tests were not rerun for this operator-only change. The initializer was opened for the owner; its live result remains pending.

## Empty hosted initialization confirmed; reader handoff — 2026-09-15

The owner supplied the initializer's successful completion message: empty synthetic database prepared, separate reader password/runtime configuration still needed. Treat initialization as completed; do not run bootstrap again. This is owner-provided live evidence, not a passing runtime reader or full hosted launch test.

Prepared a separate ignored CONNECT helper using `psql`'s built-in password command with SCRAM-SHA-256 and full TLS verification. The owner enters passwords only in their own Terminal. A new reader-only configuration script verifies the restricted role, outreach privileges, RLS and the actual synthetic campaign read before filling the two blank local database settings. Existing settings, secrets and unrelated files are preserved; no owner credential is written. The script does not create/drop data, initialize the database or deploy the app. See HOSTED-SETUP for the handoff and limitations.

Verification: 57 server/unit/integration tests and four isolated native PostgreSQL tests pass, including unexpected column grants, disabled RLS, role memberships, special password characters and safe local configuration replacement. TypeScript, formatting, shell syntax and whitespace checks pass. The actual local blank-settings check passes without opening a database connection; cancelling the helper makes no changes. Browser tests were not rerun for this operator-only change. The live reader result and browser campaign smoke test remain pending. No resident data or GitHub changes are authorized by this setup step.

## Saved reader verified and local app restarted — 2026-09-15

The owner supplied the reader helper's successful output: restricted reader verified, zero active synthetic campaigns, local configuration saved. An independent read-only check using the saved runtime settings passed against Supabase, including reviewed reader privileges, RLS, synthetic marker and campaign read. No credentials were printed and no hosted data was changed.

The existing loopback Next.js process was identified by port and repository working directory, stopped gracefully and restarted with `npm start` so it loads the new settings. `/admin` returns HTTP 200; `/api/admin/campaigns` without a session returns HTTP 401 and `Cache-Control: no-store`. The owner's signed-in browser campaign request remains to be confirmed. No application code changed in this step, so full automated suites were not rerun. No schema reset, deployment, GitHub push or resident import occurred; remaining real-data launch gates are unchanged.

## Synthetic campaign creation implementation — 2026-09-15

The owner confirmed that the restarted administrator UI loaded the expected empty campaign list, completing the earlier connection smoke test. They then authorized implementing the next development slice.

Added an authenticated campaign-create endpoint/form and an additive hosted-only migration. Campaigns receive an end timestamp at 23:59:59 on the chosen New York date and deletion 30 calendar days later. The server supplies the verified administrator identity; the database supplies the synthetic prefix and retention timestamp. Existing records and nullable legacy fields are preserved. The runtime has no direct campaign writes; a dedicated non-login role executes one narrowly granted function. No owner password is stored and no reader-password rotation is needed.

Pending requests retain their ID/content in per-administrator tab session storage across uncertain responses/reloads. Replays return the saved record; changed content conflicts. The UI distinguishes date scheduling from automatic deletion, which remains unimplemented. The previous database schema continues supporting campaign list reads and returns an actionable setup error for creation until migrated.

Verification: 60 unit/server/integration tests and five native PostgreSQL tests pass. Coverage includes denied/forged administrator requests, input validation, concurrent duplicate creation, changed-content conflicts, DST arithmetic, migration replay/data preservation, no direct runtime writes or resident access, function-owner restrictions, provider-client execution denial and migration under a non-superuser owner. Type checking and production build pass. The 28-case Chromium/WebKit suite passed before a small screenshot-driven spacing correction; final layout regression results are recorded below when complete. These are synthetic local/mocked-browser checks, not live hosted creation or physical-phone evidence.

Final verification: all 28 Chromium/WebKit browser checks pass after the spacing correction, including saved-request recovery and mobile overflow/spacing checks. The final screenshot was visually inspected; build, formatting and whitespace checks pass, and the PRD checksum is unchanged. The local app is running with this build. Its unauthenticated creation endpoint was checked and rejected with HTTP 401/no-store. These tests do not replace physical-phone or live hosted creation acceptance.

Prepared an ignored UPDATE helper for the operator-only migration using the existing hidden owner-password flow. Hosted SQL has not been applied in this step; no production data, deployment or GitHub push occurred. Next: apply the reviewed additive update, verify the actual restricted connection, then have the owner create/reload a synthetic campaign.

## Failed hosted migration: read-only diagnosis — 2026-09-15

The owner reported the generic migration failure. Read-only queries using the runtime found PostgreSQL 17.6, no campaign `end_at` column, no creation function and no executor role. A second live reader/privilege/campaign check passed at 17:34:46 UTC with zero active campaigns. These observations show the update did not remain applied, not its cause.

The owner reports no ERROR/FATAL or update SQL in Postgres logs between 12:36 and 13:28 ET, only earlier bootstrap/password changes and housekeeping. This cannot rule out a later attempt or pooler/client-side rejection. The owner subsequently reset a password; its type is not yet confirmed. No secret was requested in chat.

Diagnosis awaits a reproducible error. Do not replay the migration to obtain one: reported Supabase role-grant crashes warrant caution ([Postgres 17 report](https://github.com/supabase/postgres/issues/2325), [CURRENT_USER report](https://github.com/supabase/postgres/issues/2348)). These reports do not establish that this failure was a crash. No migration SQL or permissions were changed to guess at a fix.

Added a read-only owner preflight and ignored CHECK Terminal wrapper. It tests the input/configuration/TLS path, then reads owner/permission/stage/migration-status metadata in a READ ONLY transaction. Only fixed diagnostic categories and metadata booleans/version are output; raw errors/messages/stacks are never printed. It does not load or execute the migration. Local settings validation passed without connecting; 61 unit/server tests, five native PostgreSQL tests, TypeScript and shell syntax passed. Tests cover redacted diagnostics and absence of migration side effects. Live owner preflight remains pending; the actual failure is unresolved. No app rebuild was needed for these operator-only diagnostics.

## Owner authentication recovered; migration retry prepared — 2026-09-15

The owner confirmed resetting the database-owner password through Database settings. Their read-only preflight at 17:44:07 UTC returned `owner_authentication_and_tls / password_rejected`, without executing migration SQL. At 17:47:48 UTC the same check passed authentication and verified TLS, confirmed the expected owner/role-creation/table-ownership/schema/stage metadata and reported PostgreSQL 170006 with no campaign-update receipt. The later authentication succeeds; incorrect input versus password-rotation timing was not distinguished, and the original generic update failure still has no proven SQL cause.

Reviewed the Supabase reports linked above. Issue 2348 documents explicit role names as a workaround; both reports' failing statements use the special `CURRENT_USER` role specification. Changed only the unapplied 003 membership statement to `format(... %I, current_user)` so PostgreSQL receives an explicitly quoted identifier. No applied bootstrap/002 checksum changed. This is defensive compatibility work, not a locally reproduced provider crash fix. Docker/Supabase image testing was unavailable; no crash-prone statement was replayed against the hosted database.

The migration CLI now uses the already-tested fixed diagnostic categories and records whether failure occurs during authentication/TLS or the migration transaction. It does not print raw errors, SQL, connection strings or passwords. The native test now uses a quoted, non-superuser operator identifier and all five native PostgreSQL tests pass, including replay/data preservation and privilege boundaries. All 61 unit/server tests, TypeScript, changed-file formatting, helper shell syntax and whitespace checks also pass. No browser rebuild/retest was needed for this operator-only SQL/CLI change. A controlled UPDATE retry is prepared, but has not been run; hosted migration and live campaign creation remain pending.

## Hosted campaign update confirmed — 2026-09-15

The owner supplied successful UPDATE output starting at 17:54:46 UTC: authentication/verified TLS passed and the campaign migration completed, preserving existing data and the reader password. At 17:57:12 UTC, an independent read-only check using saved runtime credentials passed the reviewed role/RLS/table/function privilege checks, confirmed the creation function exists and is executable by the restricted runtime, confirmed the new end-date column, and returned zero active synthetic campaigns. No campaign was created by this verification; no owner credential or raw database errors were printed.

The native/provider compatibility handoff is now complete for this migration. This success does not establish the cause of the original failed attempt. Do not modify migration 003 now that it is applied, rerun initialization or reset data. Next: the owner creates one practice campaign through the authenticated UI, reloads, and verifies a single saved record and the expected New York dates. Full launch gates remain open. Only status documentation changed after the live check; application tests were not rerun for these documentation edits.

## Saved campaign missing from refreshed screen — 2026-09-15

The owner created the synthetic Ward A practice campaign and confirmed intentionally choosing November 12. An independent read-only database query found exactly one matching record, ending November 12, 2026 at 23:59:59 New York time, with the correct 30-calendar-day deletion date of December 12. The owner then reported that page refresh made the campaign disappear and appeared to require re-entering the form.

Diagnosis reproduced the display behavior using the running application with synthetic browser responses: one initial list request, no new list request after refresh, and the saved entry returned only after clicking Load synthetic campaigns. Session restoration set the administrator identity but never loaded campaigns. The old browser test masked this usability bug by clicking that button after reload. Removing the click produced the expected failing assertion for the missing saved campaign.

The administrator component now fetches campaigns automatically after identity restoration/sign-in, supports an explicit refresh/retry button, shows loading/failure separately from an empty result, and cancels/ignores list responses after identity changes or superseding requests. A successful creation triggers a fresh list request so an earlier read cannot permanently hide the newly saved record. No database changes, duplicate campaign creation, credential changes or resident access were needed. C01 remains pending the owner's live refresh confirmation after restart.

Verification: the strengthened browser regression failed before the implementation change and passed afterward in Chromium and WebKit. All 28 browser tests and 61 unit/server tests pass; the production build/type check, changed-file formatting and whitespace checks pass. The verified repository server was stopped and restarted with the new build on loopback port 3000. Browser API responses in the administrator regression are synthetic mocks, not evidence of the owner's live session. The next check is simply refreshing the existing administrator page without creating another campaign.

## Saved-campaign synthetic imports — 2026-09-15

The owner confirmed the campaign now appears after refresh without re-entry, completing the live campaign save/reload smoke test, and authorized the next slice. Each saved campaign now offers built-in synthetic example preview, household grouping, explicit approval, finalization and automatic persisted-summary restoration. Error examples are labeled as intentional test failures. There is no file selector, raw CSV/row input, hosted assignment issuance or resident-file handling.

`/api/admin/import` uses the existing provider/allowlist/origin boundary before bounded body parsing/database access. The server regenerates the chosen fixture bytes and repeats the existing population/grouping validator on finalization; clients cannot supply rows, actor identity or arbitrary groupings. The verified administrator is recorded in the import receipt's server-side audit field. Invalid populations are rejected before any persistent import write.

Unapplied additive migration 004 introduces a separate non-login import executor and two narrowly granted functions. The finalizer takes campaign/digest/actor only and contains the fixed, minimized valid fixture, not an arbitrary-data or SQL argument. A per-campaign transaction advisory lock, existing uniqueness constraints and source digest preserve one immutable import on concurrent retries; all receipt/building/household/person/source inserts commit together. The status function exposes only receipt metadata for unexpired campaigns. Runtime table privileges remain unchanged; it cannot directly read residents/source tables or perform writes/DDL/role switches. Applied migrations 002/003 are unchanged. Before 004, campaign listing still works and the import button explains the missing update.

This synthetic-only SQL finalizer intentionally does not become the production upload path: future approved-file ingress must reuse the general validator/finalizer with a separately reviewed privilege design. The fixture's embedded digest/rows are pinned in immutable SQL; native tests compare actual persisted fields against the shared validator output, so fixture drift fails rather than silently importing different data. The schema contains only built-in synthetic fixture content until the user invokes finalization; the migration itself creates no campaign household records.

Verification: 63 unit/server tests, six isolated native PostgreSQL tests and 30 Chromium/WebKit browser tests pass. Coverage includes provider authorization before input/DB access, rejected source/authority inputs, Tier 3/unknown/blank/unit conflicts with zero persistence, concurrent retries, restored receipts, source-field minimization/text identifiers, coupled-household grouping, a real mid-import constraint failure with complete rollback, revoked direct runtime access, provider-client execution denial, expiration, and non-superuser migration replay. Browser administrator transport is mocked; native SQL tests use a temporary local cluster, not Supabase. Production build/typecheck and formatting pass. Physical phones and hosted 004 execution remain unverified.

Prepared ignored `private/update-imports.command`: IMPORT-UPDATE confirmation, hidden owner-password stdin, verified TLS, fixed stage/category errors, no credential logging/configuration changes, no bootstrap/reset. Next: apply that additive update once, verify the actual restricted runtime, then the owner previews/finalizes the valid example in the existing campaign and refreshes to confirm four people/three households/two buildings. This does not authorize real resident data or close remaining launch gates.

Final handoff verification: inspected synthetic mobile screenshots of preview and finalized states, increased the example selector's touch height and confirmation spacing, rebuilt successfully, and reran both Chromium/WebKit import scenarios with no horizontal overflow at 320/390px. Helper shell syntax, formatting and whitespace checks pass; PRD SHA-256 remains unchanged. The local app was restarted with the final build. Migration 004 is still unapplied; the owner must complete the separate hidden-password update before the import control is enabled.

## Hosted synthetic import update verified — 2026-09-15

The owner supplied successful import-update output starting at 18:41:39 UTC: owner authentication/verified TLS passed and the additive update completed without importing households or changing the reader password. An independent read-only runtime check at 18:42:12 UTC passed the reviewed role/RLS/privilege audit, confirmed both import functions exist and are executable, and exercised the joined campaign/status read. It returned three active synthetic campaigns, zero finalized imports, and import readiness for every listed campaign. This verification neither created campaigns nor finalized an import.

Migration 004 is now applied: do not edit it or rerun initialization. Next is the owner's explicit preview/approval/finalize/reload test on one existing practice campaign. Multiple active campaigns were observed; no duplicates were inferred or deleted. No real resident data, deployment or GitHub changes occurred. Only status documentation changed after this read-only verification, so application suites were not rerun.

## Event/assignment preparation slice — 2026-09-15

Saved the previous campaign/import milestone and owner-agreed roadmap in local commit `873cede`; no push or deployment. The next bounded slice now implements an authenticated organizer workspace over finalized synthetic imports, event creation, building/household selection, natural unit order, manually ordered scattered doors, atomic assignment save and automatic saved-summary restoration. Private volunteer links are deliberately not issued: hosted field endpoints remain the next slice.

Additive migration 005 creates an Events table and scoped assignment memberships while preserving legacy rows. Composite foreign keys guard campaign/event/household relationships; a partial unique index rejects competing active assignments for the same event/door. A dedicated non-login executor exposes only three reviewed security-definer functions to the restricted runtime. Per-save-ID advisory locks and immutable payload comparison make concurrent/ambiguous retries idempotent. Same ID/different content conflicts; different events may legitimately revisit a household. Suppressed and cross-campaign doors reject. Event form dates explicitly mean 5:00 PM New York time and cannot extend beyond the campaign; campaign retention is unchanged.

The browser keeps an uncertain save request in this tab's administrator/campaign-scoped session storage, freezes edits until acknowledgment or known rejection, and restores the same retry ID after reload. Organizer workspace responses contain addresses/units/counts, not source matching fields or private credentials. Built-in synthetic imports remain the only population. Migration 005 is not yet applied to Supabase and no hosted events/assignments were created by this implementation work.

Local verification so far: 65 unit/server tests, seven isolated native PostgreSQL tests, production build/typecheck and formatting pass. Native tests include a non-superuser migration operator, replay, concurrent identical retries and competing assignment IDs, atomic conflict rollback, foreign/suppressed doors, multi-building rejection, expired events, natural/manual ordering, direct runtime access denial and provider-client function denial. Browser checks found a WebKit native-select text overflow at 320px; bounded select text with ellipsis fixes the isolated reproduction without hiding page overflow. Final full-browser verification is recorded at handoff below. Browser administrator responses are mocks; local PostgreSQL is an isolated temporary cluster, not Supabase or physical-phone evidence.

Prepared ignored `private/update-assignments.command`: explicit ASSIGNMENT-UPDATE confirmation, hidden owner password via stdin, verified TLS, fixed-stage error reporting, no credential persistence or reset. Next required action: owner runs the additive update, followed by independent restricted-runtime verification and the live event/assignment save/reload smoke test. No real CSV needed at this step.

Final handoff: all 32 Chromium/WebKit tests pass on the final production build, alongside 65 unit/server tests and seven native PostgreSQL tests. Inspected synthetic WebKit builder/saved-summary screenshots; 320/390px no-overflow checks pass. Formatting, whitespace, helper shell syntax and ignored-private-file checks pass; PRD checksum is unchanged. The final local server was restarted on port 3000. Migration 005 remains unapplied pending the owner's hidden-password Terminal step; browser mocks do not prove hosted save/reload or physical-phone readiness. Completed source/docs/tests are being saved in a separate local checkpoint, with no push or deployment.

## Hosted assignment update verified — 2026-09-15

The owner supplied successful assignment-update output starting at 19:16:19 UTC: owner authentication/verified TLS passed and additive migration 005 completed, preserving existing data and the reader password without creating assignments or links. Independent verification at 19:18:15 UTC used only the saved restricted runtime in a READ ONLY transaction. The reviewed role/RLS/table/function privilege audit passed; all three assignment function signatures were available and executable. Campaign listing and workspace reads found three active synthetic campaigns, one finalized import, three available household doors, zero events and zero assignments. No identifiers, resident values or credentials were printed; no records/settings were changed.

Migration 005 is now applied and immutable. Implementation checkpoint is `6b80bb1`. Next: owner refreshes the existing imported campaign, creates a practice event and two-door building assignment, then reloads to verify the saved summary. C06 remains open for that live UI check and remaining assignment acceptance evidence. Hosted volunteer connectivity, real-file ingress and full launch gates remain unimplemented/unverified as documented. Only status docs changed after this read-only check; application suites were not rerun and no deployment/push occurred.

## Owner-confirmed hosted assignment save/reload — 2026-09-15

The owner confirmed **Practice Volunteer A · 2 doors · Building run** remains visible after refresh. Their **Practice Event** ends October 1, 2026 at 5:00 PM ET, before the campaign end they reported as October 12. The assignment contains the synthetic building **100 FIXTURE WALK**, Units **2A** and **10B**. The refreshed workspace shows one event and one saved assignment, and both units are labeled **Already assigned in this event**. The expected private-links-not-connected message remains visible.

This closes the live building-run creation/restoration smoke check. The visible disabled selection is not itself a hosted concurrent-request test; database uniqueness/concurrency and scattered ordering have local automated evidence, with remaining hosted acceptance recorded separately in C06. No extra assignment, migration, private link or database mutation was performed for this confirmation. Only roadmap/status documentation changed; application tests were not rerun. Next implementation slice: scoped private-link issuance/revocation and hosted assignment download/offline submission/received results.

## Hosted private-link field slice — 2026-09-15

The owner authorized connecting the saved assignment to the volunteer workflow. Implemented administrator link issuance/list/revocation and per-assignment received results; hosted bearer download/submission routes; capability-gated controls in the saved assignment; and additive migration 006. The existing field screen, structured local storage, operation contracts, reference fixture and receipt handling are reused. No hosted SQL was applied and no actual volunteer credential/visit was created during implementation.

The database runtime still has no direct resident/credential/operation table access. Two private non-login executors expose five exact functions, with fixed search paths, explicit credential/action/membership/person checks, no arbitrary SQL input and PUBLIC/provider-client execution revoked. The native privilege audit accepts only those exact reviewed signatures. Internal RLS policies for these non-login executors are permissive by design; safety depends on their private reachability and bounded function checks, not on pretending those policies provide token-level filtering. SQL security/transaction validation intentionally complements the shared TypeScript schema and must remain covered by both backend suites.

Issuance creates 32 random bytes, stores only its hash plus audit metadata, and displays the fragment-based link once. Session storage preserves only a pending action ID, never the secret. An uncertain issuance can be retried with its original ID without another credential; an already-created secret cannot be recovered, which the UI explains. Additional issuance does not revoke earlier links. Revocation is explicitly confirmed and records actor/time; it rejects pending uploads without falsely claiming to erase offline copies. Assignment locks order revocation against download/submission; operation locks and atomic transactions preserve retries, child records and revisions. Superseded memberships disappear from fresh downloads but may upload genuine pending work. Event end and the capped 72-hour window are enforced server-side. Device creation timestamps are reports, not cryptographic evidence of when a visit occurred.

Verification: 68 unit/server tests, eight isolated native PostgreSQL tests, and 34 Chromium/WebKit browser tests pass; final production build/typecheck and formatting pass. Native tests cover narrow privileges, non-superuser migration/replay, hosted/local minimized DTO parity, concurrent issuance and submissions, changed-content conflicts, wrong assignment/household/person/building IDs, actual late child-insert rollback, contact revisions preserving help status, DNC, independent visits, blocked-building counts, superseded pending work, revoke audit, upload-only expiry and campaign expiry. The browser link workflow uses a native HTTP mock transport for consistent service-worker behavior across engines, and explicitly waits for local save before closing. It simulates failure after commit with an HTTP error, verifies stable issuance retry, local recovery, sync retry, admin results, and retained work after revocation. Existing demo tests still exercise real lost acknowledgments and disconnected service-worker operation. Mocked browser tests are not evidence of live Supabase integration or physical-phone reliability.

Reviewed the masked synthetic mobile link-management screenshot and 320/390px no-overflow checks. The helper's shell syntax and ignored status pass; PRD checksum is unchanged. Prepared ignored `private/update-field.command`, requiring FIELD-UPDATE confirmation and hidden database-owner password via stdin, verified TLS and sanitized errors. It preserves existing campaigns/assignments/imports/passwords, creates no links/visits itself, and never resets or deletes data. The updated app is running locally. Next: owner applies 006, engineer verifies restricted capabilities read-only, then owner opens a private link for the existing assignment, saves/syncs a synthetic visit and verifies its received result. HTTPS/physical phones, production upload/log review, approved program content, help/correction administration, completion and scheduled deletion remain separate launch gates.

## One-time PRD revision record

Checkpoint note (2026-09-15): reviewed the accumulated campaign/import source and tests, staged only project source/docs/configuration, and scanned staged paths plus secret-key patterns. Operational files and credentials remain ignored and unstaged. The staged whitespace check reports one trailing blank line in already-applied migration 004; preserve its exact bytes/checksum rather than editing an applied migration for formatting. This exception has no SQL semantic effect. No GitHub push or deployment is included in the local checkpoint.

The user authorized the four clarifications and two editorial fixes from the latest review. Changes are confined to these sections:

- Section 14: the persistence allowlist is required, not recommended (part of the import clarification).
- Section 19: repeat validation before explicit atomic finalization; identical retry returns the existing result; different files cannot replace a finalized import.
- Section 41: associated requests/reports retain stable identifiers and history; visit revisions preserve administrator status; withdrawals require administrator review.
- Section 51: permanent rejection stops retries but does not delete pending local operations; campaign expiration still triggers cleanup.
- Section 54: persisting a phone requires recorded permission; removing an unpermitted number allows saving the underlying help request.
- Section 80: close the unmatched bold formatting on the unauthorized-household criterion.
- Section 88: describe safe retries without duplicate effects instead of exactly-once synchronization.

The user's final text now establishes CSV-only import, one finalized import per campaign, and the 72-hour upload-only window. The required/deferred scope and launch gate remain those of PRD Sections 9, 10, and 83. No further product amendments are authorized by this one-time change.

## Next implementation sequence

1. Event/building-run preparation now has an owner-confirmed hosted save/reload check. Capture remaining hosted manual-order, competing-save and import negative/retry evidence separately; the happy path does not close every launch gate.
2. Connect hosted private-link download/synchronization/results, then complete event/assignment lifecycle and supersession. Enable real approved-file ingress only after reviewing hosting payload/log handling and its expanded persistence privileges.
3. Complete help/correction management, revision review, conversation details and completion reporting.
4. Implement scheduled deletion, retry/failure visibility and backup safeguards; exercise application updates with pending offline work.
5. Review provider settings and approved reference content, deploy a synthetic preview, and run the documented physical-phone session on both phones.
6. Resolve every remaining acceptance gate before authorizing real resident data.

## Information required for production configuration

Administrator email allowlist; access to hosting/database accounts; approved program content and required languages; actual campaign/event dates; and the approved Tier 1/2 import artifact. Obtain these only when needed. Do not request credentials in chat or search unrelated local files for secrets.
