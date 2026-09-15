# Hosted synthetic-preview setup

This is an operator handoff, not a record of completed deployment. Administrator sign-in, synthetic initialization, reader setup, campaign creation/reload, import use and event/building-run assignment save/reload are confirmed. Migrations 003–007 are applied; restricted-runtime checks passed. The owner confirmed the live named-link/download/visit/sync/results happy path on 2026-09-15, with a new Unit 10B visit received at 5:12:48 PM EDT. Two cumulative visits include an earlier Unit 2A record. Disconnected-browser, physical-phone and remaining lifecycle checks are still required. Historical procedures below are not instructions to rerun completed updates. Resident data remains prohibited until the entire [acceptance gate](ACCEPTANCE.md) passes.

## Modes and boundaries

- `npm run demo`: loopback-only PGlite practice console. Does not send email or use the hosted database. `/admin` honestly reports that hosted sign-in is not configured.
- `npm start` with `JCO_HOSTED_STAGE=synthetic-preview`: provider-authenticated administration and, after migration 006, scoped bearer-link field download/submission. Requires the configuration below. The demo endpoints remain disabled; real resident data and raw file uploads remain disabled.
- There is no enabled real-data/production mode. `production`, missing settings, and conflicting demo/hosted settings fail closed.

## Account configuration requiring the owner

Use a separate Supabase project containing only synthetic data. Confirm account/cost choices before provisioning anything. Configure settings through the provider dashboard or secret environment store, never Git or chat.

1. Pre-create the explicitly approved administrators in Supabase Auth with unique strong passwords, provided privately to their owners. Turn off public account signup. Confirm each account's email through the approved owner verification process; do not relax the app's confirmed-email requirement. The app uses `signInWithPassword`, never `signUp`, and cannot create accounts. The password is for the outreach Auth account, not necessarily the Supabase dashboard account.
2. Keep email/password authentication enabled and review provider password policy and rate limits. Ordinary password sign-in needs no sign-in email or customized template. The owner approved this change on 2026-09-09 after the dashboard required custom SMTP to edit its email template. No email-code routes remain. Wrong credentials and unapproved emails receive the same generic rejection text; this is not a constant-time account-enumeration guarantee. Exercise live login and abuse controls before launch.
3. Configure a short appropriate access-token lifetime and session settings. Refresh cookies are only accessible to server routes. Sign-out clears this browser's cookies and asks the provider to revoke this session's refresh capability; already issued access tokens may remain valid until expiry. Removing an identity from the app allowlist denies its next protected request.
4. Configure the exact public origin and Supabase URL. All authentication is handled through same-origin API requests. There is no browser Supabase client or token-bearing callback URL.

Server settings:

| Name | Value / boundary |
| --- | --- |
| `JCO_HOSTED_STAGE` | Exactly `synthetic-preview` |
| `JCO_APP_ORIGIN` | Exact HTTPS origin without trailing slash/path; local HTTP only on loopback outside Vercel |
| `JCO_SUPABASE_URL` | Project HTTPS `https://<ref>.supabase.co` URL |
| `JCO_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`, never a service-role/secret key |
| `JCO_ADMIN_EMAILS` | Comma-separated exact approved email addresses; no wildcard/domain rules |
| `DATABASE_URL` | Dedicated `jco_admin_reader` PostgreSQL connection, no query parameters |
| `JCO_DATABASE_CA` | Optional provider CA PEM if required; certificate verification cannot be disabled |

The current URL validator supports standard Supabase project hosts, not custom Auth domains. No environment values are sent to the browser. An HTTP-only cookie scoped to `/api/admin`, SameSite=Strict, and Secure on HTTPS holds the provider session. Each route creates a separate SDK client, validates identity through `getUser()`, checks the allowlist, and returns no-store responses including refreshed cookies. Personalized server rendering is not used, so no authentication proxy is required for page rendering.

Passwords travel only in the same-origin sign-in POST and the server-to-provider request (HTTPS except the local loopback app). The app does not log or persist passwords, place them in URLs, or return them in responses. Password-manager autocomplete is supported; the app clears its password field after each attempt. Hosting request-body capture must still be reviewed.

### Password recovery — required before launch

Self-service recovery is not implemented in this preview. The UI directs administrators to the website owner, but that message alone is not a tested recovery procedure. Before real-data launch, implement and test either a secure owner-assisted process with identity verification and session handling or a complete reset flow with verified email delivery. If choosing email resets, configure production-capable delivery and test reset links, expiration and return URLs. Vercel web hosting does not itself configure Supabase email delivery. Do not request passwords in chat or commit them.

## Empty database preparation

Current operator status (2026-09-15): empty synthetic initialization and reader configuration succeeded. Do not rerun initialization or the blank-settings helper, or reset the schema. Runtime settings are stored privately and the reader verification returned zero active campaigns. Share only a connection template with `[YOUR-PASSWORD]` unchanged in chat; enter actual owner/runtime passwords privately, outside Git. The owner connection and runtime reader connection are different credentials.

Review the provider's connection mode first. Use a direct or session connection for owner bootstrap. The runtime adapter uses unnamed parameterized queries and transactions on one checked-out client; transaction-pooler compatibility and TLS must still be verified on the actual provider. Owner credentials never belong in the deployed runtime.

After explicit operator approval, on the selected EMPTY synthetic project only:

Local operator option: the ignored `private/prepare-database.command` asks for `PREPARE` confirmation and then reads the owner password without echo. It pipes the password to `scripts/prepare-hosted.ts --synthetic-preview --password-stdin`, not into command arguments, environment variables or a saved file. The environment supplies only the placeholder connection template and CA file path. This mode validates the session-pooler template against the configured Supabase project, URL-encodes password characters, bounds input and retains verified TLS. It invokes the same transactional `prepareHosted` routine, not a separate SQL copy. It creates no reader password or runtime connection; those are a separate step. Closing/losing the terminal response requires checking database state before attempting setup again, not assuming rollback or resetting it.

1. Provide `JCO_MIGRATION_DATABASE_URL` securely in the operator process, together with `JCO_HOSTED_STAGE=synthetic-preview` and any required CA.
2. Run `npm run db:prepare:synthetic`.
3. The command takes a transaction-level advisory lock, requires that the `outreach` namespace does not already exist, applies the existing schema/import migration, creates a synthetic-stage marker and a new `jco_admin_reader` role. Existing namespace or role causes failure and rollback; this is not a reset or an existing-database upgrade tool.
4. Set that role's strong password through a secure operator/provider mechanism. No password is created or printed by the bootstrap. Configure its dedicated connection as the runtime `DATABASE_URL`, including the provider-required username suffix if using a pooler.
5. Remove the owner connection from the runtime/deployment environment. Confirm the role's effective `current_user` is `jco_admin_reader`. It may only select the deployment marker and unexpired campaign metadata. It cannot read resident/credential tables or write/alter application tables.

All outreach tables enable RLS; only the dedicated reader has SELECT policies for those two tables. Public and Supabase client-facing schema/table grants are revoked. Do not add outreach to exposed Data API schemas. Re-review grants and policies whenever adding migrations. Future administrator writes and hosted volunteer operations require explicitly scoped additional privileges and endpoint tests; do not substitute an owner/service-role connection to get around the current boundary.

If bootstrap fails, its database transaction rolls back. Check permissions and configuration privately; do not delete an existing schema, change applied migration checksums, or reset data. Existing local practice records are unaffected.

## Required hosted smoke test

### Additive campaign-creation update — prepared 2026-09-15

**Completed: the owner's UPDATE started at 17:54:46 UTC on 2026-09-15 and reported success.** An independent restricted-runtime check at 17:57:12 UTC passed the reviewed privileges/RLS and confirmed the new column and executable function, with zero active synthetic campaigns. Do not edit applied migration 003 or rerun initialization/reset. The original generic failure's cause remains unknown. The following procedure is retained as history; the next step is administrator create/reload verification, not another UPDATE.

The owner confirmed resetting the database-owner password in Database settings. Their read-only check failed with `password_rejected` at 17:44:07 UTC, then passed authentication/verified TLS and all required owner/permission/stage booleans at 17:47:48 UTC on 2026-09-15. The migration receipt remained absent. This proves the later connection works, not why the earlier password failed or that migration compatibility is established. Avoid further password resets.

Compatibility precaution made before application: migration 003 quotes the actual operator identifier in its membership grant instead of using the special `CURRENT_USER` role specification. This follows the explicit-name workaround in [Supabase issue 2348](https://github.com/supabase/postgres/issues/2348); [issue 2325](https://github.com/supabase/postgres/issues/2325) also reports a crash with the special specification on Supabase PostgreSQL 17. Neither report proves this project crashed. Local native PostgreSQL permission tests pass with a non-superuser, quoted-name migration owner. No local Supabase image was available; the subsequent operator run and independent check above now confirm successful hosted application.

Update procedure: `private/update-campaigns.command` requires UPDATE confirmation and hidden input of the **database-owner** password, not the reader password. It pipes that password to `scripts/migrate-campaigns.ts --password-stdin` with the reviewed project/CA. The CLI now emits a UTC timestamp and fixed failure stage/category without raw errors or connection details. Runtime settings are unchanged. If it fails, share only that output and stop; do not rerun the original initializer or reader-password helper.

The command runs the additive/checksummed `003_campaign_creation.sql` migration transactionally against the existing synthetic deployment. It preserves prior records and adds campaign date/creator columns, a restricted non-login executor and one creation function. The existing runtime account retains read-only table grants but gains permission to call this bounded function. It receives no role membership, general table writes, resident access or DDL. Existing migrations/bootstrap SQL are unchanged. The operator retains administration of the new executor role for later migrations.

After success, refresh `/admin`, create a practice campaign with a future end date, then reload and load campaigns. Confirm one record and its New York end/deletion timestamps. Retry an uncertain save without changing its request. Failure of an update must be investigated without resetting the database; the transaction preserves the previous schema on failure. Only the live administrator creation result remains pending for this handoff. No automated deletion, events, resident imports or deployment are introduced by this update.

### Saved-campaign synthetic import update — prepared 2026-09-15

Campaign creation and automatic list restoration are confirmed by the owner. Migration `004_synthetic_import.sql` completed in the owner's run starting at 18:41:39 UTC on 2026-09-15. Independent read-only verification at 18:42:12 UTC confirmed the restricted runtime privileges, both import functions and joined receipt/status read: three active campaigns, zero finalized imports, all ready. Do not edit applied 004 or rerun the update. The following procedure is retained as history; the next step is the owner's in-app preview/finalize/reload check.

Use ignored `private/update-imports.command`, not the initializer or reader-password helper. Type `IMPORT-UPDATE`, then enter the existing **database-owner password** privately. The CLI uses the saved project/CA template with verified TLS and passes the password only through stdin. It applies 002/003 checksum checks plus the new 004 transactionally, preserving campaigns, prior receipts, role passwords and administrator accounts. Output is a timestamp and success or fixed stage/category; never share credentials. Stop after a failure and investigate without resetting or editing migration receipts.

The update adds a non-login executor and two scoped functions: finalize only the embedded valid synthetic fixture, and read only import receipt metadata. It enables no arbitrary-row upload, general runtime table writes, direct resident reads, assignment issuance, automatic deletion or real-data mode. It does not itself import households. The embedded fixture is intentionally synthetic/minimized; it is not a second archive of a production CSV.

After success, verify the actual runtime with `verifyReader` and check the new functions. Then refresh `/admin`, use **Import synthetic households** under the existing campaign, validate the valid example, review three household doors with four people, check the approval box, and finalize. Refresh and confirm **4 people · 3 households · 2 buildings saved** without reimporting. Test invalid examples on an empty practice campaign before finalizing; they must create no receipt or people. No real files should be supplied.

### Local restricted reader handoff — 2026-09-15

The ignored `private/connect-reader.command` provides the next operator step. It first checks the owner-only `.env.local` still contains empty database placeholders. After explicit CONNECT confirmation, it connects to the reviewed project with full TLS verification, checks the synthetic marker/reader role, and uses PostgreSQL's built-in [`psql \password`](https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-META-COMMAND-PASSWORD) command with SCRAM-SHA-256 to set only `jco_admin_reader`'s password. The owner enters the existing database-owner password, then chooses and confirms a separate strong reader password. No plaintext password is placed in SQL, shell history, command arguments or logs. Administrator Auth accounts and outreach tables are not changed.

The owner then enters that same reader password once more. A bounded stdin input feeds `scripts/configure-reader.ts --password-stdin`, which builds the project-suffixed reader connection, verifies TLS and inspects role/schema/table/column/sequence privileges without probing writes against hosted data. It rejects role memberships, elevated flags, resident/credential access, outreach writes and missing RLS. It also executes the app's synthetic-stage/campaign read path. These checks cover the reviewed outreach boundary, not a comprehensive audit of every provider-owned schema or function.

Only after successful verification does the script fill `DATABASE_URL` and `JCO_DATABASE_CA` in ignored `.env.local`. Other settings remain intact. Replacement is atomic, mode 0600, refuses symlinks/non-private files or concurrent content changes, and retains no backup copy. The owner password is never saved. This configures only the local session-pooler connection, not Vercel or a production deployment. Restart the app afterward and exercise the authenticated campaign request.

If verification fails, local settings remain unchanged; the reader password may already have been set. Do not rerun initialization. Check the failure privately and retry reader configuration with the same reader password rather than assuming the database rolled back. Never print `.env.local` or include its contents in screenshots. The owner has now reported success, independently confirmed with the saved configuration; this helper should not be rerun against the populated settings.

### Verified CA requirement — 2026-09-15

The operator's pooler TLS check failed with the standard Homebrew CA bundle: OpenSSL reproduced `self-signed certificate in certificate chain` for Supabase Root 2021 CA. Obtain the Supabase CA through Database Settings → SSL configuration, not by trusting a certificate merely because the unverified database endpoint presents it. The official dashboard's [certificate URL configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) identifies the production download at `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.

That certificate was retrieved over verified HTTPS and saved locally as ignored `private/supabase-prod-ca-2021.crt`; the local password-prompt helper now references it with `sslmode=verify-full`. No system trust store was changed. The SHA-256 certificate fingerprint observed was `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid until 2031-04-26. Check official provenance/rotation before future reuse. The runtime driver must also receive the reviewed PEM through `JCO_DATABASE_CA` when configured; fixing the operator helper alone does not configure the app's database. Never use `rejectUnauthorized: false`, downgrade to `sslmode=require`, or trust an arbitrary presented root to bypass this failure.

### Remaining checks

- Unauthenticated and authenticated-but-not-allowlisted requests cannot reach campaign queries.
- Wrong-password rejection, confirmed-account sign-in, cookie renewal, reload and sign-out work on the actual HTTPS origin. Unconfirmed accounts remain denied.
- Password rate limits and the approved recovery process are tested. Verify delivery separately if recovery uses email.
- No access/refresh tokens in URLs, browser localStorage, JSON responses, analytics or logs; auth responses are not cached.
- Verify the dedicated runtime role cannot directly select residents or credentials, write tables, or retrieve expired campaigns. Reviewed security-definer functions are its only expanded creation/import/assignment capabilities; do not describe the role as entirely read-only.
- Remove an approved email from the allowlist and verify next-request denial.
- Confirm Supabase API exposure, authentication rate limits, TLS/pooler, request logging (including password bodies), backups, costs and project environment isolation.

Passing local mock-provider tests does not satisfy these hosted checks. Scheduled deletion, real-file ingress, full administration, hosted volunteer endpoints and physical phones remain future work.

## Local evidence and reproduction

### Additive hosted field update 006

Status: applied in the owner's run starting 2026-09-15 at 20:04:57 UTC, independently verified read-only at 20:07:56 UTC. Applied 002–006 are immutable. The ignored `private/update-field.command` prompts for **FIELD-UPDATE** and the existing database-owner password through hidden stdin, then runs `scripts/migrate-field.ts` with verified TLS and fixed, sanitized failure categories. This completed procedure is retained for reference, not a request to rerun it. It changes neither application credentials nor saved configuration. It adds credential lifecycle metadata and five bounded runtime functions through two non-login executors, with internal helpers inaccessible to the runtime/provider clients. It creates no links or visits and does not reset, import or delete anything.

After owner-confirmed success, verify the runtime audit/function capabilities read-only. In the administrator workspace, select the existing campaign and open **Volunteer links** on its saved assignment. Generate a private link and copy it while visible; only its hash is stored on the server. Open the volunteer assignment, download, save a synthetic visit, reload and synchronize. Back in administration, use **View results** on that assignment, then **Refresh results** in the separate Results & follow-up section. Never paste a private link into chat or commit it. A localhost link is for this computer only; other phones require the later HTTPS preview.

Lost issuance acknowledgment: retry uses the same credential ID and creates no second link. Since the raw secret is not retained, a retry of an already-committed issuance returns an explanation rather than inventing a recoverable token. Administrators may issue another link and separately revoke an unneeded one; issuance never implicitly revokes existing access. Explicit revocation requires confirmation because it blocks even previously saved uploads. Reconnection cannot remotely erase a browser that remains offline. Live revocation, expiry, HTTPS/logging and physical-phone gates remain required.

### Additive link-label update 007 — applied and capability verified

The owner reported successful LABEL-UPDATE on 2026-09-15, with verified TLS and preserved links, assignments, visits and passwords. Independent verification at 21:10:06 UTC used a READ ONLY transaction and the saved restricted runtime: the reviewed privilege audit passed, three active synthetic campaigns remained, and the new five-argument issuance function existed and was executable. This confirms setup, not a completed named issuance/visit/sync test. Migrations 002–007 are now applied and immutable. Do not rerun initialization or this update; the procedure below is historical reference.

The ignored `private/update-link-labels.command` requires **LABEL-UPDATE**, then the existing hidden database-owner password (not the reader password). It runs `scripts/migrate-field.ts --password-stdin --link-labels`, checks the synthetic marker and prior migration checksums, and applies 007 under the existing migration lock in one transaction. Verified TLS and sanitized stage/category output remain required. No passwords, existing link tokens, visit records or assignments change; no links are issued/revoked and no database reset is performed.

After successful operator output, independently verify the restricted runtime audit and the new `outreach.issue_field_credential(uuid,uuid,text,uuid,text)` capability. Refresh **Volunteer links**, enter a practice volunteer/link name, generate once, then refresh and confirm the saved label remains. Do not share the private URL in chat. Old unnamed links still work; this update does not silently rename them. Real CSV uploads and all outstanding launch gates remain unchanged.

### Resident correction review update 009 — prepared, not applied

After local test verification, use the ignored `private/update-correction-queue.command`. Confirm **CORRECTION-UPDATE**, then enter the existing database-owner password through hidden stdin, never in chat. The verified-TLS operator checks immutable prior migrations and applies additive 009 transactionally. Existing campaigns, credentials, visits, reports and passwords are preserved; no reports are created and none are marked reviewed. Do not initialize or reset the database.

After successful output, independently check the restricted-runtime audit and `outreach.correction_queue(uuid)` / `outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid)` capabilities read-only. In a synthetic multi-person household, record Person moved for one listed person, save and synchronize. Review it under Results & follow-up → Resident corrections, mark reviewed and reload; expand Reviewed reports, Keep open, and reload again. The other household members, source records and visit totals must remain unchanged by administrator review. Hosted execution and this walkthrough remain pending.

### Application-help queue update 008 — applied, live happy path confirmed

The owner's run starting 2026-09-15 at 21:41:41 UTC succeeded. Independent read-only verification at 21:43:09 UTC passed the restricted-runtime audit, both function capability checks and actual queue reads across all three active synthetic campaigns; zero help requests existed at that time. The owner subsequently confirmed a new synthetic request without a phone, synchronization, both status changes surviving reload, and placement under Resolved requests. Do not rerun the completed migration. The operator procedure and walkthrough below are retained for reference, not a request to repeat completed work. Remaining failure-path and production launch checks are separate.

Use the ignored `private/update-help-queue.command`, requiring **HELP-UPDATE** and the existing hidden database-owner password (not the reader password). The CLI verifies the selected project/CA, synthetic stage and immutable prior migrations, then applies 008 in one transaction. It preserves campaigns, credentials, visits, help requests and passwords. It adds status/version history support and two narrowly granted administrator functions; the migration creates no help requests and changes no existing status. Do not initialize or reset the database.

After successful output, verify the restricted-runtime audit and both new function capabilities read-only. In the existing volunteer assignment, record a synthetic conversation with Wants application help and no phone, then synchronize. In administration, open Results & follow-up → Application help, refresh, confirm its household/source visit, mark In progress, reload, then resolve and verify it appears under Resolved requests. This does not close physical-device/production retention gates. Until the update, the queue explicitly says its database update is needed, without affecting link/visit workflows.

### Additive event/assignment update 005

Status: applied in the owner's run starting 2026-09-15 at 19:16:19 UTC. Independent read-only verification at 19:18:15 UTC passed the restricted runtime audit, all three assignment-function capability checks and actual workspace reads: three active campaigns, one finalized import, three household doors, zero events/assignments at that time. The owner subsequently confirmed one event and one two-door building assignment survive refresh, with both units marked already assigned. Migrations 003, 004 and 005 are applied and must not be edited or rerun as initialization; the operator procedure and smoke-test instructions are retained for reference, not a request to repeat completed work.

The ignored `private/update-assignments.command` prompts for `ASSIGNMENT-UPDATE` and the existing **database-owner** password through hidden stdin. It runs `scripts/migrate-assignments.ts` with the verified CA and explicitly validated project/pooler configuration. It never puts the password in command arguments, source control, errors or saved application configuration. The runtime still uses its restricted reader connection.

The update is one locked/checksummed transaction: verify the synthetic deployment and earlier migrations, add Events/membership constraints and three narrowly granted functions. It preserves existing campaigns, imported households, credentials and visits. It does not create assignments, issue volunteer links, import files, run deletion or reset the database. Failure rolls back the transaction; use its fixed stage/category output for diagnosis rather than rerunning bootstrap or deleting records.

After success, independently run the restricted runtime audit and capability read without printing connection values or resident records. Refresh the existing signed-in campaign with the finalized synthetic import, open **Manage assignments**, create a practice event, select the two units in the fixture building, and save one assignment. Reload: its label and two-door count should remain. Record this as a hosted smoke check separately from the mocked browser tests. Hosted volunteer links/download/sync remain the next slice.

`npm test` runs the actual Supabase SDK with an isolated fake provider transport; verifies identity checks, exact allowlist, cookie/CSRF handling, refresh and failures. No email is sent.

`npm run test:postgres` requires PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`) or `JCO_TEST_POSTGRES_BIN`. It creates a temporary 0700 directory under `/tmp`, starts an isolated Unix-socket-only PostgreSQL process (no TCP listener), verifies real adapter transactions/imports/visits/RLS/grants, then stops it and removes only its own temporary test cluster. It never uses `DATABASE_URL` or an existing database. Run as a non-root user.

`npm run test:e2e` includes the disabled-mode admin boundary and mocked-transport sign-in UI tests in both browser engines. Mocked UI tests are explicitly not provider authentication evidence.

Primary references: [Supabase server-side clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [server-side session guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres transactions](https://node-postgres.com/features/transactions), [TLS configuration](https://node-postgres.com/features/ssl).
