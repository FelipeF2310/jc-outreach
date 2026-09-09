# Working instructions

## Read before changing this project

Read [README.md](README.md) and [docs/PLAN.md](docs/PLAN.md) for scope and current status. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for infrastructure, access, offline, or data-lifecycle changes. Read the relevant cases in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) before implementing or verifying those behaviors.

The implementation baseline is [docs/PRD.md](docs/PRD.md), containing the user's latest PRD and the explicitly authorized one-time review corrections. Read relevant PRD sections before implementing behavior. The user has authorized starting implementation. The first slice is local and synthetic only; further product-scope changes are not part of the one-time amendment authorization.

## Data boundaries

- Use synthetic fixtures during preparation and development. Never read or join the original voter file or renter-exclusion dataset for this task.
- Tier 3 must not enter persistent application storage or volunteer devices. Synthetic rejection examples are allowed only in fixtures.
- Never introduce eligibility determinations or a "not eligible" disposition.
- Never commit real resident records, exports, private links, passwords, API secrets, screenshots containing real residents, or request bodies containing resident data.
- Volunteer endpoints return explicit minimal fields; hiding fields in the UI is insufficient.

## Engineering expectations

- Implement small complete behaviors, with server authorization and meaningful failure tests.
- Database constraints and transactions enforce integrity; client checks alone are insufficient.
- Confirm a local transaction completes before reporting a successful save.
- Preserve distinct visits and revisions. Retrying an operation must not duplicate its side effects.
- Never weaken a test merely to match incorrect implementation behavior.
- Prefer native platform features and established libraries. Verify current official documentation before adding dependencies. Commit the dependency lockfile when one exists.
- Keep documentation changes alongside the behavior they describe; avoid duplicating the PRD across files.
- Report what ran, what passed, and what remains unverified. A checklist or mocked test is not evidence of real-device reliability.
- Keep production credentials and privileged database capabilities server-side. Do not use public database policies to bypass setup problems.

## Commands

- `npm ci`: install the locked dependencies.
- `npm run dev`: local synthetic development server; hot reload is not the offline acceptance environment.
- `npm run build` then `npm run demo`: stable local synthetic build for offline checks.
- `npm run check`: strict TypeScript and actual PostgreSQL integration tests.
- `npm run test:postgres`: isolated native PostgreSQL adapter/permissions tests; requires local PostgreSQL tools, uses only a temporary Unix-socket cluster, never configured hosted databases.
- `npm run format:check`: consistent source formatting.
- `npm run test:e2e`: Chromium/WebKit browser tests against a production-mode synthetic build. Build first. Tests own port 3100 and use a separate ephemeral database; they do not use `.jco-demo`.

Never deploy the local demo authorization as production auth. `JCO_SYNTHETIC_ONLY=1` requires loopback access and refuses Vercel or a configured `DATABASE_URL`. The separate `/api/admin` boundary uses Supabase provider verification and an explicit allowlist, but is enabled only in configured hosted synthetic-preview mode. No real-data mode or import endpoint exists. Read [hosted setup](docs/HOSTED-SETUP.md) before touching account/session/database configuration; owner bootstrap credentials must never be runtime credentials. Never invoke bootstrap on an existing project without explicit owner approval.

The import parser/finalizer is implemented, but `/api/demo/import` accepts only built-in synthetic case identifiers, never uploaded rows/files. Do not open a raw-upload route until administrator authorization and infrastructure body/log handling are verified. Applied SQL migrations are checksum-checked: add a new migration instead of editing an applied file or resetting resident data.
