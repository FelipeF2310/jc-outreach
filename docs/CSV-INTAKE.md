# Approved CSV intake status

Infrastructure checkpoint (2026-09-17 EDT): the [upload-safety review](UPLOAD-SAFETY.md) found database logging controls that must be resolved before real-file ingress. The read-only audit is implemented; no hosted settings changed. Provider body/temp retention remains unverified, and the proposed HTTP transport bound must fit Vercel's documented payload limit rather than blindly exposing the parser's 5 MiB allowance.

The owner requested support for the actual source artifact and authorized local inspection on 2026-09-17. No resident data was uploaded or stored in the application, and the original file remains unchanged. Source-specific counts and logical record numbers are in an ignored private report; no real examples belong in fixtures or this public repository.

## Implemented compatibility

The source uses `Rationale` for the non-persisted column documented as `Match Rationale`. The validator accepts that exact alias before checking column uniqueness. Both spellings together, missing columns and unrelated unknown headers reject. The alias does not add a persisted field. Raw bytes remain the digest input, so header/content changes still require a fresh preview and confirmation.

Synthetic tests cover successful validation/finalization and discarded-field exclusion, duplicate alias/canonical columns, and whole-file rejection with zero committed rows for Tier 3, blank and malformed tiers. Existing ZIP, unit, grouping, immutable-import and rollback checks remain intact.

## Source preparation

The inspected source cannot be imported unchanged. A separate owner-approved Tier 1/2 artifact is needed, with reviewed ZIP formatting, internally consistent household counts and resolved household/unit grouping. The application must continue rejecting a mixed or malformed population as a whole; it must not silently discard disallowed rows during finalization.

The owner is deciding between a structurally valid subset with entire unresolved households held for review and a corrected complete Tier 1/2 artifact. Preparation may normalize explicitly reviewed formatting and recalculate counts, but must not guess units, split conflicting households, change identifiers or enrich from another source. Validate the exact final artifact again and show its final people/door/building totals for approval. Structural validation does not prove source provenance or address accuracy.

## Hosted path still required

The existing hosted endpoint accepts only built-in synthetic case identifiers. The new local practice-file picker does not enable a raw-file endpoint or real-data mode.

### Practice file selection — local implementation

In an unimported campaign, choose **Import synthetic households → Import source → Choose a practice CSV file**. Download a valid example or either labeled rejection example and select it unchanged. Recognition occurs in browser memory against the shared exact fixture bytes. Non-CSV, empty, oversized (64 KiB practice limit), changed or unknown files reject locally; filenames and bytes never enter requests or browser persistence. This bound is for fixed practice fixtures, not the existing validator's future 5 MiB source-file contract. Even a structurally valid variation is deliberately not an approved practice file.

The browser sends only the matched case ID to the existing authenticated endpoint. The server independently regenerates and validates the fixture, and the existing narrow finalizer remains the only persistence path. Recognizing a Tier 3 or conflicting-unit test file is not accepting it for import: server validation rejects it before approval/finalization. Changed selections clear preview and approval; delayed file reads cannot overwrite a newer selection. Unknown finalization results freeze source changes and permit identical retry. Reload clears local selection/preview, while a committed campaign receipt is restored normally.

This is a testable interaction step, not completed arbitrary CSV upload support. No actual resident artifact was read, prepared or imported during this work. No database migration, stage change, production privilege or deployment is added.

Verification (2026-09-17 EDT): production build, strict TypeScript, all 91 unit/service tests, 16 isolated native PostgreSQL tests and all 66 Chromium/WebKit browser checks pass. The valid fixture digest still matches immutable migration 004. New checks cover exact downloaded bytes, rejection without transmission, approval reset, same-source lost-ack retry, receipt reload, no browser source persistence, late/cancelled reads and sanitized failures. Existing end-to-end import/assignment/offline/sync checks remain passing. Phone-width/desktop overflow checks pass at 320/390/1280px; the final synthetic WebKit screenshot was inspected. Tests use a separate temporary build and synthetic transport/databases, not hosted file uploads or the owner's browser session. Initial runs caught an explicit-label issue and over-broad test alert selectors; both were corrected, with no skipped tests. The actual running local/hosted apps remain unchanged until separately published/restarted.

### Remaining real-file path

1. The owner confirms hosted administrator sign-in/campaign reload. Finish session/recovery/abuse checks and verify provider/app handling of request bodies, logs and temporary storage before opening raw-file ingress.
2. Implement bounded file intake with an in-memory preview, generic failure diagnostics and explicit source confirmation. Revalidate the same bytes and digest at finalization; never keep raw uploads or put resident drafts in administrator browser storage.
3. Add a narrow, transactional, actor-bound database finalizer with database-side tier/grouping/constraint checks, campaign locking and immutable/idempotent receipts. The restricted runtime must not gain general resident-table writes or arbitrary SQL. Applied migrations are immutable; changes are additive.
4. Enable real-data operation deliberately across application and database stage guards after readiness review. Do not insert residents while claiming the database is synthetic. Keep the existing synthetic workflow available for its separate test context.
5. Verify import-to-assignment-to-offline-save-to-sync with synthetic fixtures through the new path, including mixed tiers, changed-after-preview bytes, duplicate/retried finalization, unauthorized/expired campaigns and transactional rollback. Close backup/recovery, logging and both physical-phone launch checks before real resident use.

These are remaining implementation and launch tasks, not claims that the current deployment accepts the CSV.
