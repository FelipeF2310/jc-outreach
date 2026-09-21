import type { Database } from "./db-contract";
import { listHostedCampaigns } from "./hosted-campaigns";
import { verifyReader } from "./verify-reader";

/** Read-only operator verification. Names are aggregated inside Postgres and
 * never returned to the CLI. This does not authenticate a browser administrator. */
export async function verifyAdminResidents(db: Database) {
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const read = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await verifyReader(read);
    const campaigns = (await listHostedCampaigns(read)).filter(
      // Pre-event practice imports can lack an end timestamp. The assignment
      // workspace intentionally rejects those; verify the same eligible scope.
      (c) => c.importReceipt && c.assignmentsReady && c.endAt !== null,
    );
    let households = 0,
      residents = 0;
    for (const campaign of campaigns) {
      const { rows } = await tx.query<{
        households: number;
        residents: number;
        names_valid: boolean;
      }>(
        `
        WITH workspace AS MATERIALIZED (SELECT outreach.assignment_workspace($1) AS value),
        doors AS (SELECT h FROM workspace, jsonb_array_elements(value->'households') h)
        SELECT count(*)::integer AS households,
          coalesce(sum(jsonb_array_length(h->'people')),0)::integer AS residents,
          coalesce(bool_and(jsonb_typeof(h->'people')='array'
            AND jsonb_array_length(h->'people')=(h->>'peopleCount')::integer
            AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'people') p
              WHERE jsonb_typeof(p->'firstName') IS DISTINCT FROM 'string'
                OR jsonb_typeof(p->'lastName') IS DISTINCT FROM 'string'
                OR length(btrim(p->>'firstName'))=0 OR length(btrim(p->>'lastName'))=0
                OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) key WHERE key NOT IN ('firstName','lastName')))),false) AS names_valid
        FROM doors`,
        [campaign.id],
      );
      const checked = rows[0];
      if (
        !checked?.names_valid ||
        checked.households !== campaign.importReceipt!.counts.households ||
        checked.residents !== campaign.importReceipt!.counts.people
      )
        throw Error("Resident-name projection could not be verified.");
      households += checked.households;
      residents += checked.residents;
    }
    return {
      verifiedAt: new Date().toISOString(),
      campaignsChecked: campaigns.length,
      householdsChecked: households,
      residentsChecked: residents,
      restrictedPrivilegesVerified: true,
      residentNamesVerified: campaigns.length > 0,
    };
  });
}
