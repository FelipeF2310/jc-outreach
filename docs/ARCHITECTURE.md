# Engineering foundation

Status: synthetic field/import slices and administrator/database foundation implemented; hosted verification and production deployment remain incomplete. Updated 2026-09-09. Product behavior follows the reconciled [PRD](PRD.md). Earlier slice notes below are historical; the latest boundary is documented in the administrator foundation section.

## Stack selection

| Component | Selection | Reason |
| --- | --- | --- |
| Web application and server endpoints | Next.js with strict TypeScript | One deployable application for volunteer UI, administrator UI, and server-controlled access. |
| Database | Supabase PostgreSQL | Relational integrity, transactions, and inspectable campaign data. |
| Administrator identity | Supabase Auth with an explicit application allowlist | Passwordless identity support without inventing an authentication service. Provider authentication alone does not grant administrator authorization. |
| Expiration jobs | Supabase Cron | Scheduled database work and job execution records. |
| Initial hosting target | Vercel | Next.js deployment path; suitability, limits, costs, and logging must be verified before deployment. |
| Offline storage | IndexedDB plus a service worker for the application shell | Structured local transactions and offline navigation. The service worker does not itself solve data synchronization. |
| Verification | Type checking, integration tests, Playwright, physical phones | Different checks for contracts, database behavior, browser interaction, and real device storage. Exact packages follow scaffolding. |

No infrastructure accounts have been created or connected. Do not assume free-plan suitability, backup guarantees, SMTP delivery, or production log behavior. Select supported runtime/package versions during scaffolding and commit the actual lockfile.

## Browser/server boundary

The volunteer experience must boot from a cached generic application shell without requiring a server-rendered resident page. Do not cache personalized server HTML or full administrator responses in shared caches. Assignment data is downloaded through an authorized endpoint into an explicit local schema.

The browser receives only assignment-specific field data and approved program content. Volunteer credentials never grant direct database access. Server endpoints validate the credential, campaign, assignment membership, and operation before accessing records. Administrator endpoints verify both provider identity and the allowlist.

Resident tables belong in a non-public schema or an equivalently restricted database configuration. Exposed schemas require explicit grants and row-level policies. Privileged database credentials stay server-side; a privileged server connection does not remove the need for endpoint authorization. Use a least-privilege database role where practical.

The product access lifecycle is defined in PRD Sections 25–30. Token issuance/exchange, cookie handling, and enforcement need a concrete protocol before implementation. Keep raw credentials out of logs, analytics, referrers, screenshots, and cached HTML. No third-party analytics or session replay is needed for the pilot.

## Integrity contracts to settle in implementation design

- Separate a household, a visit, a revision, and an upload operation.
- Save a visit and associated reports/requests atomically on the device and server.
- Stable operation IDs make identical retries safe; changed content under the same ID is an explicit conflict.
- Enforce assignment uniqueness in the database, including simultaneous administrator requests.
- Preserve separate visits; revisions do not count as new door attempts.
- Apply PRD Section 41 to associated requests/reports: stable identifiers, preserved history and administrator-managed status, and administrator review of withdrawals. Specify transaction and revision precedence without changing those product rules.
- Treat campaign expiration as a server-side boundary even when deletion work is delayed. Reject late identifying uploads so deleted data cannot be resurrected.
- A phone's last reported queue count is not knowledge of its current offline state.

## Operational readiness

Before real-data use: verify administrator identity and authorization, secret storage, request/body logging, temporary upload handling, transaction behavior, scheduled deletion and failure visibility, and backup restoration rules. Separate synthetic development data from production data. Preview deployments must not inherit production resident access.

For physical phone testing use a consistent HTTPS origin. Record whether each test runs in Safari/Chrome or an installed home-screen context; do not assume local storage transfers between contexts. Versioned application updates and local-schema migrations must preserve pending operations.

## First-slice implementation contracts

- The local backend is PGlite 0.5.3, an actual embedded PostgreSQL engine. Integration tests use isolated in-memory databases and real transactions/constraints. The demo uses ignored `.jco-demo/` storage with one server process. Supabase connectivity, database roles, migrations and provider auth remain future work; the bootstrap SQL is not a production migration system.
- Demo endpoints require an explicit synthetic-only environment, a validated loopback host, and matching Origin when present. Administrator demo requests additionally require a custom header, preventing cross-site forms. These are development guards, not administrator identity. Vercel or a configured production database disables this harness. `npm start` without the explicit demo setting fails closed.
- Credentials are 32 random bytes, stored as SHA-256 hashes server-side. An issued link puts its credential in a fragment, not a query or path. The browser removes the fragment from history and stores its authorized credential in IndexedDB. Subsequent API requests use an Authorization header. Possession and device compromise remain risks. No analytics, remote fonts, request-body logs, or cached personalized server pages are used.
- `contracts.ts` rejects unknown operation fields and unsupported schema versions. It enforces phone permission and person-specific correction selection. The download DTO is field-by-field, excluding all matching/source identifiers.
- Every operation is immutable. JSONB structural equality distinguishes safe identical retries from same-ID/different-content conflicts. Database authorization and all visit/child/suppression writes happen in one transaction. Authorization rows are locked before checking for a prior receipt. Distinct operation/visit IDs remain independent.
- Contact-result revisions reference the original operation and expected previous operation. The original assignment must own the visit. An absent original returns a retryable dependency error; competing revisions are retained locally for review, not last-write-wins. The first UI edits only the contact result, so child identifiers and administrator-managed task states are untouched. Child-content revision/withdrawal workflows remain unimplemented.
- IndexedDB stores a complete operation envelope with its sequence and any local suppression in one strict-durability transaction. An acknowledgment is recorded separately only after the receipt ID matches. A rejected record remains stored and is not automatically retried. Concurrent retries cannot duplicate server effects; final receipt wins over local rejection status.
- The generic `/field` shell and its referenced first-party JS/CSS are cached. Readiness requires an activated controlling service worker, successful shell/asset preparation, assignment storage, and a storage read-back. Shell cache version and operation schema are both v1. Updating pending data across actual releases remains unverified; never delete the outbox to recover an update.
- Event-end uploads accept prior operations for 72 hours, capped by campaign deletion. Client clocks cannot cryptographically prove when offline work occurred; timestamps implement honest-client semantics, not trusted event timing. Revocation blocks retries even if an older operation was received. Credential recovery/reissue for unsynchronized records remains outside this slice.
- No periodic server deletion exists yet. Runtime campaign-expiration checks and best-effort browser cleanup are implemented but cannot be presented as compliance with the retention launch gate.

### Browser test boundary

Playwright documents its service-worker network controls as Chromium-only. For cross-engine offline testing, the suite uses a real loopback proxy that drops connections, explicitly verifies the API cannot be reached, and then reloads/reopens the app. Lost-acknowledgment tests await a real server commit then discard the browser receipt. Revocation tests revoke a real synthetic credential. None of these is a physical iPhone or Android airplane-mode test.

Additional primary references: [PGlite transactions](https://pglite.dev/docs/api), [IndexedDB transaction completion with idb](https://github.com/jakearchibald/idb), [Zod validation](https://zod.dev/basics), [Playwright service-worker limitations](https://playwright.dev/docs/service-workers).

## Import slice — 2026-09-08

- `import-validation.ts` parses CSV in memory with `csv-parse/sync`. Input must be valid UTF-8 (BOM accepted), at most 5 MiB, 10,000 rows, and 65,536 characters per record. Exactly the 21 documented headers must be present once each; order may vary. Retained fields have a 1,000-character cap and reject control characters. Headers are not guessed or aliased; values are strings, trimmed without numeric coercion. ZIP requires five digits, Ward A–F, and Tier exactly `1` or `2` after trimming.
- Population validation precedes any named preview. Rejected validation returns issue codes, generic messages and up to 20 CSV record numbers per issue, not source values, filenames, raw parser exceptions, preview people, or content digests. CSV record numbers are logical records including the header, not physical line numbers for multiline fields. Nothing is logged or stored by validation.
- Grouping uses case-insensitive, whitespace-collapsed addresses and units; building identity combines Property Location and ZIP. It does not geocode, expand street abbreviations, infer floors, or guess ambiguous units. Same-key contradictory addresses/units, mismatched Block-Lot-Qual keys, duplicate source IDs, different keys for one door, conflicting building wards, and clear missing-unit signals block finalization. Nonblank declared household counts are checked but never persisted; actual counts are recalculated.
- Successful validation projects the fixed 13-field persistence allowlist. Names remain in `people`; permitted reconciliation fields remain in private `import_people`, and household keys/buildings are campaign-scoped. There is no generic source JSON column or raw-upload archive. Volunteer DTOs are unchanged and never include these source records.
- Finalization accepts source bytes plus the reviewed preview digest, revalidates server-side, locks the campaign, then commits the import receipt and every building/household/person/source row together. SHA-256 of the full valid source bytes defines identical-file retry; even harmless byte changes require a new preview and cannot replace a finalized source. The per-campaign primary key and source/household uniqueness constraints back the application checks. Identical retries work after assignment creation; expired, absent, or legacy-populated campaigns reject new imports.
- The local route accepts a strict action/campaign/case-ID contract, not a file, row array or trusted `valid` flag. It constructs only known fixture CSVs in memory. Schema conformity cannot establish real-file provenance; the website owner's approved artifact and production request-body/log review remain required before implementing real upload ingress.
- A synthetic rehearsal provides empty campaign → preview → explicit confirmation → immutable import → one repeatable assignment. It is not the full campaign/event/assignment management UI. New York deletion timestamps use local wall time plus 30 calendar days in PostgreSQL, with spring/fall DST tests; there is still no deletion scheduler.
- Local startup applies immutable `002_imports.sql` transactionally and records its checksum. It adds tables and a nullable source-key column, preserving the old fixture walk, IDs, credentials and visit history. Replaying the migration is a no-op; edited applied migrations fail closed. This is exercised on PGlite, not yet on provisioned Supabase. Back up/rehearse on synthetic infrastructure before production migrations; do not use destructive reset/rollback to recover a bad migration.
- Browser tests use `JCO_EPHEMERAL_DEMO=1` to isolate automation from the organizer's persistent synthetic database. This flag does not bypass the existing synthetic-only/loopback guards.

Primary references: [CSV parser sync API](https://csv.js.org/parse/api/sync/), [CSV parser options](https://csv.js.org/parse/options/), [PostgreSQL date/time operations](https://www.postgresql.org/docs/current/functions-datetime.html).

## Administrator/database foundation — 2026-09-09

- `/admin` is a generic resident-free shell. Every personalized operation is a same-origin API request, not personalized static/SSR HTML. No browser Supabase client, admin localStorage session, token-bearing callback URL or page-render auth proxy is needed. The provider SDK's request-scoped cookie hooks can refresh and write cookies directly in route responses.
- Email OTP is the selected passwordless variant. Existing allowlisted accounts only; no self-signup. `getUser()` verifies current provider identity before checking confirmed email, anonymous status and the server allowlist. Client-provided identities, cookie user objects and the demo header are not authorization. Origin/Fetch-Metadata/custom-header checks protect mutating cookie requests; response cookies are HTTP-only, SameSite Strict, Secure on HTTPS, scoped to `/api/admin`; responses always remain private/no-store.
- Temporary identity-provider failures return an unavailable response without discarding a valid cookie. Invalid or no-longer-allowlisted identity clears the cookie. Sign-out clears local session chunks even when provider sign-out fails. Provider access-token expiry/revocation limitations and account configuration are documented in [HOSTED-SETUP.md](HOSTED-SETUP.md).
- Domain services now depend on the small `Database`/`SqlConnection` interface, implemented structurally by PGlite and by the `pg` adapter. Each real database transaction reserves one client through commit/rollback and releases it in `finally`; rollback-failed connections are destroyed. Runtime connections enforce verified TLS, bounded pool/timeouts and forbid URL parameters that could override TLS.
- No hosted schema initialization or seeding occurs during HTTP requests. Explicit empty-project bootstrap is transactional, refuses existing outreach namespaces/roles, retains the reviewed base/import schema, enables RLS and revokes public/client-facing grants. The new runtime role can only read the synthetic deployment marker and unexpired campaign metadata. Resident/credential reads, writes and DDL are denied. Hosted field/administrator write privileges are intentionally not enabled yet.
- All hosted routes require `JCO_HOSTED_STAGE=synthetic-preview`; local practice mode is separate. A database stage marker and exact restricted role are checked before returning campaigns. This is a defense against mode/configuration mistakes, not a proof of data provenance. Production/real-data access remains disabled pending launch gates.
- Local tests use the real Supabase SDK with fake HTTP provider responses, and a separately started native PostgreSQL Unix-socket cluster for driver/migration/RLS/grant checks. They do not establish actual Supabase account delivery, pooler/TLS behavior, provider project defaults, physical-device acceptance or hosted operational readiness.

Setup instructions and primary references: [HOSTED-SETUP.md](HOSTED-SETUP.md).

## Primary references

- [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Supabase data security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase passwordless administrator sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Safe retries and operation identifiers](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [Authorization on every request](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
