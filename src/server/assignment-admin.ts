import { z } from "zod";
import {
  assignmentAdminRequest,
  type AssignmentWorkspace,
} from "../lib/assignment-admin-contracts";
import { DomainError } from "../lib/contracts";
import type { Database } from "./db-contract";
import { requireHostedReader } from "./hosted-campaigns";

export async function assignmentAdmin(
  db: Database,
  input: unknown,
  actor: string,
) {
  const parsed = assignmentAdminRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(
      400,
      "Choose a campaign, valid event details and a nonduplicated list of household IDs only.",
    );
  const request = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      await requireHostedReader(tx);
      let savedId: string | undefined;
      if (request.action === "reassign") {
        const saved = await tx.query<{ id: string }>(
          "SELECT outreach.reassign_households($1,$2,$3,$4,$5::uuid[],$6) AS id",
          [
            request.id,
            request.campaignId,
            request.sourceId,
            request.name,
            request.householdIds,
            actor,
          ],
        );
        savedId = saved.rows[0]?.id;
      }
      if (request.action === "event") {
        const saved = await tx.query<{ id: string }>(
          "SELECT outreach.create_outreach_event($1,$2,$3,$4,$5) AS id",
          [
            request.id,
            request.campaignId,
            request.name,
            request.endDate,
            actor,
          ],
        );
        savedId = saved.rows[0]?.id;
      }
      if (request.action === "assignment") {
        const saved = await tx.query<{ id: string }>(
          "SELECT outreach.prepare_assignment($1,$2,$3,$4,$5,$6::uuid[],$7) AS id",
          [
            request.id,
            request.campaignId,
            request.eventId,
            request.name,
            request.kind,
            request.householdIds,
            actor,
          ],
        );
        savedId = saved.rows[0]?.id;
      }
      if (request.action !== "workspace" && savedId !== request.id)
        throw new Error("Save receipt unavailable.");
      const data = await tx.query<{ workspace: AssignmentWorkspace }>(
        "SELECT outreach.assignment_workspace($1) AS workspace",
        [request.campaignId],
      );
      const workspace = data.rows[0]?.workspace;
      if (!workspace || workspace.campaignId !== request.campaignId)
        throw new Error("Workspace unavailable.");
      workspace.households.sort(
        (a, b) =>
          a.address.localeCompare(b.address, "en", { numeric: true }) ||
          a.unit.localeCompare(b.unit, "en", { numeric: true }) ||
          a.id.localeCompare(b.id),
      );
      return { workspace, ...(savedId ? { savedId } : {}) };
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "42883")
      throw new DomainError(
        503,
        "Assignment preparation needs its database update. Existing campaigns and imports are unchanged.",
      );
    if (code === "JA001" || code === "JR404")
      throw new DomainError(
        404,
        "This imported campaign is unavailable or expired.",
      );
    if (code === "JA002" || code === "22007" || code === "22008")
      throw new DomainError(
        400,
        "Check the event date and selected households. Use an active event within the campaign, unsuppressed doors, and one building for a building run.",
      );
    if (code === "JR422")
      throw new DomainError(
        400,
        "Choose an active event, a new assignment name and valid doors. No doors were moved.",
      );
    if (code === "JR409")
      throw new DomainError(
        409,
        "The selected doors or save details changed. Refresh assignments before trying again. No partial reassignment was saved.",
      );
    if (code === "JA003")
      throw new DomainError(
        409,
        "This save ID already has different details. Refresh the workspace before making a new save.",
      );
    if (code === "23505")
      throw new DomainError(
        409,
        "A selected household is already assigned in this event, or the save ID is already used. Refresh the workspace; no partial assignment was saved.",
      );
    throw error;
  }
}
