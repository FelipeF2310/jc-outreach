import { Pool, type PoolConfig } from "pg";
import { DomainError } from "../lib/contracts";
import type { Database, SqlConnection } from "./db-contract";

export function postgresOptions(
  connectionString: string,
  ca?: string,
): PoolConfig {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Invalid database configuration. Use a PostgreSQL URL without query parameters.",
    );
  return {
    connectionString,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 20000,
    application_name: "jco-server",
  };
}

/** All statements inside a transaction use the same checked-out connection. */
export function postgresDatabase(pool: Pool): Database {
  const connection = (client: Pick<Pool, "query">): SqlConnection => ({
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });
  return {
    ...connection(pool),
    async transaction<T>(work: (tx: SqlConnection) => Promise<T>) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        const value = await work(connection(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          broken = true;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
  };
}

const globalPool = globalThis as typeof globalThis & { jcoHostedPool?: Pool };
export function hostedDatabase(): Database {
  if (
    process.env.JCO_SYNTHETIC_ONLY === "1" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    !process.env.DATABASE_URL
  ) {
    throw new DomainError(
      503,
      "Database setup is incomplete. Your administrator sign-in is working, but campaigns are not connected yet.",
    );
  }
  if (!globalPool.jcoHostedPool) {
    const pool = new Pool(
      postgresOptions(process.env.DATABASE_URL, process.env.JCO_DATABASE_CA),
    );
    // Idle socket failures must not crash the server or print connection secrets.
    pool.on("error", () => {
      console.error("Hosted database connection interrupted.");
    });
    globalPool.jcoHostedPool = pool;
  }
  return postgresDatabase(globalPool.jcoHostedPool);
}
