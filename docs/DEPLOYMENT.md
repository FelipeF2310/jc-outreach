# HTTPS synthetic phone-test deployment

## Deployed checkpoint — 2026-09-17 EDT

The synthetic site is live at **https://jc-outreach-test.vercel.app/admin**. PR #2 passed CI run `35297956157` and merged at `0a6eb25e6974c0eaaa79791cba7a4c1513d19d7e`. Authenticated Vercel metadata reports deployment `dpl_CiCeZUronf2K837PcqTGWqHHZKbU` READY, target Production, for that exact commit. The existing application stage remains `synthetic-preview`. No database initialization/migration, resident upload or billing change occurred.

Unauthenticated HTTPS checks passed: `/admin` and `/field` 200, `/api/app-version` 200 with no-store, `/sw.js` JavaScript with no-cache, `/api/admin/session` 401 with the required administrator header but no cookie, `/api/assignment` 401 without a bearer, and `/api/demo` 503. Responses retained no-referrer, nosniff and frame denial; no provider login/interstitial redirected these requests.

A fresh unauthenticated Chromium context at 390×844 confirmed the sign-in form, non-interactive field branding that stays on `/field` after a click, field/API release-marker agreement, no horizontal overflow and zero page errors. This did not sign in or create/read campaign records. The owner was asked to verify sign-in and existing campaign reload on the stable origin. Database connectivity from Vercel, session/logout behavior, both physical phones and real-data readiness remain open.

All seven runtime variables were independently verified Production-only before publication. The prior configuration record below preserves that evidence; its empty-deployment and local-only-logo statements describe the earlier checkpoint and are superseded here.

## Historical configuration handoff

Verified scope correction (2026-09-17 EDT; recorded 2026-09-18 01:59 UTC): the authenticated Vercel API confirms `jc-outreach-test` under `felipefurtado314-6006s-projects`, connected to `FelipeF2310/jc-outreach`, production branch `main`, Node 24.x. Exactly seven runtime variables exist and all are now Production-only. Owner-reported build settings remain `npm ci`, `npm run build`, repository root and default Next.js output; assigned domain is `https://jc-outreach-test.vercel.app`. The deployment list is empty.

After the owner authorized the correction and completed a fresh CLI sign-in, four sequential `PATCH /v9/projects/{project}/env/{id}` requests each sent only `{"target":["production"]}` for `DATABASE_URL`, `JCO_ADMIN_EMAILS`, `JCO_DATABASE_CA`, and `JCO_SUPABASE_PUBLISHABLE_KEY`. Fresh API reads verified each scope and the final seven-variable inventory; IDs, names, sensitive types and secret visibility were preserved. No request included a value, no decrypted value was requested or printed, and no fifth-variable probe was performed. Returned opaque value fields compared equal; that is not a decrypted-value or live-connectivity check. No deployment, Git push, database operation or billing change occurred. The existing `synthetic-preview` application stage remains required; authenticated HTTPS/TLS/save-reload and physical-phone checks are still pending.

Historical manual-transfer helper: the ignored, owner-only `private/copy-vercel-config.command` remains available but does not need rerunning for this scope correction. It validates and copies four allowlisted runtime values without exporting migration-owner credentials or printing values. Earlier synthetic rejection, shell syntax and local check-only validation passed. The owner subsequently reported all four saved with Production and Preview selected; the API correction above removes Preview without resubmitting their values.

Git integration is connected, so new branch pushes and main merges can trigger deployment. Hold `fix/volunteer-header` locally until runtime configuration and deployment authorization are ready. No Git push, billing change, database change or deployment was performed during this configuration handoff. The older preparation notes below are historical where superseded here.

Status: prepared, not deployed. The owner authorized moving to HTTPS and phone testing on 2026-09-17 and signs into Vercel using GitHub. Owner-reported account: `felipefurtado314-6006`, Hobby plan. Existing project: `jcos`, domain `jcos-kappa.vercel.app`, last touched June 10, no Git repository connected. The owner says this old project need not be preserved, but deleting it is unnecessary for publishing this app and has not been performed. The outreach deployment project and stable origin remain undecided. The available Vercel integration is not connected. No deployment, secret upload, paid subscription or new database has occurred.

## GitHub publication checkpoint

Current handoff supersedes the original pre-publication procedure below: PR #1 merged successfully at `871ef78` after branch and PR checks passed. `main` contains exactly the tested app tree from `fb2ee08`. Import `main`, not the old starter commit. The corrected Vercel team slug is `felipefurtado314-6006s-projects`; the owner reports GitHub identity and App access were already configured, and the loading skeleton came from the wrong slug. No permission change is needed. The separate local `fix/volunteer-header` correction is not yet on GitHub or part of this imported build.

The owner explicitly authorized proceeding with review and publication of the working branch. A live remote-ref check found only the initial `main` commit (`0a1c17c`); the app is on `feat/field-mvp`. Push only that reviewed branch, without force or a main-branch merge. Confirm the remote commit after push and inspect GitHub Actions before importing into Vercel. A public code branch is not a running website or approval for real resident data.

Pre-publication verification: TypeScript, 85 unit/service tests, 16 isolated native PostgreSQL tests, formatting and whitespace checks pass. A targeted scan of all 28 existing commits / 437 historical file blobs checked sensitive file paths, private keys, common provider secrets, JWTs, credential-bearing database URLs and private field-link patterns. The URL findings are synthetic test placeholders; no prohibited historical file paths were detected. This is a targeted review, not a guarantee that every possible secret pattern is detectable. `.env.local`, private operator files, dumps and resident-data formats are excluded from Git. No live database was changed. Build/browser verification for this publication still needs GitHub CI; the running local app was not rebuilt during the documentation/exclusion update.

## Boundaries

- A dedicated synthetic test site, backed by the existing synthetic Supabase project. No real CSV, source-file enrichment or resident data. Supabase Free/no available backups/no PITR is owner-confirmed; backup readiness remains a real-data launch blocker.
- Retain administrator allowlist/sign-in and volunteer private-link authorization. Never enable `JCO_SYNTHETIC_ONLY` on Vercel or deploy the loopback demo as authentication.
- One stable HTTPS origin for the whole phone session. Localhost and each other origin have separate browser storage; downloads and pending work do not transfer. Keep existing localhost work intact and sync it there first.
- No initialization, schema migration, password reset or Cron setup as part of deploy/build/startup. The existing database deletion schedule remains active.
- Confirm account ownership and plan suitability before creating a project or incurring costs. Small user count does not by itself determine plan eligibility. [Vercel plans](https://vercel.com/docs/plans), [pricing](https://vercel.com/pricing).
- Hobby eligibility is not established by synthetic data alone. Vercel's fair-use guidance restricts Hobby to personal non-commercial use and includes paid development in its commercial-use definition. Confirm the project's circumstances or obtain provider clarification before deploying; do not automatically upgrade. [Fair-use guidance](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).

## First deployment procedure

1. Use the owner-reported account above after confirming plan suitability and the target project. Recommend a separate `jc-outreach-test` project, subject to approval and name availability; leave `jcos` intact. Grant repository access narrowly if using the Git integration. No credentials in chat.
2. Import `FelipeF2310/jc-outreach` from the now-merged `main` branch. Verify the selected commit includes `871ef78` or a subsequently reviewed update. The publication/history scan and owner-approved merge are complete; do not repeat a branch workaround or change the repository's default branch. No force push or unrelated merge.
3. Create/select a dedicated test project with Next.js detection, repository root as the root directory, `npm ci` install and `npm run build`. Select Node 24.x, matching CI; current local checks run on Node 26, so the actual Node 24 hosted build remains evidence to collect. Do not use `npm run demo`, static export, automatic SQL setup or a database integration that installs privileged credentials. [Supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
4. Confirm the stable project domain before enabling authenticated testing. Set `JCO_APP_ORIGIN` to that exact HTTPS origin, without a trailing slash. No localhost, wildcard or untrusted forwarded-header fallback. Configure only the seven runtime variables below and redeploy after changes. A dedicated test project's Vercel **Production environment** may supply its stable test URL; that label is not approval for production resident data. Other branches/previews must not inherit these database secrets indiscriminately. [Environment scopes](https://vercel.com/docs/environment-variables).
5. Review deployment protection. The two phones must be able to reach the field shell, service worker and API without requiring volunteer Vercel accounts. Do not disable protection across unrelated projects or put a project-wide bypass secret in volunteer links. Choose a reviewed test-domain sharing policy while keeping app authorization intact. [Deployment protection](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection).
6. Inspect the actual uploaded/build artifact and logs. `.vercelignore` excludes private files, environment files, resident-data formats, dumps and generated local databases. `.gitignore` remains the Git boundary. Keep synthetic JSON fixtures required by imports; do not exclude all tests or SQL blindly. Confirm no request-body logging, session replay or third-party analytics was added. [Deployment exclusions](https://vercel.com/docs/deployments/vercel-ignore).

## Runtime configuration — private transfer only

| Name | Required value/boundary |
| --- | --- |
| `JCO_HOSTED_STAGE` | `synthetic-preview` |
| `JCO_APP_ORIGIN` | Exact stable HTTPS test origin |
| `JCO_SUPABASE_URL` | Existing approved synthetic project's URL |
| `JCO_SUPABASE_PUBLISHABLE_KEY` | Existing publishable key; never a service-role key |
| `JCO_ADMIN_EMAILS` | Existing two approved administrator identities |
| `DATABASE_URL` | Restricted `jco_admin_reader` session-pooler connection, not owner; no TLS query overrides |
| `JCO_DATABASE_CA` | Existing verified provider CA PEM, with actual line breaks preserved |

Use protected provider settings and mark credentials sensitive where supported. Never paste `.env.local`, passwords, connection strings or private assignment links in chat/build logs. Do not upload the whole local environment file. No `JCO_MIGRATION_*`, owner password, Supabase service-role secret or `NEXT_PUBLIC_` credential variable is allowed. Existing application code generates its own non-secret release marker. [Sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

Session-pooler/TLS behavior from Vercel must be verified rather than inferred from the laptop. Each app process has a small pool, but serverless instances multiply connections; check cold-start/reconnect behavior and the planned approximately ten-volunteer concurrency before launch. Do not bypass certificate verification to resolve connectivity errors.

## Deployment smoke checks — pending a real URL

Use unauthenticated requests first; never print response bodies containing credentials or identifying data.

- `/admin` and `/field` return the intended app, not a provider sign-in/interstitial. HTTPS is valid; expected no-referrer, nosniff and frame-denial headers remain.
- `/api/app-version` returns only the public version/storage/operation metadata and `no-store`; its version matches the served field page.
- `/sw.js` is JavaScript and not indefinitely cached or replaced by a protection/login HTML response.
- `/api/admin/session` with `X-JCO-Admin: 1` but no session rejects with 401; `/api/assignment` with no bearer rejects with 401. A 503 setup failure is not an authorization pass.
- `/api/demo` remains disabled (503), even with a demo header. No local practice records or private files are served.
- Owner signs in on the stable origin, reloads and sees existing synthetic campaigns; fresh session, logout and rejected access after logout work. Verify Secure/HttpOnly cookie behavior and no secrets in browser assets/logs.
- Generate a clearly labeled synthetic phone-test assignment/link on that origin. Verify its token is in the fragment, download/sync work, and the administrator receives exactly the intended records. Do not reuse an assignment with unfinished local work or revoke old links silently.
- A second build on the same origin offers a guarded update and preserves unsynchronized work. Record any deployed old-tab update issue separately; the existing reported issue is not closed by a successful build.

## Two-phone acceptance

Record each phone's model, OS/browser version, exact origin and browser versus home-screen context. Use normal iPhone Safari and Android Chrome, not a messaging app's embedded browser or private browsing. Open the link in the normal browser before downloading.

For each device: download → Ready offline → airplane mode → save no-answer/help-without-phone/person-specific correction → fully close/reopen → verify saved work → reconnect/sync → verify server records once. Also exercise locked-building semantics, interrupted/repeated sync, suppression, revocation and guarded app update. Observe large tap targets, keyboard and error states. No storage clearing to make a failed test pass. [ACCEPTANCE.md](ACCEPTANCE.md) tracks the gates; desktop browser checks do not substitute for these sessions.

Do not call the site deployed or the phones verified until the actual checks pass. No real-data launch is authorized by successful HTTPS hosting.
