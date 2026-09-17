# Backup and recovery safety

Updated 2026-09-17. This is a recovery runbook and evidence inventory, **not authorization to restore or change the hosted project**. Resident-data use remains blocked by [ACCEPTANCE.md](ACCEPTANCE.md). Do not reset the database or re-run initialization.

## What is verified

- Hosted scheduled cleanup: owner-run disposable rehearsal removed all 20 populated campaign/child table groups, including open help. Its old credential was rejected and other records/deadlines were unchanged. Independent restricted read-only verification showed three active campaigns, one deletion and zero overdue/failed campaigns.
- Local archive recovery: `npm run test:postgres` now makes an actual custom-format `pg_dump` archive of the synthetic outreach schema and restores it with `pg_restore --single-transaction --exit-on-error` into a different database in a private temporary Unix-socket cluster. It never reads the configured hosted connection or uses Supabase data.
- Restore checks compare all 20 table groups and migration checksums; verify original deadlines, RLS/function ownership/runtime restrictions/provider denial; and reject expired downloads/uploads before cleanup. Direct runtime connections to the restore target remain blocked. A target-only late delete failure rolls back the full cascade, reports a failure without raw details, and still denies expired access. Retry removes expired descendants, preserves other records and leaves the source unchanged. A repeated cleanup is harmless.
- Temporary test archives/databases are removed with the test cluster. No real backup was downloaded, no hosted restore was performed, no paid plan/add-on was enabled, and no live fault was injected.

Limits: the archive includes only the application schema; test roles already exist in the same isolated cluster. It does not prove recovery of provider Auth, role passwords, platform settings, Storage files, a whole cluster or Supabase physical/PITR backups. The test captures expired records awaiting cleanup; it does not change clocks or deadlines on restore. Its worker calls are explicit local test calls, not scheduled retry evidence. Restored external jobs are deliberately absent.

## Provider facts versus project facts

Official documentation reviewed 2026-09-17:

- Supabase documents daily backups for paid plans, with seven days available on Pro, fourteen on Team and up to thirty on Enterprise. Free-plan guidance recommends separate exports/backups. This does **not** establish the absence of internal provider copies. Custom-role passwords need attention after restore; database backups exclude Storage object files. [Database backups](https://supabase.com/docs/guides/platform/backups).
- Free projects can pause for inactivity. The documented paused-project restore window is up to one year; paid projects are not auto-paused for inactivity. A paused database must not be assumed to execute campaign cleanup. Do not assume our Cron activity prevents pausing. [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
- Physical “Restore to a New Project” can start copied Cron/network jobs immediately. It has paid-plan prerequisites and additional costs. Use an isolated logical restore when jobs must be inspected before running; do not assume cloning is inert. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
- PostgreSQL archives preserve database objects, but roles are cluster-wide and require separate provisioning. Restores execute trusted archive content; only reviewed, trusted backups may be restored. [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

The connected application database role cannot establish account billing, backup availability or provider erasure windows. A historical Free badge is not current verification. A Supabase integration was discovered but is not connected; a redacted dashboard screenshot is an acceptable read-only verification path.

| Project-specific evidence | Status |
| --- | --- |
| Current organization/project plan | Awaiting dashboard confirmation |
| Database → Backups status and available restore points | Awaiting dashboard confirmation |
| Daily backup/PITR enabled state and configured window | Unverified; do not assume enabled |
| Pausing policy applicable to this project | Unverified; must resolve before launch |
| Other copies: exports, dumps, storage, logs, support/paused-project backups | Inventory and actual lifetimes unverified |
| Backup owner, access controls, encryption, automatic expiry | Not approved/configured |
| Acceptable data-loss window and recovery time | Must be established before selecting recovery policy |
| Actual provider restore drill and post-restore scheduler verification | Not performed |

To supply the first evidence, open the project's **Database → Backups** page and report the plan, available backups/restore-point dates or upgrade notice. Do not click Restore, enable an add-on, download resident data or share credentials. Do not infer a retention period from a single visible backup date.

## Production backup decision

Free synthetic development can continue while these gates remain open. For real outreach, prefer an always-on configuration with a supported, tested backup path; any paid-plan selection needs owner approval. Do not introduce an unmanaged resident-data dump as an automatic workaround.

The approved policy must identify who can restore, how much recent work might be lost, where every backup lives, and when all backup copies expire. A live-record deletion at campaign end plus 30 days is separate from aging those records out of earlier immutable backups. Record the actual additional window and obtain the operational owner's approval; do not promise instantaneous erasure from backups. “No accessible backups on Free” is neither a recoverability guarantee nor proof of no retained provider copy.

## Restore procedure — keep the target quarantined

1. **Authorize an incident-specific plan.** Name the source snapshot and exact new target, record versions/checksums and scope, estimate data loss and downtime, and obtain approval for any new project/cost. Never restore over the practice/live project as a test. Preserve evidence without creating unnecessary copies.
2. **Isolate before restore.** No deployed app points at the target. Block application/provider/public access and outbound integrations using supported controls. Inventory Cron, webhooks, extensions and secrets before enabling any copied jobs. A physical clone cannot be assumed to provide a pre-job inspection window; use a reviewed logical path if isolation requires it.
3. **Restore trusted data and reviewed security definitions.** Retain original campaign deadlines and identifiers, ownership, RLS, constraints and restricted grants. Provision necessary custom roles separately with private credentials; never reuse an owner credential as the runtime. Inspect failures rather than using `--no-acl`, `--no-owner`, disabled triggers, broadened privileges or ignored errors to force success. Do not import old schema definitions blindly over newer safeguards.
4. **Reconcile security changes newer than the backup.** Expiration is not the only hazard: a backup may restore a revoked link, a removed administrator or missing do-not-contact requests. Keep the target closed. Invalidate restored volunteer credentials before reissuing access, confirm the current administrator allowlist/sessions, and reconcile suppression and post-snapshot work using an approved source. If that information is unavailable, do not restart affected outreach. Do not retrieve voter-file enrichment or create permanent cross-campaign suppression to solve recovery.
5. **Validate expiry while still closed.** Recheck the runtime/provider permission audit, migration checksums and original deadlines. Probe expired reads/uploads and verify rejection. Run approved expired-record cleanup only on the exact quarantined recovery target, including open tasks. Any failure must leave it closed, visible and retryable; never extend dates or remove constraints to clear a backlog.
6. **Verify future operation.** Inspect/recreate the exact intended deletion job, its owner, scope and schedule without reactivating unknown copied jobs. Observe actual scheduled completion plus retention status; no heartbeat alone proves all due rows were removed. Test private-link lifecycle and administrator access using fresh synthetic records before reconnecting the app. Do not enable a schedule over unexplained overdue targets.
7. **Approve reopening and dispose of recovery copies.** Confirm all target checks and the reconciliation decision with the owner. Then switch the application to its restricted connection and monitor. Track and expire dumps, archives and abandoned restore targets under the approved policy; do not leave a second resident database behind. Backup expiry is not secure-media-erasure evidence.

This runbook does not itself implement a universal restore/revocation command or approve changing account settings. Provider-specific steps and the reissuance/reconciliation procedure must be exercised in a separately authorized synthetic recovery environment before real-data launch.

## Failure/retry safety

The isolated tests inject failures only in their own temporary restore database. Do not add failure triggers, take blocking locks, disable Cron, pause the project or alter deadlines on the hosted practice database. A hosted scheduled-retry drill needs its own reviewed isolated target and authorization. The local regression plus hosted successful cleanup are useful but distinct pieces of evidence.
