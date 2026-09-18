import type { NextRequest } from "next/server";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { readOperation } from "./http";
import { hostedImport } from "./hosted-imports";
import { hostedDatabase } from "./postgres";

export async function importAdministratorExample(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  const administrator = await requireAdministrator(context.client, config);
  const input = await readOperation(request);
  return hostedImport(database(), input, administrator.id);
}
