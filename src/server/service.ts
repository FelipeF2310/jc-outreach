import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createHash, randomBytes } from "node:crypto";
import {
  DomainError,
  operationSchema,
  programNames,
  type Assignment,
  type Receipt,
} from "../lib/contracts";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function issueCredential(db: PGlite, assignmentId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO outreach.credentials(token_hash,assignment_id) VALUES ($1,$2)",
    [hashToken(token), assignmentId],
  );
  return token;
}
type Access = {
  id: string;
  campaign_id: string;
  name: string;
  event_name: string;
  event_ends_at: Date;
  deletion_at: Date;
  revoked: boolean;
};
async function authorize(
  db: Transaction,
  token: string,
  action: "read" | "write",
  now: Date,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new DomainError(
      401,
      "Assignment link is invalid. Contact your organizer.",
    );
  const { rows } = await db.query<Access>(
    `SELECT a.*, c.deletion_at, k.revoked
    FROM outreach.credentials k JOIN outreach.assignments a ON a.id=k.assignment_id
    JOIN outreach.campaigns c ON c.id=a.campaign_id WHERE k.token_hash=$1 FOR UPDATE OF k, a, c`,
    [hashToken(token)],
  );
  const access = rows[0];
  if (!access)
    throw new DomainError(
      401,
      "Assignment link is unavailable. Contact your organizer.",
    );
  if (access.revoked)
    throw new DomainError(
      403,
      "This assignment was revoked. Pending work cannot be submitted. Contact your organizer.",
    );
  if (now >= access.deletion_at)
    throw new DomainError(410, "Campaign data has expired.");
  const end = access.event_ends_at.getTime();
  if (action === "read" && now.getTime() >= end)
    throw new DomainError(
      403,
      "Field work has ended. Only previously saved work can synchronize.",
    );
  if (action === "write" && now.getTime() >= end + 72 * 3600000)
    throw new DomainError(
      410,
      "The synchronization window has ended. Contact your organizer.",
    );
  return access;
}

export async function downloadAssignment(
  db: PGlite,
  token: string,
  now = new Date(),
): Promise<Assignment> {
  return db.transaction(async (tx) => {
    const access = await authorize(tx, token, "read", now);
    const households = await tx.query<{
      id: string;
      building_id: string;
      address: string;
      unit: string;
      suppressed: boolean;
    }>(
      `SELECT h.id,h.building_id,h.address,h.unit,h.suppressed
      FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
      WHERE m.assignment_id=$1 AND h.campaign_id=$2 ORDER BY m.position`,
      [access.id, access.campaign_id],
    );
    const people = await tx.query<{
      id: string;
      household_id: string;
      first_name: string;
      last_name: string;
    }>(
      `SELECT p.id,p.household_id,p.first_name,p.last_name
      FROM outreach.people p JOIN outreach.memberships m ON m.household_id=p.household_id WHERE m.assignment_id=$1 ORDER BY p.first_name`,
      [access.id],
    );
    // This is intentionally constructed field-by-field. Never return a raw source/database row.
    return {
      id: access.id,
      campaignId: access.campaign_id,
      name: access.name,
      eventName: access.event_name,
      eventEndsAt: access.event_ends_at.toISOString(),
      deletionAt: access.deletion_at.toISOString(),
      synthetic: true,
      households: households.rows.map((h) => ({
        id: h.id,
        buildingId: h.building_id,
        address: h.address,
        unit: h.unit,
        suppressed: h.suppressed,
        people: people.rows
          .filter((p) => p.household_id === h.id)
          .map((p) => ({
            id: p.id,
            firstName: p.first_name,
            lastName: p.last_name,
          })),
      })),
      programs: Object.entries(programNames).map(([id, name]) => ({
        id: id as keyof typeof programNames,
        name,
        summary:
          "Practice reference only. Ask the organizer for reviewed outreach material before field use. This app does not determine eligibility.",
        source: "New Jersey Division of Taxation",
        url: "https://www.nj.gov/treasury/taxation/relief.shtml",
        reviewedAt: null,
      })),
    };
  });
}

export async function submitOperation(
  db: PGlite,
  token: string,
  input: unknown,
  now = new Date(),
): Promise<Receipt> {
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      422,
      "This record failed validation. Keep it on this device and contact your organizer.",
    );
  const op = parsed.data;
  return db.transaction(async (tx) => {
    const access = await authorize(tx, token, "write", now);
    if (access.id !== op.assignmentId)
      throw new DomainError(403, "This record is outside your assignment.");
    const existing = await tx.query<{
      matches: boolean;
      received_at: Date;
      assignment_id: string;
    }>(
      "SELECT payload=$2::jsonb AS matches, received_at, assignment_id FROM outreach.operations WHERE id=$1",
      [op.id, JSON.stringify(op)],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.assignment_id !== access.id || !row.matches)
        throw new DomainError(
          409,
          "This operation ID already exists with different content.",
        );
      return { operationId: op.id, receivedAt: row.received_at.toISOString() };
    }
    if (Date.parse(op.createdAt) >= access.event_ends_at.getTime())
      throw new DomainError(
        422,
        "New field work cannot be recorded after this event ends.",
      );
    if (op.kind === "building") {
      const allowed = await tx.query(
        `SELECT h.id FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
        WHERE m.assignment_id=$1 AND h.building_id=$2 AND h.campaign_id=$3`,
        [access.id, op.buildingId, access.campaign_id],
      );
      if (!allowed.rows.length)
        throw new DomainError(403, "This building is outside your assignment.");
    } else {
      const allowed = await tx.query(
        `SELECT h.id FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
        WHERE m.assignment_id=$1 AND h.id=$2 AND h.campaign_id=$3`,
        [access.id, op.householdId, access.campaign_id],
      );
      if (!allowed.rows.length)
        throw new DomainError(
          403,
          "This household is outside your assignment.",
        );
      if (op.kind === "visit") {
        const personIds = [
          ...op.corrections.map((c) => c.personId),
          op.help?.personId,
        ].filter((id): id is string => !!id);
        for (const id of personIds) {
          const person = await tx.query(
            "SELECT id FROM outreach.people WHERE id=$1 AND household_id=$2",
            [id, op.householdId],
          );
          if (!person.rows.length)
            throw new DomainError(
              403,
              "A selected person is outside this household.",
            );
        }
      }
    }
    if (op.kind === "revision") {
      const visit = await tx.query<{ latest_operation_id: string }>(
        `SELECT v.latest_operation_id FROM outreach.visits v
        JOIN outreach.operations o ON o.id=v.operation_id WHERE v.id=$1 AND v.household_id=$2
        AND v.operation_id=$3 AND o.assignment_id=$4 FOR UPDATE OF v`,
        [op.visitId, op.householdId, op.originalOperationId, access.id],
      );
      if (!visit.rows[0])
        throw new DomainError(
          424,
          "The original visit must synchronize first.",
        );
      if (visit.rows[0].latest_operation_id !== op.previousOperationId)
        throw new DomainError(
          409,
          "This visit has another revision. Contact your organizer to review both records.",
        );
    }
    const stored = await tx.query<{ received_at: Date }>(
      "INSERT INTO outreach.operations(id,assignment_id,payload) VALUES ($1,$2,$3) RETURNING received_at",
      [op.id, access.id, JSON.stringify(op)],
    );
    if (op.kind === "building") {
      await tx.query(
        "INSERT INTO outreach.building_attempts VALUES ($1,$2,$3)",
        [op.id, op.buildingId, op.reason],
      );
    } else if (op.kind === "revision") {
      // Contact-result revisions do not mutate help/correction identifiers or administrator-managed state.
      await tx.query(
        "UPDATE outreach.visits SET result=$1,latest_operation_id=$2 WHERE id=$3",
        [op.result, op.id, op.visitId],
      );
    } else {
      await tx.query("INSERT INTO outreach.visits VALUES ($1,$2,$3,$3,$4)", [
        op.visitId,
        op.householdId,
        op.id,
        op.result,
      ]);
      if (op.help) {
        const h = op.help;
        await tx.query(
          "INSERT INTO outreach.help_requests(id,visit_id,person_id,phone,consent,arrangement) VALUES ($1,$2,$3,$4,$5,$6)",
          [h.id, op.visitId, h.personId, h.phone, h.consent, h.arrangement],
        );
      }
      for (const c of op.corrections)
        await tx.query(
          "INSERT INTO outreach.corrections VALUES ($1,$2,$3,$4)",
          [c.id, op.visitId, c.personId, c.kind],
        );
      if (op.doNotContact)
        await tx.query(
          "UPDATE outreach.households SET suppressed=true WHERE id=$1",
          [op.householdId],
        );
    }
    return {
      operationId: op.id,
      receivedAt: stored.rows[0].received_at.toISOString(),
    };
  });
}

export async function results(db: PGlite) {
  const visits = await db.query<{
    id: string;
    address: string;
    unit: string;
    result: keyof typeof import("../lib/contracts").outcomes;
    received_at: Date;
  }>(`SELECT v.id,h.address,h.unit,v.result,o.received_at FROM outreach.visits v
    JOIN outreach.households h ON h.id=v.household_id JOIN outreach.operations o ON o.id=v.operation_id
    JOIN outreach.campaigns c ON c.id=h.campaign_id WHERE c.deletion_at>now() ORDER BY o.received_at DESC`);
  const counts = await db.query<{
    attempts: number;
    repeats: number;
    conversations: number;
    buildings: number;
    help: number;
  }>(`SELECT
    (SELECT count(DISTINCT v.household_id)::int FROM outreach.visits v JOIN outreach.households h ON h.id=v.household_id JOIN outreach.campaigns c ON c.id=h.campaign_id WHERE c.deletion_at>now()) AS attempts,
    (SELECT (count(*)-count(DISTINCT v.household_id))::int FROM outreach.visits v JOIN outreach.households h ON h.id=v.household_id JOIN outreach.campaigns c ON c.id=h.campaign_id WHERE c.deletion_at>now()) AS repeats,
    (SELECT count(*)::int FROM outreach.visits v JOIN outreach.households h ON h.id=v.household_id JOIN outreach.campaigns c ON c.id=h.campaign_id WHERE c.deletion_at>now() AND v.result IN ('resident','other')) AS conversations,
    (SELECT count(*)::int FROM outreach.building_attempts b JOIN outreach.operations o ON o.id=b.operation_id JOIN outreach.assignments a ON a.id=o.assignment_id JOIN outreach.campaigns c ON c.id=a.campaign_id WHERE c.deletion_at>now()) AS buildings,
    (SELECT count(*)::int FROM outreach.help_requests r JOIN outreach.visits v ON v.id=r.visit_id JOIN outreach.households h ON h.id=v.household_id JOIN outreach.campaigns c ON c.id=h.campaign_id WHERE c.deletion_at>now()) AS help`);
  const assignments = await db.query<{
    id: string;
    name: string;
    deletion_at: Date;
  }>(
    "SELECT a.id,a.name,c.deletion_at FROM outreach.assignments a JOIN outreach.campaigns c ON c.id=a.campaign_id WHERE c.deletion_at>now()",
  );
  return {
    visits: visits.rows,
    counts: counts.rows[0],
    assignments: assignments.rows,
    observedAt: new Date().toISOString(),
  };
}
