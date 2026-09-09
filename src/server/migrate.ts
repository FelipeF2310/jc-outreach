import type { Database } from "./db-contract";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function migrate(db: Database) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS outreach.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of ["002_imports.sql"]) {
    const sql = await readFile(
      `${process.cwd()}/src/server/migrations/${name}`,
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    await db.transaction(async (tx) => {
      await tx.exec("LOCK TABLE outreach.schema_migrations IN EXCLUSIVE MODE");
      const existing = await tx.query<{ checksum: string }>(
        "SELECT checksum FROM outreach.schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(
            "Applied migration checksum changed. Restore the reviewed migration; do not reset data.",
          );
        return;
      }
      await tx.exec(sql);
      await tx.query(
        "INSERT INTO outreach.schema_migrations(name,checksum) VALUES ($1,$2)",
        [name, checksum],
      );
    });
  }
}
