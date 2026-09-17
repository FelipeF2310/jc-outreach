# Jersey City Benefits Outreach

Mobile outreach coordination for Jersey City, with offline household visits and follow-up tracking.

Administrator sign-in, restricted Supabase access, campaign creation/reload, synthetic import and event/building-run assignment save/reload are confirmed. Migrations 006–007 and restricted-runtime checks passed on 2026-09-15. The owner confirmed named-link issuance, assignment download, local save, synchronization and administrator receipt of a new synthetic visit at 5:12:48 PM EDT that day. This is a live hosted happy-path check on the local app, not physical-phone/offline acceptance. See the agreed [delivery roadmap](docs/ROADMAP.md). This is not the completed field MVP or an approved real-data deployment. No real residents have been loaded; the PRD is unchanged.

Current development slice (2026-09-17): browser-scoped walk-completion reporting is implemented. Hosted updates 011–012 and restricted-runtime checks passed. The owner confirmed finish/reload/sync/admin receipt/resume with unchanged visit totals. A missing update notice in an older tab remains under investigation: an isolated two-build Chromium/WebKit check passed, but the exact reported old bundle has not been recovered. See [verification evidence](docs/PLAN.md#completion-walkthrough-and-update-investigation--2026-09-17) and [setup and walkthrough](docs/HOSTED-SETUP.md#walk-completion-updates-011012--applied-and-read-verified). HTTPS hosting/physical-phone tests remain deferred, not completed.

Latest slice (2026-09-17): retention migration **013 is applied and the schedule is enabled**. Independent READ ONLY checks observed worker completions at 17:14 and 17:16 UTC without manual invocation. All three active synthetic campaigns remained, with zero deleted/overdue/failed campaigns and restricted permissions intact. The owner approved a separate disposable-fixture rehearsal; its operator helper is prepared and locally tested, but **actual hosted fixture deletion and hosted retry/failure checks remain pending**. Existing practice deadlines must not change. See [retention setup](docs/HOSTED-SETUP.md#disposable-retention-rehearsal--prepared-awaiting-owner-run). Real-data, backup and physical-device gates remain open.

## Established requirements

- Approximately 10 concurrent volunteers; 938 household doors containing 1,157 listed people across 605 buildings.
- Household-first outreach for Senior Freeze, Stay NJ, and ANCHOR; never determine eligibility.
- Tier 1 and Tier 2 only. Tier 3, the renter-exclusion file, and the original voter file stay outside this project.
- Volunteers use private assignment links with no account or password screen; administrators manage the permitted campaign data.
- Downloaded assignments and visits must work offline on iPhone Safari and Android Chrome.
- Independently recorded visits survive; retries do not create duplicates.
- Building access failures are distinct from household attempts.
- Help requests work without a phone number. Optional numbers must come from residents with permission for application-help contact.
- Identifying campaign data expires 30 days after the campaign end date, including unresolved requests. Future reuse retains templates and non-identifying totals, not a permanent resident directory.

## Preparation documents

- [MVP implementation PRD](docs/PRD.md)
- [Agent working instructions](AGENTS.md)
- [Engineering foundation and sources](docs/ARCHITECTURE.md)
- [Work status and revision record](docs/PLAN.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Acceptance checklist](docs/ACCEPTANCE.md)
- [Hosted synthetic-preview setup](docs/HOSTED-SETUP.md)
- [Synthetic fixture instructions](tests/fixtures/README.md)

## Try the local synthetic build

Requires Node 22 or newer (local verification uses Node 26.7.0). From this directory:

```sh
npm ci
npm run build
npm run demo
```

Open `http://127.0.0.1:3000`. Generate a practice link, open the volunteer assignment, and download. Once Ready offline appears, disconnect, record a visit, reopen `/field`, reconnect, and synchronize. Return to the organizer screen and refresh results. Names/addresses are explicit fixtures; do not enter real phone numbers.

Use `npm run dev` for hot reload only. Test offline behavior with the stable built app, not development chunks. Keep one demo server running at a time: the local PostgreSQL fixture database in `.jco-demo/` has one owning process. Do not expose this server through a public tunnel or reuse its demo access as production authentication.

To try the importer, click **New import rehearsal**. Choose a built-in CSV example, validate it, inspect the household preview, confirm the source, and finalize. A valid import can become a practice assignment using the existing volunteer link/offline flow. Invalid examples never persist resident rows. Reloading the organizer page restores recent rehearsal campaigns. Actual file selection/upload is deliberately unavailable until production access and infrastructure handling are approved.

## Check the implementation

```sh
npm run check
npm run test:postgres
npm run format:check
npx playwright install chromium webkit
npm run build
npm run test:e2e
```

The browser suite starts its own loopback server on port 3100 with an ephemeral synthetic database, separate from `.jco-demo/`. Screenshots are synthetic, ignored, and written under `test-results/`. CI is defined in `.github/workflows/check.yml`; it has not run on GitHub until the branch is pushed.

The native PostgreSQL test command requires installed PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`). It starts and removes only its own isolated temporary Unix-socket test cluster; it never uses a configured hosted database.

## Implemented versus still required

Implemented: minimal household assignment download, generic offline shell, durable IndexedDB outbox, visit/help/correction/DNC atomic saves, building-access records, manual synchronization, contact-result revisions, server transaction/idempotency checks, and a basic received-results console.

Also implemented: strict UTF-8 CSV validation, minimized source persistence, conservative household/building grouping, repeatable in-memory preview, atomic immutable finalization, duplicate-import protection, a synthetic import-to-assignment flow, and additive checksum-checked local database migrations.

Also implemented: administrator email/password UI and server-only Supabase SDK session/allowlist boundary; secure scoped cookies and session refresh; PostgreSQL connection/transaction adapter; explicit empty-synthetic-database bootstrap and a read-only restricted campaign endpoint. These are locally tested foundations, not a verified live Supabase deployment. Visit `/admin` to see the sign-in screen; the local demo correctly reports that hosted sign-in is not configured. Use configured `npm start` for provider sign-in, not `npm run demo`. Volunteers remain private-link-only.

New slice: authenticated synthetic campaign creation with server-calculated end/deletion timestamps, same-request retry protection, and a narrow database function executed by a dedicated non-login role. The form retains unconfirmed requests in this tab's session storage across reloads. Apply the reviewed operator-only update before trying a live save; existing campaign reads continue to work before the update. No automatic deletion, CSV ingress or hosted field workflow is enabled by this slice.

New import slice: each saved campaign offers built-in fixture preview, explicit approval and atomic finalization after the reviewed 004 database update. The persisted receipt appears automatically on campaign reload. Invalid examples never persist; the database import function accepts no uploaded rows and contains only the fixed approved fixture. Hosted assignment creation follows separately.

The hosted administrator page is one campaign workspace with **Household list**, **Volunteer assignments**, and **Results & follow-up** sections. Choose a campaign at the top; completed imports stay compact and creation forms expand when needed. Campaign switching retains mounted drafts and one-time links; the last selected campaign ID is remembered in this tab when browser storage permits. CSV error examples are under Testing tools, not the main workflow. Application-help database update **008** is applied and restricted-account capability/read checks passed. On 2026-09-15 the owner confirmed a live synthetic request without a phone, both status changes surviving reload, and resolved-list placement. Correction review is now connected; its live review/reopen walkthrough is owner-confirmed.

After update 008, **Application help** lists received requests across the selected campaign, independently of the assignment-results selector. Open requests show household/unit, the requesting person when recorded, optional consented phone, follow-up arrangement and a do-not-contact warning where applicable. Source-visit details and resolved requests are collapsed. Use **Mark in progress**, then **Mark resolved**; status changes are server-confirmed, audited and version-checked. An interrupted save can be retried from this tab after reload without creating duplicate history. Resident details are not stored in administrator browser storage. Existing volunteer submissions and campaign retention are unchanged; no notifications, ownership, reopening or correction review are added in this slice.

Resident correction database update **009** is applied; restricted-account capability and queue-read checks passed on 2026-09-15. The owner confirmed person-specific reporting, review/reopening surviving reload, unchanged visit counts and retained household members on 2026-09-15. In **Results & follow-up → Resident corrections**, open reports show the reported issue, affected person or household, and source visit. **Mark reviewed** moves a report to collapsed history; **Keep open** returns it to the active queue. Review does not verify a claim, edit imported records, remove suppression or determine eligibility. Retries and competing edits use audited version checks. Existing field submissions and the help queue remain unchanged. Do not use the real CSV yet; future intake starts with headers and a de-identified sample.

Hosted field workflow (live happy path owner-confirmed): open **Volunteer links** on a saved assignment. Generate a private link, copy it while shown, open the volunteer screen, download and record synthetic visits, then synchronize. Use **View results** on that assignment or the separate **Results & follow-up** section, then **Refresh results**. Totals are for the selected assignment, not the entire campaign. The server retains only a token hash. A lost issuance acknowledgment can be retried without creating another credential, but cannot recover the raw secret; issue another link if needed and explicitly revoke any unneeded entry. New links do not revoke existing access. Revocation blocks pending uploads and cannot erase disconnected browser copies. Localhost links work on this computer, not other phones; physical-phone use awaits HTTPS hosting.

Household reassignment database update **010** is applied; independent restricted-account capability/workspace-read checks passed on 2026-09-15. The owner confirmed moving only Unit 10B from Practice Volunteer A to B, reload persistence, four retained visits and no new links/visits. A full volunteer-page reload loaded the new counter and reassignment notice: 1 of 1 / 100%, four received records. **Volunteer assignments → Reassign doors** requires explicit confirmation and preserves event/type/order/history. No link is automatically issued or revoked; tell both volunteers about the handoff because disconnected copies cannot update immediately. Completion reporting follows separately.

The volunteer page now checks for compatible app updates on assignment refresh, foreground/resume/reconnection and every minute while visible. **App update available → Reload to update** never reloads automatically. Open forms, unsynchronized/rejected records, offline state and active work block it. On explicit action, the client rechecks shared storage before/after preparing the exact new offline shell; assignment data and receipts are not reset. Storage/cache/network failures leave the current page open. Old pages without this feature need one online Refresh assignment followed by a browser reload to receive it. Physical-phone and independently built/deployed release-transition acceptance remain separate from automated simulated-release coverage.

Still required: remaining import failure/retry launch evidence; administrator session/recovery/rate-limit acceptance; production CSV upload/approval handling; remaining hosted lifecycle and field/follow-up failure-path checks; remaining field details; hosted retention migration/schedule activation and observed scheduled deletion/retry; client-release migration testing; real-device acceptance; approved program material; production hosting/log/backup review. Local worker tests and server expiry checks alone do not satisfy the scheduled-retention launch requirement.

Named volunteer links are implemented; database update **007** succeeded and its restricted-runtime capability check passed on 2026-09-15. **Volunteer links** includes **Volunteer / link name** when issuing a new link; its saved name appears in the issued-link list and revocation confirmation. The owner confirmed issuing and using a named link; an explicit named-label browser-reload check remains separate. Older unnamed links remain usable. The name is organizer-provided metadata, not verified volunteer identity, and does not change assignment scope or create an account. It is not included in the URL or volunteer download. Names follow credential/campaign retention. This slice does not rename existing links or add per-person activity attribution.

Link management shows active links first, with revoked and expired links in separate collapsed history sections. Revoked entries retain their original number, optional name and revocation time but have no action buttons. Refreshing removes copy/open controls for a displayed link that has since been revoked. This presentation change does not require a database update or delete submitted visits.

With hosted settings in `.env.local`, run the separate local practice harness using `DATABASE_URL= JCO_DATABASE_CA= JCO_HOSTED_STAGE= npm run demo`. This clears hosted access only for that process, not the saved configuration. Browser tests explicitly isolate these settings as well.

Supabase PostgreSQL/Auth/Cron and Vercel remain the selected production direction. PGlite is a local PostgreSQL-compatible synthetic development/test harness, not a replacement production backend. Details and evidence are in [architecture](docs/ARCHITECTURE.md) and [work status](docs/PLAN.md).

All committed test data is explicitly synthetic. Production uploads, exports, tokens, and secrets must remain outside Git. `.gitignore` is a precaution, not an authorization or data-loss prevention control.
