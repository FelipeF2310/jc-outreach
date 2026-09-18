import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessUploadLogging,
  inspectUploadLogging,
  uploadLoggingSettings,
} from "../../src/server/upload-safety";
import type { Database } from "../../src/server/db-contract";

const safe = [
  ["log_statement", "ddl"],
  ["log_min_duration_statement", "-1"],
  ["log_min_duration_sample", "-1"],
  ["log_parameter_max_length", "0"],
  ["log_parameter_max_length_on_error", "0"],
  ["log_error_verbosity", "terse"],
  ["log_min_messages", "panic"],
  ["log_min_error_statement", "panic"],
  ["log_transaction_sample_rate", "0"],
  ["pgaudit.log", "none"],
  ["pgaudit.log_parameter", "off"],
  ["auto_explain.log_min_duration", "-1"],
  ["auto_explain.log_parameter_max_length", "0"],
].map(([name, setting]) => ({ name, setting }));

test("a passing database baseline is not approval to import real data", () => {
  const result = assessUploadLogging(safe);
  assert.equal(result.loggingBaselinePassed, true);
  assert.equal(result.realDataApproved, false);
  assert.equal(result.checks.length, uploadLoggingSettings.length);
});

test("each unsafe or missing logging control fails closed without reflecting values", () => {
  for (const name of uploadLoggingSettings) {
    for (const setting of ["SYNTHETIC_PRIVATE_VALUE", null]) {
      const result = assessUploadLogging(
        safe.map((row) => (row.name === name ? { name, setting } : row)),
      );
      assert.equal(result.loggingBaselinePassed, false);
      assert.equal(
        JSON.stringify(result).includes("SYNTHETIC_PRIVATE_VALUE"),
        false,
      );
      assert.equal(
        result.checks.find((check) => check.setting === name)?.status,
        setting === null ? "unknown" : "review",
      );
    }
    assert.equal(
      assessUploadLogging(safe.filter((row) => row.name !== name))
        .loggingBaselinePassed,
      false,
    );
    assert.equal(
      assessUploadLogging([...safe, safe.find((row) => row.name === name)!])
        .loggingBaselinePassed,
      false,
    );
  }
});

test("slow-query diagnostics with full parameters require review despite error suppression", () => {
  const observed = safe.map((row) => ({
    ...row,
    setting:
      row.name === "auto_explain.log_min_duration"
        ? "10000"
        : row.name === "auto_explain.log_parameter_max_length" ||
            row.name === "log_parameter_max_length"
          ? "-1"
          : row.name === "log_error_verbosity"
            ? "default"
            : row.setting,
  }));
  const result = assessUploadLogging(observed);
  assert.equal(result.loggingBaselinePassed, false);
  assert.equal(
    result.checks.filter((check) => check.status === "review").length,
    3,
  );
});

test("only verified routine-error suppression compensates for unavailable verbosity control", () => {
  for (const verbosity of ["default", "terse", "verbose"]) {
    const rows = safe.map((row) =>
      row.name === "log_error_verbosity" ? { ...row, setting: verbosity } : row,
    );
    assert.equal(assessUploadLogging(rows).loggingBaselinePassed, true);
    for (const name of ["log_min_messages", "log_min_error_statement"])
      assert.equal(
        assessUploadLogging(
          rows.map((row) =>
            row.name === name ? { ...row, setting: "error" } : row,
          ),
        ).loggingBaselinePassed,
        false,
      );
  }
});

test("audit is read-only, scoped before settings access, and checks function overrides", async () => {
  const queries: string[] = [];
  let allowed = true;
  let overrides = 0;
  const db: Database = {
    async transaction(work) {
      return work(db);
    },
    async exec(sql) {
      queries.push(sql);
      assert.equal(sql, "SET TRANSACTION READ ONLY");
    },
    async query<T>(sql: string, params?: unknown[]) {
      queries.push(sql);
      let rows: unknown[];
      if (sql.includes("outreach.deployment"))
        rows = [{ restricted: allowed, synthetic: true, read_only: true }];
      else if (sql.includes("pg_settings")) {
        assert.deepEqual(params, [[...uploadLoggingSettings]]);
        rows = safe;
      } else if (sql.includes("pg_proc")) rows = [{ count: overrides }];
      else throw Error("Unexpected query");
      return { rows: rows as T[] };
    },
  };
  assert.equal((await inspectUploadLogging(db)).loggingBaselinePassed, true);
  overrides = 1;
  assert.equal((await inspectUploadLogging(db)).loggingBaselinePassed, false);
  allowed = false;
  const before = queries.length;
  await assert.rejects(inspectUploadLogging(db), /restricted synthetic/);
  assert.equal(queries.length - before, 2);
  assert.ok(
    queries.every(
      (sql) => sql === "SET TRANSACTION READ ONLY" || sql.startsWith("SELECT"),
    ),
  );
});
