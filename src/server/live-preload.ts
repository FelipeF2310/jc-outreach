import { z } from "zod";
import type { Database } from "./db-contract";
import { createHostedCampaign, requireHostedReader } from "./hosted-campaigns";
import { importCsvBytes } from "./csv-intake";
import { validateImport, buildingKey } from "./import-validation";
import { assignmentAdmin } from "./assignment-admin";
import { DomainError } from "../lib/contracts";

const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const preloadPlanSchema = z.strictObject({
  campaign: z.strictObject({
    id: z.uuid(),
    name: label,
    endDate: z.iso.date(),
  }),
  event: z.strictObject({ id: z.uuid(), name: label, endDate: z.iso.date() }),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  pairs: z
    .array(
      z.strictObject({
        id: z.uuid(),
        label,
        householdKeys: z.array(z.string().min(1).max(1000)).min(1).max(1000),
      }),
    )
    .min(1)
    .max(30),
});

/** No HTTP route calls this service. The local CLI must verify the administrator
 * with the Auth provider before calling. No owner connection may import rows.
 * One transaction includes campaign, exact approved import, event and all turfs.
 */
export async function preloadLiveCampaign(
  db: Database,
  input: unknown,
  bytes: Uint8Array,
  verifiedActor: string,
) {
  const parsed = preloadPlanSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(verifiedActor).success)
    throw new DomainError(400, "Invalid campaign preparation plan.");
  const plan = parsed.data;
  const source = validateImport(bytes);
  if (!source.preview.valid || source.preview.digest !== plan.sourceDigest)
    throw new DomainError(
      422,
      "The approved source failed validation or its exact bytes changed.",
    );
  if (plan.event.endDate > plan.campaign.endDate)
    throw new DomainError(400, "Event must end within the campaign.");
  const keys = new Set(source.rows.map((r) => r["Household Key"]));
  const assigned = plan.pairs.flatMap((p) => p.householdKeys);
  const ids = [plan.campaign.id, plan.event.id, ...plan.pairs.map((p) => p.id)];
  if (
    new Set(ids).size !== ids.length ||
    new Set(plan.pairs.map((p) => p.label)).size !== plan.pairs.length ||
    assigned.length !== keys.size ||
    new Set(assigned).size !== keys.size ||
    assigned.some((k) => !keys.has(k))
  )
    throw new DomainError(
      422,
      "Every imported household must belong to exactly one distinct pair.",
    );
  const pairByKey = new Map(
    plan.pairs.flatMap((p) => p.householdKeys.map((k) => [k, p.id] as const)),
  );
  const buildingOwners = new Map<string, string>();
  for (const row of source.rows) {
    const owner = pairByKey.get(row["Household Key"])!;
    const building = buildingKey(row);
    if (buildingOwners.has(building) && buildingOwners.get(building) !== owner)
      throw new DomainError(
        422,
        "A building cannot be split between pairs in this preparation.",
      );
    buildingOwners.set(building, owner);
  }
  return db.transaction(async (tx) => {
    if ((await requireHostedReader(tx)) !== "outreach-live")
      throw new DomainError(503, "Reviewed live mode has not been activated.");
    // The request ID remains stable in the private plan across uncertain replies.
    // Serialize the complete package before campaign/import/assignment locks.
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,73401839))",
      [plan.campaign.id],
    );
    const nested: Database = { ...tx, transaction: async (work) => work(tx) };
    const campaign = await createHostedCampaign(
      nested,
      plan.campaign,
      verifiedActor,
    );
    const result = await importCsvBytes(
      nested,
      {
        action: "finalize",
        campaignId: campaign.id,
        digest: plan.sourceDigest,
        confirmed: true,
      },
      bytes,
      verifiedActor,
    );
    if (!("receipt" in result)) throw new Error("Import receipt unavailable");
    const event = await assignmentAdmin(
      nested,
      {
        action: "event",
        campaignId: campaign.id,
        ...plan.event,
      },
      verifiedActor,
    );
    const householdMap = new Map(
      event.workspace.households.map((h) => [h.sourceKey, h]),
    );
    if (
      householdMap.size !== keys.size ||
      [...keys].some((k) => !householdMap.has(k))
    )
      throw new Error("Imported household mapping unavailable");
    let workspace = event.workspace;
    for (const pair of plan.pairs) {
      const households = pair.householdKeys.map((key) =>
        householdMap.get(key)!,
      );
      const saved = await assignmentAdmin(
        nested,
        {
          action: "assignment",
          id: pair.id,
          campaignId: campaign.id,
          eventId: plan.event.id,
          name: pair.label,
          kind:
            new Set(households.map((h) => h.buildingId)).size === 1
              ? "building"
              : "scattered",
          householdIds: households.map((h) => h.id),
        },
        verifiedActor,
      );
      workspace = saved.workspace;
    }
    const actual = workspace.assignments.filter(
      (a) => a.eventId === plan.event.id,
    );
    if (
      actual.length !== plan.pairs.length ||
      actual.reduce((n, a) => n + a.householdIds.length, 0) !== keys.size
    )
      throw new Error("Saved assignment totals do not match the approved plan");
    return {
      campaign,
      receipt: result.receipt,
      eventId: plan.event.id,
      pairs: plan.pairs.map((p) => ({
        id: p.id,
        label: p.label,
        households: p.householdKeys.length,
      })),
      volunteerNamesEntered: false,
      credentialsIssued: 0,
    };
  });
}
