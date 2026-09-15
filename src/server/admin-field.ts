import type { NextRequest } from "next/server";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { readOperation } from "./http";
import { hostedDatabase } from "./postgres";
import { hostedFieldAdmin } from "./hosted-field";
export async function manageAdministratorField(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  const administrator = await requireAdministrator(context.client, config);
  const input = await readOperation(request);
  return hostedFieldAdmin(database(), input, administrator.id);
}
