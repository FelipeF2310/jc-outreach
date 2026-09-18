# Upload-safety review

Status: **not cleared for real resident data**. Evidence collected September 17,
2026 EDT (September 18 UTC). This is a bounded code/configuration review, not a
claim of provider-wide non-retention or evidence that a disclosure occurred.

## Remediation — applied and verified

The owner-run update completed at **2026-09-18T03:31:34.472Z**. All 13 effective
controls passed through the restricted pooler connection, original restricted
permissions passed, one idle application connection was recycled, and zero
pre-change connections remained. Independent read-only verification at
**2026-09-18T03:34:59.604Z** also passed all 13 controls with no function overrides.
This resolves the identified runtime-database logging configuration issue; it
does not close provider-wide A05 or authorize resident-data intake. No app
deployment or database migration was needed. Do not rerun the completed helper.

The live read-only capability check confirmed Supabase's `supautils` permits the
project owner to set `auto_explain.*`, `log_parameter_max_length`,
`log_min_messages` and `log_min_error_statement` at role scope. It does not permit
`log_error_verbosity` through that mechanism. Lack of a standard parameter ACL is
not proof of inability: the provider's documented extension mediates this action.

The selected, locally verified alternative uses `log_min_messages=panic` and
`log_min_error_statement=panic` for **jco_admin_reader only**. This suppresses
routine database error/warning/query text rather than merely shortening DETAIL.
Primary error text can itself contain values, so terse formatting alone was not a
sufficient protection in the first audit. PANIC/crash diagnostics and other
provider-controlled telemetry remain separate boundaries, not promises of zero
platform logging.

Tradeoff: this application's database sessions no longer supply routine error
text or slow-query plans to server logs. The PostgreSQL client still receives
errors; the application still returns its existing sanitized status/messages.
Other roles, cluster-wide settings, Auth, database permissions and Cron schedules
are unchanged. Investigate data-bearing failures using synthetic reproductions,
not by enabling payload logging in resident sessions.

### Operator action

The ignored local helper `private/protect-runtime-logging.command` opens a hidden
owner-password prompt after explicit **PROTECT-LOGGING** confirmation. Pause
synthetic edits/sync during maintenance. It invokes:

```sh
node --env-file=.env.local --import tsx scripts/configure-runtime-logging.ts --password-stdin --recycle-idle-runtime
```

Use the helper to supply the established project-specific owner connection
template and CA privately. Never put a password in the command line, chat, source
control or Vercel runtime settings. The owner password is not saved.

The operation:

1. Checks verified TLS, actual owner identity, synthetic project stage, table
   ownership, restricted-role attributes, conflicting database-specific defaults
   and function-level logging overrides.
2. Writes only the previous eight targeted role-default entries into a new
   `private/runtime-logging-before-<uuid>.json`, mode 0600, before changes. It saves
   no resident records or passwords. Keep the first successful pre-change receipt.
3. Applies eight fixed `ALTER ROLE jco_admin_reader SET` statements in one
   transaction. No dynamic role selection, grants, migration edits, resets,
   row changes or arbitrary SQL are accepted.
4. Recycles only idle client backends for that role in the current database.
   An app request racing with idle reconnection may need a refresh/retry. Active
   sessions are not intentionally targeted and any remaining pre-change sessions
   prevent claiming complete verification. No database restart is requested.
5. Uses the restricted pooler connection to audit effective settings and original
   privileges. It reports success only when that audit passes and no pre-change
   sessions remain. A saved configuration is not proof of effective pooled state.

If the output reports `settings_committed=true` but verification fails, do not
assume rollback or rerun initialization. Share the sanitized stage/category and
check statuses. Data and permissions are unchanged; fresh-connection/recycling or
provider permission follow-up may still be required. The script does not perform
synthetic error injection or read hosted database logs.

### Recovery

An interruption inside the configuration transaction rolls back all eight changes.
That behavior is verified on native PostgreSQL. After a successful commit,
rollback is a separate reviewed operator action: use the original private
snapshot to restore each targeted role default, and `ALTER ROLE ... RESET` only
for targeted keys absent from that snapshot. Validate the fixed role/key allowlist
and current state first; never execute snapshot contents as SQL. Never use
`RESET ALL`, reset passwords, restore campaign data or change unrelated defaults.
Recycling and effective-state checks are required after restoration too. Restoring
unsafe logging would reopen this gate and requires real-data intake to stay off.

### New verification evidence

98 unit/service tests and 17 isolated native PostgreSQL tests pass, plus strict
TypeScript. The native regression first reproduces disclosure with synthetic
canaries in actual local server logs, then verifies no canary from successful
bound queries, WARNING, primary ERROR, DETAIL or a security-definer call appears
after the policy. Error delivery and restricted permissions still work. The test
also proves partial-update rollback, unrelated owner-session settings unchanged,
and stale held connections retaining their prior configuration. The local server
is PostgreSQL 16.14 with auto_explain, not the hosted PostgreSQL 17 server. The
hosted effective-configuration/privilege checks above are separate evidence;
synthetic fault probes and raw-log inspection were not run against Supabase. The
local server lacks pgAudit, so that portion is not represented as locally
verified.

The audit now checks 13 settings, including transaction sampling and the two
error-text suppression thresholds. A passing result still does not open ingress
or approve real resident use. Earlier four-flag evidence below is historical; the
strengthened audit adds requirements rather than treating an inaccessible setting
as automatically safe.

## Verified boundaries

- The application still has no raw-file upload endpoint. Hosted import accepts
  built-in synthetic case identifiers; the local practice picker transmits neither
  selected bytes nor filenames. It does not enable real-data mode.
- The reviewed request path authenticates administrators before reading import
  input, bounds JSON bodies, uses parameterized database calls and returns generic
  errors. No application request-body logger, upload-file write or application
  telemetry initializer was found in this review. This is not a provider guarantee.
- Read-only Vercel API inventory for the intended project returned zero applicable
  drains from both current drain and legacy log-drain endpoints. Project metadata
  contained web-analytics and speed-insights objects whose enabled state was not
  resolved; omitted observability fields are unknown, not proof of disablement.
- The restricted Supabase connection passed the read-only/synthetic-stage scope
  check. No outreach function-local logging overrides were found. No resident
  rows, raw logs, passwords or connection strings were printed or inspected.

## Original database logging finding — historical, remediated above

The repeatable audit at **2026-09-18T03:06:40.840Z** completed with exit code 2
(review required), six passing controls and four requiring review:

| Control | Observed setting | Reason for review |
| --- | --- | --- |
| `auto_explain.log_min_duration` | `10000` ms | Slow-query diagnostic logging is enabled. |
| `auto_explain.log_parameter_max_length` | `-1` | Parameters may be logged in full by that diagnostic path. |
| `log_parameter_max_length` | `-1` | Ordinary statement logging can include full parameters when a qualifying logging path runs. |
| `log_error_verbosity` | `default` | Error DETAIL/CONTEXT can contain identifying row information. |

Ordinary duration/sample logging is disabled; statement logging is `ddl`, audit
logging is `none`, audit parameters are `off`, and error bind-parameter logging is
`0`. Consequently, the ordinary parameter setting alone is **not** evidence that
every application query is currently logged. Separately enabled slow-query
diagnostics and error detail still need attention.

The initial proposed baseline used terse verbosity. Subsequent capability
inspection and the actual-error test established the supported suppression
alternative documented above. No settings changed during the initial read-only
review; the later owner-confirmed role-scoped operation is recorded separately.

Even terse errors and zero parameter logging cannot redact every possible primary
error message or SQL literal. Keep bound parameters, fixed non-identifying error
messages and minimized application diagnostics; verify the resulting behavior with
approved synthetic probes before closing the gate. Never deliberately generate
slow queries or sensitive errors against the live system without a reviewed plan.

## Repeatable read-only check

With the existing private, restricted synthetic configuration:

```sh
node --env-file=.env.local --import tsx scripts/check-upload-safety.ts
```

The command uses verified TLS and a read-only transaction. It checks deployment
scope, allowlisted PostgreSQL settings and function-local overrides. Output is
limited to timestamps, fixed setting names, statuses and sanitized failure
categories; raw setting values are not echoed. Exit 0 means this conservative
database baseline passed, 2 means review is required, and 1 means the audit could
not complete. **All outcomes retain `realDataApproved: false`.** Missing extension
settings are unknown rather than automatically safe. This audit is not an HTTP
endpoint, deployment operation or import toggle.

## Remaining provider and transport work

1. **Runtime logging configuration completed:** the supported owner-authorized
   role policy, native synthetic error regression and independent effective-state
   audit pass. Keep these checks in future configuration/release reviews and
   recheck after provider configuration changes. No hosted fault probe or claim of
   complete provider non-retention is implied.
2. Verify account-specific Vercel/Supabase request-body, telemetry, temporary-file
   and log-retention behavior. Public documentation and an empty drain list do not
   prove that provider-controlled internal systems never retain payloads. Resolve
   unknown instrumentation settings or seek provider confirmation where necessary.
3. Resolve a transport-size mismatch before real ingress: the existing parser
   allows 5 MiB, while Vercel Functions document a 4.5 MB request **and response**
   limit. Proposed raw HTTP body limit: 4 MiB, checked before/during reading on the
   server and before transmission in the UI. Bound preview responses too; account
   for any encoding/envelope overhead. This is a design recommendation, not an
   implemented limit. Do not introduce retained object-storage uploads to bypass it.
4. Complete the narrow transactional finalizer, approved source preparation,
   authentication/recovery, backup and remaining launch evidence described in
   [CSV intake](CSV-INTAKE.md). Passing this audit alone cannot authorize real data.

## Initial review verification and scope — historical

Strict TypeScript and 95 local unit/service tests pass, including four new audit
tests covering missing/unsafe/duplicate controls, value non-disclosure, restricted
scope, read-only ordering and function overrides. The actual restricted hosted
audit also completed, reporting the expected review status. Its first CLI attempt
stopped before connecting because of module-format incompatibility; the entry
point was corrected and rerun. No migration, hosted configuration change, upload,
deployment, real-source preparation or live fault injection occurred. Existing
browser/native-PostgreSQL evidence is historical; those suites were not rerun for
this operator-only change.

## Official references

- [PostgreSQL 17 logging controls](https://www.postgresql.org/docs/17/runtime-config-logging.html)
- [PostgreSQL 17 auto_explain](https://www.postgresql.org/docs/17/auto-explain.html)
- [Supabase custom PostgreSQL configuration](https://supabase.com/docs/guides/database/custom-postgres-config)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel runtime logs](https://vercel.com/docs/logs/runtime)
- [Vercel log drains](https://vercel.com/docs/drains/reference/logs)
