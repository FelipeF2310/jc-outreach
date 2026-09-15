# Delivery roadmap

Agreed with the owner on 2026-09-15. Keep this roadmap current as work proceeds; the detailed product contract remains [PRD.md](PRD.md), and test evidence belongs in [PLAN.md](PLAN.md) and [ACCEPTANCE.md](ACCEPTANCE.md).

## Current position

Administrator sign-in, restricted Supabase access, campaign creation/reload, synthetic import and event/building-run assignment save/reload are confirmed. Migrations 006–007 and restricted-runtime checks passed. On 2026-09-15 the owner confirmed named-link issuance, two-household download, a new Unit 10B visit, synchronization and administrator receipt. The two total received visits include one earlier Unit 2A visit, not two new submissions. Real CSV uploads and production resident use remain disabled; physical-phone/offline and lifecycle gates remain open.

## Next milestone

The administrator usability pass and live field-loop happy path are complete. The basic application-help queue is now implemented locally in Results & follow-up; migration 008 and live verification remain pending. Next: apply the reviewed additive update, synchronize a synthetic request without a phone, move it from New to In progress to Resolved, and reload to confirm persistence. Follow with correction review, assignment lifecycle and completion reporting. Continue remaining live negative/offline checks without conflating them with the happy-path confirmation.

Keep this workflow working throughout: an administrator selects imported household doors, assigns them to a volunteer for an event, issues a private link, and receives synchronized results.

Owner-requested addition: saved names for newly issued volunteer links are implemented; migration 007 succeeded and the independent restricted-runtime capability audit passed at 21:10:06 UTC on 2026-09-15. Named issuance and use are owner-confirmed; explicit label persistence across browser reload remains a separate check. Preserve existing unnamed links and distinguish organizer labels from verified identity. The final Household list will include approved CSV selection/upload and validation/confirmation; it remains disabled while the source-safety launch checks are open.

Deliver this in independently testable slices:

1. **Event and assignment preparation (hosted building-run save/reload confirmed):** separate events from campaigns, select imported households/buildings, order scattered doors, save an assignment, prevent duplicate active assignment in the same event, restore the organizer workspace after reload. Migration 005 and restricted runtime reads were verified on 2026-09-15. The owner subsequently confirmed one saved event and a two-door building run surviving reload, with both doors marked already assigned. Hosted manual-order and competing-save acceptance remain distinct from this happy-path confirmation.
2. **Private-link field connection (live happy path confirmed):** preserve issuance/download/save/sync/results, then finish hosted end-date, upload-only, revocation and unauthorized-access evidence. Tokens are shown at issuance only, stored server-side as hashes; no silent revocation on retry or additional issuance. Physical-phone and disconnected-browser acceptance remain required.
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
