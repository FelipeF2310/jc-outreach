# Controlled Ward A preload

Implemented September 18, 2026. Local implementation is not evidence that the hosted campaign exists. The operator receipt and administrator reload must confirm that separately.

## Authorized outcome

The owner requested a new **Ward A Benefits Outreach** campaign containing the separately approved, minimized Tier 1/2 candidate and ten nonoverlapping assignments, **Pair 01–Pair 10**. Volunteer names remain blank. Existing practice campaigns and deadlines are preserved. Whole unresolved households remain outside the candidate. Block/Lot/address ordering is an organizer-review draft, not verified geography or optimized routing.

Campaign end: October 18, 2026, 23:59:59 America/New_York. Identifying-data deletion: November 17 at the same local time. The event is the month-long outreach work package, using the application's 17:00 October 18 cutoff, not invented hours for tomorrow's demonstration. Review that cutoff before issuing links. The preload itself issues no links and creates no visits.

## Local import boundary

This workflow does **not** open browser CSV upload. The authorized operator reads the already-prepared candidate locally, checks its exact SHA-256 and the existing parser, and sends only allowlisted rows to Supabase through verified TLS using the restricted runtime role. The original mixed source never reaches Vercel, Supabase, preview responses or application logs. The prepared source and private idempotency plan remain external local copies requiring separate deletion under the campaign policy.

The operator authenticates a real allowlisted administrator through Supabase and freshly verifies `getUser()`. Never invent an actor UUID, borrow an existing campaign's actor, extract browser cookies, or use an owner connection to import residents. Passwords arrive over private standard input, not arguments, chat, files or source control. Failures print only fixed stages/categories.

## Deployment and execution order

1. Publish the compatible app **before** activating the database. `/api/app-version` carries the non-sensitive `X-JCO-Live-Campaigns: 1` header. Its existing JSON schema is unchanged so older field tabs can still detect updates.
2. Use the ignored, fixed-target local setup helper. It requests explicit `CREATE-WARD-A` confirmation, the database-owner password, and administrator app credentials privately. It uses `scripts/preload-live.ts`; do not send credentials in chat.
3. The operator verifies the target/release/admin and installs checksummed additive migrations 014–015. Installation does not activate the stage or import records. Existing migration files are unchanged.
4. Fresh restricted-runtime privilege and all 13 logging controls must pass. The existing exact Cron job must be active, have a successful execution in the last five minutes, have a recent worker heartbeat, and have no overdue/failing campaigns. The helper does not create a schedule or manually invoke deletion.
5. Only then does the owner connection explicitly set `outreach-live`, then close. The runtime role creates the campaign, finalizes the exact source, creates its event and all ten assignments in **one transaction**. Any failure rolls back the entire new package. Retrying the same private plan preserves IDs and actor/content-bound idempotency.
6. Verify the persisted campaign and receipt. Refresh the hosted admin workspace and select **Ward A Benefits Outreach**; existing remembered campaign selection is preserved. A fresh browser prefers a populated live campaign. No success claim until the saved receipt exists.

Activation is separate from data commit. If setup fails, share the sanitized stage and commit flags; do not reset the database or regenerate the plan. An ambiguous transaction response is resolved by retrying the identical plan with the same administrator. Once a live campaign exists, the database rejects relabeling its stage as synthetic; app rollback must use a live-compatible release.

## Data and access model

Migration 015 records `campaigns.data_kind` explicitly, defaulting existing campaigns to `synthetic`. New live campaigns have ordinary names, never a cosmetic Synthetic prefix. The same bounded authorization, membership, append-only operations, idempotency, suppression, revisions, queues, expiry and scheduled deletion apply to both kinds. The runtime gains only two named SECURITY DEFINER capabilities, not general resident-table writes. Provider roles and PUBLIC cannot call them.

Source household keys appear only in the administrator workspace for exact preload mapping, never the volunteer projection. Reviewed generic program summaries cite the official [Senior Freeze](https://www.nj.gov/treasury/taxation/ptr/), [Stay NJ](https://www.nj.gov/treasury/taxation/staynj/) and [ANCHOR](https://www.nj.gov/treasury/taxation/anchor/) pages, reviewed September 18. No eligibility thresholds, determinations or benefit promises are added.

## Evidence and limits

Local verification: production build, strict TypeScript, 106 unit tests, 19 native PostgreSQL tests and all 68 Chromium/WebKit checks pass. Tests cover a late tenth-assignment failure rolling back the whole package, concurrent identical retries, changed-plan/actor rejection, preserved practice records, minimal volunteer download, idempotent visit sync, unrelated-door denial, and live-campaign deletion without resurrection. Synthetic browser tests exercise ten pairs, phone/desktop layout and reload; the final screenshot was inspected. These are not hosted or physical-device evidence.

Database logging protection remains a bounded application-runtime finding, not a guarantee of zero provider crash/telemetry retention. General Vercel raw-upload/body/temp guarantees remain unresolved, so its CSV ingress stays closed. Existing phone happy-path evidence does not close every deployment-update, recovery or field-failure scenario. Keep the outstanding acceptance checks visible; preparing an administrator demonstration does not establish complete field-launch readiness.
