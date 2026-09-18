import { Pool } from "pg";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { inspectUploadLogging } from "../src/server/upload-safety";
import { safeConnectionFailure } from "../src/server/owner-preflight";

async function main() {
  let pool: Pool | undefined;
  try {
    if (
      process.env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
      !process.env.DATABASE_URL
    )
      throw new Error("Synthetic restricted configuration required.");
    pool = new Pool({
      ...postgresOptions(process.env.DATABASE_URL, process.env.JCO_DATABASE_CA),
      max: 1,
    });
    pool.on("error", () => {});
    const result = await inspectUploadLogging(postgresDatabase(pool));
    console.info(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          audit: "database_upload_logging",
          ...result,
        },
        null,
        2,
      ),
    );
    if (!result.loggingBaselinePassed) process.exitCode = 2;
  } catch (error) {
    console.error(
      JSON.stringify({
        audit: "database_upload_logging",
        category: safeConnectionFailure(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

void main().catch(() => {
  console.error("Upload safety audit could not complete.");
  process.exitCode = 1;
});
