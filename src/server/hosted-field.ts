import { randomBytes } from "node:crypto";
import {
  completionReportSchema,
  completionReceiptSchema,
  type CompletionSnapshot,
} from "../lib/completion-contracts";
import { z } from "zod";
import {
  DomainError,
  operationSchema,
  type Assignment,
  type Receipt,
} from "../lib/contracts";
import {
  fieldAdminRequest,
  type FieldSnapshot,
} from "../lib/field-admin-contracts";
import type { Database, SqlConnection } from "./db-contract";
import { hashToken, practicePrograms } from "./service";
import { requireHostedReader } from "./hosted-campaigns";
import { outreachPrograms } from "./program-reference";

async function bounded<T>(
  db: Database,
  work: (tx: SqlConnection) => Promise<T>,
) {
  try {
    return await db.transaction(async (tx) => {
      await requireHostedReader(tx);
      return work(tx);
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    const errors: Record<string, [number, string]> = {
      JF401: [401, "Assignment link is unavailable. Contact your organizer."],
      JF403: [
        403,
        "This link is revoked or the record is outside its assignment. Pending work remains on this device. Contact your organizer.",
      ],
      JF404: [404, "This assignment or credential is unavailable."],
      JF405: [
        403,
        "Field work has ended. Only previously saved work can synchronize.",
      ],
      JF409: [
        409,
        "This saved ID has conflicting content. Contact your organizer; pending work remains on this device.",
      ],
      JF410: [410, "The campaign or synchronization window has expired."],
      JF422: [
        422,
        "This request failed validation or the event has ended. Pending work remains on this device.",
      ],
      JF424: [424, "The original visit must synchronize first."],
      JF503: [503, "Hosted field access is unavailable."],
      "42883": [
        503,
        "Hosted field access needs its database update. Existing assignments are unchanged.",
      ],
      "23505": [
        409,
        "This record identifier is already used. Contact your organizer.",
      ],
      "22P02": [422, "Invalid field record."],
      "22007": [422, "Invalid record timestamp."],
      "22008": [422, "Invalid record timestamp."],
    };
    if (errors[code]) throw new DomainError(...errors[code]);
    throw error;
  }
}
function credentialHash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new DomainError(
      401,
      "Assignment link is invalid. Contact your organizer.",
    );
  return hashToken(token);
}
export async function downloadHostedAssignment(
  db: Database,
  token: string,
): Promise<Assignment> {
  const hash = credentialHash(token);
  return bounded(db, async (tx) => {
    const { rows } = await tx.query<{
      assignment: Omit<Assignment, "programs">;
    }>("SELECT outreach.download_field_assignment($1) AS assignment", [hash]);
    if (!rows[0]?.assignment) throw new Error("Assignment response missing");
    const capability = await tx.query<{ ready: boolean }>(
      "SELECT to_regprocedure('outreach.submit_completion_report(text,jsonb)') IS NOT NULL AS ready",
    );
    return {
      ...rows[0].assignment,
      eventEndsAt: new Date(rows[0].assignment.eventEndsAt).toISOString(),
      deletionAt: new Date(rows[0].assignment.deletionAt).toISOString(),
      programs: rows[0].assignment.synthetic
        ? practicePrograms()
        : outreachPrograms(),
      ...(capability.rows[0]?.ready ? { completionReady: true } : {}),
    };
  });
}
export async function submitHostedOperation(
  db: Database,
  token: string,
  input: unknown,
): Promise<Receipt> {
  const hash = credentialHash(token);
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      422,
      "This record failed validation. Keep it on this device and contact your organizer.",
    );
  return bounded(db, async (tx) => {
    const { rows } = await tx.query<{ receipt: Receipt }>(
      "SELECT outreach.submit_field_operation($1,$2::jsonb) AS receipt",
      [hash, JSON.stringify(parsed.data)],
    );
    if (rows[0]?.receipt?.operationId !== parsed.data.id)
      throw new Error("Receipt missing");
    return {
      ...rows[0].receipt,
      receivedAt: new Date(rows[0].receipt.receivedAt).toISOString(),
    };
  });
}
export async function hostedFieldAdmin(
  db: Database,
  input: unknown,
  actor: string,
) {
  const parsed = fieldAdminRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(400, "Choose a valid assignment and action.");
  const request = parsed.data;
  return bounded(db, async (tx) => {
    let token: string | null = null;
    if (request.action === "issue") {
      const candidate = randomBytes(32).toString("base64url");
      const result = await tx.query<{ created: boolean }>(
        request.label === undefined
          ? "SELECT outreach.issue_field_credential($1,$2,$3,$4) AS created"
          : "SELECT outreach.issue_field_credential($1,$2,$3,$4,$5) AS created",
        [
          request.id,
          request.assignmentId,
          hashToken(candidate),
          actor,
          ...(request.label === undefined ? [] : [request.label]),
        ],
      );
      if (result.rows[0]?.created) token = candidate;
    } else if (request.action === "revoke") {
      await tx.query("SELECT outreach.revoke_field_credential($1,$2,$3)", [
        request.id,
        request.assignmentId,
        actor,
      ]);
    }
    const { rows } = await tx.query<{ snapshot: FieldSnapshot }>(
      "SELECT outreach.field_admin_snapshot($1) AS snapshot",
      [request.assignmentId],
    );
    if (rows[0]?.snapshot?.assignmentId !== request.assignmentId)
      throw new Error("Status unavailable");
    const capability = await tx.query<{ ready: boolean }>(
      "SELECT to_regprocedure('outreach.field_completion_snapshot(uuid)') IS NOT NULL AS ready",
    );
    if (capability.rows[0]?.ready) {
      const report = await tx.query<{ completion: CompletionSnapshot }>(
        "SELECT outreach.field_completion_snapshot($1) AS completion",
        [request.assignmentId],
      );
      rows[0].snapshot.completion = report.rows[0]?.completion;
    }
    return {
      snapshot: rows[0].snapshot,
      ...(request.action === "issue"
        ? { credentialId: request.id, token }
        : {}),
    };
  });
}

export async function submitHostedCompletion(
  db: Database,
  token: string,
  input: unknown,
) {
  const hash = credentialHash(token);
  const parsed = completionReportSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      422,
      "Invalid completion report. Saved work is unchanged.",
    );
  return bounded(db, async (tx) => {
    const result = await tx.query<{ receipt: unknown }>(
      "SELECT outreach.submit_completion_report($1,$2::jsonb) AS receipt",
      [hash, JSON.stringify(parsed.data)],
    );
    const receipt = completionReceiptSchema.parse(result.rows[0]?.receipt);
    if (receipt.reportId !== parsed.data.id)
      throw Error("Report receipt mismatch");
    return receipt;
  });
}
