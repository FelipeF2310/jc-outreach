# Acceptance checklist

Status: production launch gate remains open. The synthetic field and import slices have executable tests; see [PLAN.md](PLAN.md) for dated evidence and limitations, including the 2026-09-08 import tests. The checks below remain unchecked until each complete production requirement has matching evidence; passing a synthetic subset does not approve resident-data use.

Each implementation check should record a date, tested commit/build, result, and evidence. Use only synthetic residents until all required launch checks pass.

Product baseline: [PRD.md](PRD.md), including its Section 83 launch gate. The one-time review clarifications below are requirements to test, not passing test results.

## Import and authorization

- [ ] I01: Two distinct people with one validated household key and unit create one door.
- [ ] I02: Missing, unknown, malformed, or Tier 3 input rejects the entire import without committing resident rows.
- [ ] I03: Conflicting units/addresses are reported without silently guessing a grouping.
- [ ] I04: Identifier and ZIP leading zeros survive import; duplicate source people are flagged before grouping.
- [ ] I05: An identical retry of a finalized import returns the existing result without duplicating people, households, or buildings (PRD Section 19).
- [ ] I06: The approved-artifact procedure is documented; schema validity is not claimed to prove provenance.
- [ ] I07: Validation/preview may repeat before finalization; finalization is atomic and a different file cannot replace the finalized dataset (PRD Section 19).
- [ ] I08: Only the required Section 14 persistence fields and documented application-generated metadata are persisted; recognized discarded fields are absent from storage and logs.
- [ ] A01: A volunteer cannot read or write an unrelated household by supplying its identifier.
- [ ] A02: Volunteer endpoints and local storage exclude matching fields and unrelated residents.
- [ ] A03: A provider-authenticated but non-allowlisted user cannot enter administrator endpoints.
- [ ] A04: Simultaneous assignment requests cannot intentionally assign the same household twice in one event.
- [ ] A05: Logs, traces, errors, and upload artifacts do not retain source bodies or raw access credentials.
- [ ] A06: Approved confirmed administrators can sign in with email/password, reload, refresh sessions and sign out on the actual HTTPS origin. Incorrect passwords, unconfirmed accounts and non-allowlisted identities are rejected. No signup/email-code endpoint is exposed by the app.
- [ ] A07: Passwords are absent from application storage, URLs, responses and hosting logs. Provider abuse/rate-limit controls and a secure administrator recovery process are tested before launch; recovery UI guidance alone is not sufficient.

## Campaign administration

- [x] C01: An approved administrator creates a synthetic campaign, reloads and retrieves the same saved record on the actual hosted connection. Owner confirmed on 2026-09-15 after automatic-list fix; local HTTP UI backed by live Supabase, not HTTPS deployment acceptance.
- [ ] C02: The server/database rejects invalid dates and client-supplied authority/deletion fields; end/deletion timestamps use New York calendar arithmetic across DST.
- [ ] C03: An uncertain/retried creation uses the same request ID; identical retries create one record, changed content conflicts, and direct runtime table writes remain denied.
- [ ] C04: The additive hosted migration preserves existing data and permissions, and missing migration produces an actionable setup error rather than enabling owner-level runtime access.
- [ ] C05: Existing campaign → built-in synthetic preview → explicit approval → finalization → refresh restores the receipt; hosted duplicate retry preserves four people, three households and two buildings. Migration 004 is applied and the owner reports the import flow works; remaining hosted negative/duplicate-retry evidence is still required. Local tests pass.
- [ ] C06: Imported synthetic campaign → event → selected household assignment → reload restores saved assignments; one building run respects natural unit order, scattered selection preserves manual order, and competing saves cannot duplicate a door within an event. Migration 005 and restricted runtime reads passed. On 2026-09-15 the owner confirmed one event and a two-door building run survive refresh, with both units marked already assigned. Hosted manual-order/competing-save acceptance remains open; local automated tests pass. This slice issues no volunteer links.

## Local persistence and synchronization

- [ ] C11: Explicitly confirmed selected active doors move to a newly named same-event assignment, preserving type/order and old visit history; future active assignment is unique. Identical retries return the same target, competing/changed requests conflict, and a late transaction failure moves no doors. Refreshed volunteer lists exclude moved doors without losing pending operations, including when all doors move; authorized offline visits and revisions still synchronize. Reassignment never implicitly revokes a link. Migration 010 and restricted-account checks passed on 2026-09-15. The owner confirmed the live selected-door handoff, reload persistence, four retained visits and no credential/visit mutations; full browser reload corrected the stale-code counter to 100%. Remaining live failure-path/offline/expiry and physical-phone acceptance are separate and keep this combined gate open. Local evidence is in PLAN.md.

- [ ] C10: Campaign correction review shows person/household scope, reported issue, source visit and received time. Mark reviewed / Keep open survive reload without altering imported records, suppression, visit counts or report content. Stable-ID retries preserve one audit action, competing updates conflict, and expiration rejects access. Migration 009 is applied; independent restricted-account capability/queue-read checks passed on 2026-09-15. On 2026-09-15 the owner confirmed a person-specific report, Reviewed/Open reload persistence, no additional visits from review and both original household members retained. Local evidence is in PLAN.md. The live happy path is complete; this combined gate remains open for remaining live failure-path/expiry evidence.

- [ ] C09: Application-help requests from all assignments in the selected campaign appear with household, known requester, optional consented phone and originating visit. Administrator New → In progress → Resolved updates survive reload, preserve field history and cannot silently overwrite a competing update. Lost acknowledgments retry with stable IDs, resolved requests collapse, and expiry prevents access. Local/native/browser evidence is recorded in PLAN.md; migration 008 and hosted restricted-account checks passed on 2026-09-15. The owner confirmed a live no-phone request, unspecified requester, both status changes surviving reload and resolved-list placement. The combined gate stays open for remaining live failure-path/expiry and broader payload cases; this happy path is complete.

- [ ] C08: Administrator can use one selected-campaign workspace to review import status, create/find an assignment, share its link, and inspect that assignment's received results without coaching. Synthetic browser coverage includes section layout, campaign switching/draft retention, remembered selection, results read failures, and mobile/desktop widths. Owner/administrator usability confirmation remains pending; no backend launch gates are waived.

- [ ] C07: A verified administrator issues a link for the saved hosted assignment, a volunteer downloads only its households, records/synchronizes a visit, and the administrator sees its received result. Retrying issuance never duplicates credentials; an unavailable one-time secret is explained. Explicit revocation rejects downloads/uploads while pending local work survives. On 2026-09-15 the owner confirmed the live named-link/download/local-save/sync/admin-result happy path: Unit 10B is the new visit at 5:12:48 PM EDT; Unit 2A was already received. Two received visits are accounted for. Migrations 006–007 and restricted-runtime audits passed. This combined gate remains open for the remaining live retry/revocation evidence; Ready offline is not proof of disconnected operation. Local evidence is recorded in PLAN.md.

- [ ] S01: Ready offline appears only after the shell, assignment, reference material, and local-storage verification succeed.
- [ ] S02: Failed local transaction shows failure and does not advance as if the visit was saved.
- [ ] S03: Offline visits survive reload and closing/reopening the browser on both physical phones.
- [ ] S04: Server commits an operation, acknowledgment is lost, and retry causes no duplicate side effects.
- [ ] S05: After S04, editing the visit creates an ordered revision and preserves history.
- [ ] S06: Failure creating an associated help request rolls back the operation rather than acknowledging a partial visit.
- [ ] S07: Independent visits to the same household remain separate; revisions do not inflate attempt counts.
- [ ] S08: Revocation, expiry, supersession, and campaign deletion produce their defined upload/download behavior.
- [ ] S09: Two open tabs or simultaneous sync attempts do not lose or duplicate saved operations.
- [ ] S10: An app/service-worker/local-schema update preserves unsynchronized records. Compatible-build notification and guarded explicit reload have automated coverage including pending/draft/rejection blocks, failures, late second-tab saves and retained receipts/offline reopen. On 2026-09-17 an isolated transition between separately built frontends passed in Chromium/WebKit: notice, pending-work reload block, sync, explicit reload and receipt preservation. The owner's exact older-tab missing-notice report remains unresolved; its cached bundle has not been inspected. Deployed transitions, schema migrations and both physical phones remain unverified. Old pre-detector pages require one manual refresh/reload; no automatic reload is claimed.
- [ ] S11: Interrupted/partial synchronization displays acknowledged and outstanding work accurately.
- [ ] S12: Administrator status distinguishes the last device report from unknown current offline activity.
- [ ] S15: Field work finished is stored atomically and survives offline reopen. The administrator shows Finished and synchronized only after the completion report and its declared operations arrive. New work invalidates local completion until synchronized; Resume publishes working status. Separate browsers remain separate, stale receipts/versions cannot replace newer reports, and finishing creates no attempts. Local automated evidence is recorded in PLAN.md. Hosted updates 011–012 and restricted-runtime checks passed. On 2026-09-17 the owner confirmed finish/reload/sync/admin receipt/resume with four records received, zero missing and unchanged visit totals. Physical-phone/offline and remaining hosted failure-path checks keep this combined gate open.
- [ ] S13: Permanent rejection stops automatic retry but retains pending local operations until acknowledgment or campaign expiration (PRD Section 51).
- [ ] S14: Visit revisions preserve associated request/report identifiers, history, and administrator status; withdrawals are surfaced for administrator review without silently deleting requests (PRD Section 41).

## Field outcomes

- [ ] F01: A blocked lobby creates one building-access record and zero household visits.
- [ ] F02: A help request saves without a phone number. A number cannot be persisted without recorded permission; removing it allows the underlying request to save (PRD Section 54).
- [ ] F03: A person-specific correction does not alter other household members or silently rewrite imported truth.
- [ ] F04: Do-not-contact takes effect locally, reaches other assignments when refreshed, and does not erase visit history.
- [ ] F05: No eligibility determination can be recorded; program content includes source and review date.
- [ ] F06: Required fields, tap targets, keyboard behavior, focus, contrast, and error recovery work on the phone UI.

## Expiration and deployment

- [ ] R01: Scheduled deletion removes all application-controlled identifying campaign records despite open help requests. **Live database happy path passed 2026-09-17:** owner-run helper at checkpoint 7937921 verified all 20 populated table groups removed, including open help, a successful Cron receipt and unchanged practice-record fingerprints. Independent READ ONLY check at 23:18:53 UTC confirms three active campaigns, one deletion and zero overdue/failed campaigns. This is actual scheduled fixture deletion, not a manual/no-op worker test. The broader all-copies gate remains open for device/backup boundaries and final production configuration.
- [ ] R02: Expiration immediately blocks access and late uploads, including when the deletion job fails or retries. Local tests deny expired download/upload during a forced cleanup failure and deny old uploads after deletion. The owner-run hosted rehearsal on 2026-09-17 confirmed rejected old-credential download/upload after deletion; immediate pre-deletion expiry and hosted failure-path evidence remain required.
- [ ] R03: Deletion failures are visible; a verified retry completes cleanup. Local worker failure/rollback/retry tests and administrator mocked-transport failure/stale/read-error/recovery checks exist. Runtime cannot invoke deletion. Hosted scheduled retry and failure visibility remain unverified.
- [ ] R04: The app checks the downloaded deadline on opening/resuming offline and performs best-effort local cleanup.
- [ ] R05: Backup retention/restoration cannot reactivate expired campaign access; limitations are documented. A synthetic expired-parent restore is denied and cleaned in local native PostgreSQL; provider backup window and actual restore drill remain unverified.
- [ ] R06: Privacy-safe retained totals do not preserve person, household, assignment-link, or small identifiable breakdowns. Worker health retains only a global deleted-campaign total and last-check time after successful cleanup. Hosted storage inspection remains pending.
- [ ] D01: A clean checkout installs, checks, tests, and builds using documented commands and locked dependencies.
- [ ] D02: Synthetic preview and production credentials/data are separated; server secrets do not appear in browser bundles.
- [ ] D03: Database migrations and rollback/recovery steps are documented and exercised on synthetic data.

## Physical-phone session record

The user has two phones. Record exact models, OS versions, browser versions, build/commit, HTTPS origin, and browser versus home-screen context when testing. Do not fill these with assumed values.

For each phone: download; enable airplane mode; reopen; save a no-answer visit and a help request without a number; close/reopen; confirm recovery; restore connectivity; sync; inspect server receipts; retry; test update with pending work. Also test a synthetic blocked building and partial/rejected upload. Desktop browser emulation is additional evidence, not a substitute for these sessions.
