import { readFile } from "node:fs/promises";
import type { Database } from "./db-contract";
import { migrate } from "./migrate";

/** Explicit operator action; never invoked by an HTTP handler or app startup. */
export async function prepareHosted(db: Database) {
  await db.transaction(async (tx) => {
    // Serialize bootstrap attempts without replacing an existing dataset or role.
    await tx.query("SELECT pg_advisory_xact_lock(73401829)");
    const existing = await tx.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='outreach') AS present",
    );
    if (existing.rows[0].present)
      throw new Error(
        "Hosted bootstrap requires an empty outreach namespace. Existing data was not changed.",
      );
    await tx.exec(
      await readFile(`${process.cwd()}/src/server/schema.sql`, "utf8"),
    );
    await migrate({ ...tx, transaction: async (work) => work(tx) });
    await tx.exec(
      await readFile(
        `${process.cwd()}/src/server/hosted-bootstrap.sql`,
        "utf8",
      ),
    );
  });
}
