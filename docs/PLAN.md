# Preparation and implementation status

Updated: 2026-09-08.

## Current objective

The user authorized resuming implementation. The local synthetic field loop now includes a validated CSV import rehearsal on branch `feat/field-mvp`, based on `origin/main` without altering remote history. The 88-section [PRD](PRD.md) remains the baseline; it was not modified during application implementation. The user has two physical phones available for later acceptance.

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

- Supabase production database adapter/migrations, administrator provider identity and allowlist, production security review and scoped database privileges.
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

## One-time PRD revision record

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

1. Add the production database adapter and provider-authenticated, allowlisted administrator boundary using synthetic data. Do not expose the demo guard as production authentication.
2. Connect the validated import core to that authorized upload path after reviewing hosting payload/log handling; implement campaign/event/assignment administration and lifecycle rules.
3. Complete help/correction management, revision review, conversation details and completion reporting.
4. Implement scheduled deletion, retry/failure visibility and backup safeguards; exercise application updates with pending offline work.
5. Review provider settings and approved reference content, deploy a synthetic preview, and run the documented physical-phone session on both phones.
6. Resolve every remaining acceptance gate before authorizing real resident data.

## Information required for production configuration

Administrator email allowlist; access to hosting/database accounts; approved program content and required languages; actual campaign/event dates; and the approved Tier 1/2 import artifact. Obtain these only when needed. Do not request credentials in chat or search unrelated local files for secrets.
