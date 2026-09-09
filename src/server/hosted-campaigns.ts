import type { Database } from "./db-contract";

export async function listHostedCampaigns(db: Database) {
  return db.transaction(async (tx) => {
    const marker = await tx.query<{ stage: string; role: string }>(
      "SELECT stage, current_user AS role FROM outreach.deployment WHERE singleton = true",
    );
    if (
      marker.rows[0]?.stage !== "synthetic-preview" ||
      marker.rows[0]?.role !== "jco_admin_reader"
    )
      throw new Error(
        "Database stage or runtime role does not match the reviewed configuration.",
      );
    const { rows } = await tx.query<{
      id: string;
      name: string;
      deletion_at: Date;
    }>(
      "SELECT id,name,deletion_at FROM outreach.campaigns WHERE deletion_at > now() ORDER BY deletion_at,id LIMIT 100",
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      deletionAt: row.deletion_at.toISOString(),
    }));
  });
}
