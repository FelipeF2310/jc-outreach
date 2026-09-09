# Hosted synthetic-preview setup

This is an operator handoff, not a record of completed deployment. No Supabase project, SMTP account, real administrator identity or hosted database has been connected. Resident data remains prohibited until the entire [acceptance gate](ACCEPTANCE.md) passes.

## Modes and boundaries

- `npm run demo`: loopback-only PGlite practice console. Does not send email or use the hosted database. `/admin` honestly reports that hosted sign-in is not configured.
- `npm start` with `JCO_HOSTED_STAGE=synthetic-preview`: generic administrator sign-in shell and protected, read-only hosted campaign list. Requires the configuration below. The practice endpoints and volunteer hosted backend are not enabled in this mode yet.
- There is no enabled real-data/production mode. `production`, missing settings, and conflicting demo/hosted settings fail closed.

## Account configuration requiring the owner

Use a separate Supabase project containing only synthetic data. Confirm account/cost choices before provisioning anything. Configure settings through the provider dashboard or secret environment store, never Git or chat.

1. Pre-create the explicitly approved administrators in Supabase Auth. Turn off public account signup. The app requests sign-in with `shouldCreateUser: false` and cannot create accounts.
2. Set the **Magic Link** email template to show the six-digit `{{ .Token }}` code rather than a sign-in URL. Configure OTP length to six digits, expiry, provider rate limits and production-capable SMTP. Exercise delivery and rate limiting with an approved test identity. The app intentionally gives the same delivery message for missing, unapproved and provider-rejected accounts; that message is not delivery evidence.
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

## Empty database preparation

Review the provider's connection mode first. Use a direct or session connection for owner bootstrap. The runtime adapter uses unnamed parameterized queries and transactions on one checked-out client; transaction-pooler compatibility and TLS must still be verified on the actual provider. Owner credentials never belong in the deployed runtime.

After explicit operator approval, on the selected EMPTY synthetic project only:

1. Provide `JCO_MIGRATION_DATABASE_URL` securely in the operator process, together with `JCO_HOSTED_STAGE=synthetic-preview` and any required CA.
2. Run `npm run db:prepare:synthetic`.
3. The command takes a transaction-level advisory lock, requires that the `outreach` namespace does not already exist, applies the existing schema/import migration, creates a synthetic-stage marker and a new `jco_admin_reader` role. Existing namespace or role causes failure and rollback; this is not a reset or an existing-database upgrade tool.
4. Set that role's strong password through a secure operator/provider mechanism. No password is created or printed by the bootstrap. Configure its dedicated connection as the runtime `DATABASE_URL`, including the provider-required username suffix if using a pooler.
5. Remove the owner connection from the runtime/deployment environment. Confirm the role's effective `current_user` is `jco_admin_reader`. It may only select the deployment marker and unexpired campaign metadata. It cannot read resident/credential tables or write/alter application tables.

All outreach tables enable RLS; only the dedicated reader has SELECT policies for those two tables. Public and Supabase client-facing schema/table grants are revoked. Do not add outreach to exposed Data API schemas. Re-review grants and policies whenever adding migrations. Future administrator writes and hosted volunteer operations require explicitly scoped additional privileges and endpoint tests; do not substitute an owner/service-role connection to get around the current boundary.

If bootstrap fails, its database transaction rolls back. Check permissions and configuration privately; do not delete an existing schema, change applied migration checksums, or reset data. Existing local practice records are unaffected.

## Required hosted smoke test

- Unauthenticated and authenticated-but-not-allowlisted requests cannot reach campaign queries.
- Email delivery, invalid/expired code, successful sign-in, cookie renewal, reload and sign-out work on the actual HTTPS origin.
- No access/refresh tokens in URLs, browser localStorage, JSON responses, analytics or logs; auth responses are not cached.
- Verify the dedicated runtime role cannot select residents or credentials, write any data, or retrieve expired campaigns directly.
- Remove an approved email from the allowlist and verify next-request denial.
- Confirm Supabase API exposure, SMTP/rate limits, TLS/pooler, request logging, backups, costs and project environment isolation.

Passing local mock-provider tests does not satisfy these hosted checks. Scheduled deletion, real-file ingress, full administration, hosted volunteer endpoints and physical phones remain future work.

## Local evidence and reproduction

`npm test` runs the actual Supabase SDK with an isolated fake provider transport; verifies identity checks, exact allowlist, cookie/CSRF handling, refresh and failures. No email is sent.

`npm run test:postgres` requires PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`) or `JCO_TEST_POSTGRES_BIN`. It creates a temporary 0700 directory under `/tmp`, starts an isolated Unix-socket-only PostgreSQL process (no TCP listener), verifies real adapter transactions/imports/visits/RLS/grants, then stops it and removes only its own temporary test cluster. It never uses `DATABASE_URL` or an existing database. Run as a non-root user.

`npm run test:e2e` includes the disabled-mode admin boundary and mocked-transport sign-in UI tests in both browser engines. Mocked UI tests are explicitly not provider authentication evidence.

Primary references: [Supabase server-side clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email codes](https://supabase.com/docs/guides/auth/auth-email-passwordless), [server-side session guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres transactions](https://node-postgres.com/features/transactions), [TLS configuration](https://node-postgres.com/features/ssl).
