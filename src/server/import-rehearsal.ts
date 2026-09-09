import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import fixture from "../../tests/fixtures/outreach.json";
import cases from "../../tests/fixtures/import-cases.json";
import { DomainError } from "../lib/contracts";
import { issueCredential } from "./service";

export const rehearsalRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), campaignId: z.uuid() }),
  z.strictObject({
    action: z.literal("preview"),
    campaignId: z.uuid(),
    caseId: z.string().max(80),
  }),
  z.strictObject({
    action: z.literal("finalize"),
    campaignId: z.uuid(),
    caseId: z.string().max(80),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({ action: z.literal("assignment"), campaignId: z.uuid() }),
]);
/** Build trusted, explicitly synthetic CSV bytes IN MEMORY. Never accept uploaded rows here. */
export function rehearsalCsv(caseId: string) {
  const example = cases.cases.find((c) => c.id === caseId);
  if (!example) throw new DomainError(400, "Unknown synthetic example.");
  const rows: Record<string, string>[] = structuredClone(fixture.records);
  for (const change of example.changes) {
    if ("sourceRow" in change)
      Object.assign(rows[change.sourceRow], change.set);
    if ("appendCopyOf" in change) rows.push({ ...rows[change.appendCopyOf] });
    if ("deleteFieldFromAll" in change)
      for (const row of rows) delete row[change.deleteFieldFromAll];
    if ("setFieldOnAll" in change)
      for (const row of rows)
        row[change.setFieldOnAll.key] = change.setFieldOnAll.value;
  }
  const headers = Object.keys(rows[0]);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return new TextEncoder().encode(
    [
      headers.map(quote).join(","),
      ...rows.map((row) => headers.map((h) => quote(row[h])).join(",")),
    ].join("\r\n"),
  );
}
export async function createRehearsal(db: PGlite, campaignId: string) {
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ end_at: Date; deletion_at: Date }>(
      "SELECT r.end_at,c.deletion_at FROM outreach.import_rehearsals r JOIN outreach.campaigns c ON c.id=r.campaign_id WHERE r.campaign_id=$1",
      [campaignId],
    );
    if (existing.rows[0])
      return {
        campaignId,
        endAt: existing.rows[0].end_at.toISOString(),
        deletionAt: existing.rows[0].deletion_at.toISOString(),
      };
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const campaign = await tx.query<{ deletion_at: Date }>(
      `INSERT INTO outreach.campaigns(id,name,deletion_at) VALUES ($1,'Synthetic import rehearsal',(($2::timestamptz AT TIME ZONE 'America/New_York') + interval '30 days') AT TIME ZONE 'America/New_York') RETURNING deletion_at`,
      [campaignId, end],
    );
    await tx.query(
      "INSERT INTO outreach.import_rehearsals(campaign_id,end_at) VALUES ($1,$2)",
      [campaignId, end],
    );
    return {
      campaignId,
      endAt: end,
      deletionAt: campaign.rows[0].deletion_at.toISOString(),
    };
  });
}
export async function requireRehearsal(db: PGlite, campaignId: string) {
  const row = await db.query(
    "SELECT r.campaign_id FROM outreach.import_rehearsals r JOIN outreach.campaigns c ON c.id=r.campaign_id WHERE r.campaign_id=$1 AND c.deletion_at>now()",
    [campaignId],
  );
  if (!row.rows.length)
    throw new DomainError(404, "Synthetic import campaign unavailable.");
}
export async function assignRehearsal(db: PGlite, campaignId: string) {
  const assignmentId = await db.transaction(async (tx) => {
    const row = await tx.query<{ end_at: Date; assignment_id: string | null }>(
      `SELECT r.end_at,r.assignment_id FROM outreach.import_rehearsals r
      JOIN outreach.campaigns c ON c.id=r.campaign_id WHERE r.campaign_id=$1 AND c.deletion_at>now() FOR UPDATE OF r,c`,
      [campaignId],
    );
    const rehearsal = row.rows[0];
    if (!rehearsal)
      throw new DomainError(404, "Synthetic import campaign unavailable.");
    if (rehearsal.end_at <= new Date())
      throw new DomainError(410, "This rehearsal event has ended.");
    if (rehearsal.assignment_id) return rehearsal.assignment_id;
    if (
      !(
        await tx.query("SELECT id FROM outreach.imports WHERE campaign_id=$1", [
          campaignId,
        ])
      ).rows.length
    )
      throw new DomainError(
        409,
        "Finalize the validated import before assigning households.",
      );
    const households = await tx.query<{
      id: string;
      address: string;
      unit: string;
    }>(
      "SELECT id,address,unit FROM outreach.households WHERE campaign_id=$1 AND NOT suppressed",
      [campaignId],
    );
    households.rows.sort(
      (a, b) =>
        a.address.localeCompare(b.address, "en", { numeric: true }) ||
        a.unit.localeCompare(b.unit, "en", { numeric: true }),
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO outreach.assignments(id,campaign_id,name,event_name,event_ends_at) VALUES ($1,$2,'Imported practice walk','Jersey City · Import rehearsal',$3)",
      [id, campaignId, rehearsal.end_at],
    );
    for (const [position, h] of households.rows.entries())
      await tx.query(
        "INSERT INTO outreach.memberships(assignment_id,household_id,position) VALUES ($1,$2,$3)",
        [id, h.id, position],
      );
    await tx.query(
      "UPDATE outreach.import_rehearsals SET assignment_id=$1 WHERE campaign_id=$2",
      [id, campaignId],
    );
    return id;
  });
  return { assignmentId, token: await issueCredential(db, assignmentId) };
}
