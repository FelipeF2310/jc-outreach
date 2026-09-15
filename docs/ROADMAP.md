# Delivery roadmap

Agreed with the owner on 2026-09-15. Keep this roadmap current as work proceeds; the detailed product contract remains [PRD.md](PRD.md), and test evidence belongs in [PLAN.md](PLAN.md) and [ACCEPTANCE.md](ACCEPTANCE.md).

## Current position

Administrator sign-in, restricted Supabase access, campaign creation/reload and synthetic household import are working. The owner reported successful import use after migration 004. Local field/offline/sync behavior has automated tests; the hosted administrator-to-volunteer field loop is not connected yet. Real CSV uploads and production resident use remain disabled.

## Next milestone

An administrator selects three imported household doors, assigns them to a volunteer for an event, issues one private link, and receives that volunteer's synchronized results.

Deliver this in independently testable slices:

1. **Event and assignment preparation (implemented locally; hosted update/check pending):** separate events from campaigns, select imported households/buildings, order scattered doors, save an assignment, prevent duplicate active assignment in the same event, restore the organizer workspace after reload. Migration 005 enables this synthetic-only slice; it creates no assignments or links by itself.
2. **Private-link field connection:** issue/revoke scoped credentials; connect the existing volunteer download/offline/sync workflow to hosted storage with narrow privileges. Test end dates, the upload-only window and unauthorized household access. Do not issue a working-looking hosted link before its field endpoints exist.
3. **Organizer operations:** received results, application-help and correction queues, suppression, reassignment/supersession, revisions and completion reporting. Retain legitimate offline work and distinguish last-known status from current unknown device state.
4. **Launch safeguards:** scheduled deletion and failure handling; backup restoration/expiry; administrator recovery/rate limits; app-update preservation of pending work; HTTPS hosting and production log/body review; reviewed program content; both physical phones.
5. **Approved CSV intake:** review headers and a small de-identified representative sample first. Enable actual approved Tier 1/2 ingress only after its authorization, provenance, logging/temp-storage and persistence controls pass. Never request/import Tier 3, renter-exclusion files or voter-file enrichment.

Real CSV design/review may proceed alongside later slices when it reduces risk, but possession of a file is not authorization to load it. No resident data until the entire applicable launch gate passes.

## Engineering commitments

- Preserve one household/door, minimum volunteer payloads, local-save-before-success, atomic server operations and idempotent retries.
- Keep demo and hosted boundaries explicit. Reuse domain contracts/services where practical; do not grow two drifting products. The fixed-fixture hosted importer is a synthetic adapter, not the real-file importer.
- Review and checkpoint completed work in local Git; scan staged content for secrets and operational files. Do not push private data or deploy automatically. Applied SQL migrations remain immutable.
- Update current-status summaries when the owner confirms a milestone; label historical evidence and distinguish local/mocked tests from hosted/physical-phone checks.
- Include loading, empty, failed, saved and restored states in UX acceptance. A technically stored record must also visibly survive reload.
- Close each slice with tests, documented limitations and one clear operator/user handoff. Do not describe scheduled deletion as functioning until a deletion job actually executes.

## Not in this MVP

Maps/optimization, volunteer self-claim, location tracking, eligibility decisions, native apps, enrichment and permanent resident profiles. Volunteers remain private-link-only; administrators choose assignments.
