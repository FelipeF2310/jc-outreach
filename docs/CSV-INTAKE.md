# Approved CSV intake status

The owner requested support for the actual source artifact and authorized local inspection on 2026-09-17. No resident data was uploaded or stored in the application, and the original file remains unchanged. Source-specific counts and logical record numbers are in an ignored private report; no real examples belong in fixtures or this public repository.

## Implemented compatibility

The source uses `Rationale` for the non-persisted column documented as `Match Rationale`. The validator accepts that exact alias before checking column uniqueness. Both spellings together, missing columns and unrelated unknown headers reject. The alias does not add a persisted field. Raw bytes remain the digest input, so header/content changes still require a fresh preview and confirmation.

Synthetic tests cover successful validation/finalization and discarded-field exclusion, duplicate alias/canonical columns, and whole-file rejection with zero committed rows for Tier 3, blank and malformed tiers. Existing ZIP, unit, grouping, immutable-import and rollback checks remain intact.

## Source preparation

The inspected source cannot be imported unchanged. A separate owner-approved Tier 1/2 artifact is needed, with reviewed ZIP formatting, internally consistent household counts and resolved household/unit grouping. The application must continue rejecting a mixed or malformed population as a whole; it must not silently discard disallowed rows during finalization.

The owner is deciding between a structurally valid subset with entire unresolved households held for review and a corrected complete Tier 1/2 artifact. Preparation may normalize explicitly reviewed formatting and recalculate counts, but must not guess units, split conflicting households, change identifiers or enrich from another source. Validate the exact final artifact again and show its final people/door/building totals for approval. Structural validation does not prove source provenance or address accuracy.

## Hosted path still required

The existing hosted endpoint accepts only built-in synthetic case identifiers. No upload UI or real-data mode is enabled by this parser change.

1. Verify the administrator sign-in/session boundary on the stable HTTPS origin and the provider/app handling of request bodies, logs and temporary storage before opening raw-file ingress.
2. Implement bounded file intake with an in-memory preview, generic failure diagnostics and explicit source confirmation. Revalidate the same bytes and digest at finalization; never keep raw uploads or put resident drafts in administrator browser storage.
3. Add a narrow, transactional, actor-bound database finalizer with database-side tier/grouping/constraint checks, campaign locking and immutable/idempotent receipts. The restricted runtime must not gain general resident-table writes or arbitrary SQL. Applied migrations are immutable; changes are additive.
4. Enable real-data operation deliberately across application and database stage guards after readiness review. Do not insert residents while claiming the database is synthetic. Keep the existing synthetic workflow available for its separate test context.
5. Verify import-to-assignment-to-offline-save-to-sync with synthetic fixtures through the new path, including mixed tiers, changed-after-preview bytes, duplicate/retried finalization, unauthorized/expired campaigns and transactional rollback. Close backup/recovery, logging and both physical-phone launch checks before real resident use.

These are remaining implementation and launch tasks, not claims that the current deployment accepts the CSV.
