import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import fixture from "../../tests/fixtures/outreach.json";
import { migrate } from "./migrate";

export async function createDatabase(path?: string) {
  const db = await PGlite.create(path);
  try {
    await db.exec(
      await readFile(`${process.cwd()}/src/server/schema.sql`, "utf8"),
    );
    await migrate(db, ["002_imports.sql", "011_completion_data.sql"]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

/** Only explicitly synthetic fixtures may enter this temporary development backend. */
export async function seedSynthetic(db: PGlite) {
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM outreach.assignments LIMIT 1",
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const campaign = randomUUID(),
      assignment = randomUUID();
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const deletion = new Date(Date.now() + 37 * 86400000).toISOString();
    await tx.query("INSERT INTO outreach.campaigns VALUES ($1,$2,$3)", [
      campaign,
      "Synthetic outreach rehearsal",
      deletion,
    ]);
    await tx.query("INSERT INTO outreach.assignments VALUES ($1,$2,$3,$4,$5)", [
      assignment,
      campaign,
      "Practice walk",
      "Jersey City · Field rehearsal",
      end,
    ]);
    const buildings = new Map<string, string>(),
      households = new Map<string, string>();
    for (const row of fixture.records) {
      const address = row["Property Location"];
      if (!buildings.has(address)) buildings.set(address, randomUUID());
      const key = row["Household Key"];
      if (!households.has(key)) {
        const id = randomUUID();
        households.set(key, id);
        await tx.query(
          "INSERT INTO outreach.households(id,campaign_id,building_id,address,unit) VALUES ($1,$2,$3,$4,$5)",
          [
            id,
            campaign,
            buildings.get(address),
            address,
            row["Unit (verified)"],
          ],
        );
        await tx.query("INSERT INTO outreach.memberships VALUES ($1,$2,$3)", [
          assignment,
          id,
          households.size,
        ]);
      }
      await tx.query("INSERT INTO outreach.people VALUES ($1,$2,$3,$4)", [
        randomUUID(),
        households.get(key),
        row["First Name"],
        row["Last Name"],
      ]);
    }
    return assignment;
  });
}

const globalDb = globalThis as typeof globalThis & {
  jcoDatabase?: Promise<PGlite>;
};
export async function demoDatabase() {
  if (
    process.env.JCO_SYNTHETIC_ONLY !== "1" ||
    process.env.VERCEL ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Synthetic development backend is disabled.");
  }
  globalDb.jcoDatabase ??= (async () => {
    const db = await createDatabase(
      process.env.JCO_EPHEMERAL_DEMO === "1" ? undefined : ".jco-demo",
    );
    await seedSynthetic(db);
    return db;
  })();
  return globalDb.jcoDatabase;
}
