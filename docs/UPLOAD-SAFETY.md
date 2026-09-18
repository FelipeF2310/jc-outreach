# Upload-safety review

Status: **not cleared for real resident data**. Evidence collected September 17,
2026 EDT (September 18 UTC). This is a bounded code/configuration review, not a
claim of provider-wide non-retention or evidence that a disclosure occurred.

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

## Database logging blocker

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

The conservative proposed application-session baseline disables slow-query
diagnostics, suppresses ordinary/diagnostic parameter values and uses terse error
verbosity. Whether the provider permits these changes for the restricted runtime
must be established before preparing a narrowly scoped configuration change.
Do not disable unrelated platform security/audit logging or grant broad runtime
privileges as a shortcut. No settings were changed by this review.

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

1. Confirm supported narrowly scoped database logging controls, obtain approval
   for any hosted configuration change, and recheck using a fresh runtime
   connection. Test representative synthetic validation/database errors without
   retaining their payloads in public evidence.
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

## Verification and scope

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
