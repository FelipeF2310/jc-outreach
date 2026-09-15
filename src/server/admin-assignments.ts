import type { NextRequest } from "next/server";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { readOperation } from "./http";
import { hostedDatabase } from "./postgres";
import { assignmentAdmin } from "./assignment-admin";

export async function prepareAdministratorAssignment(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  const administrator = await requireAdministrator(context.client, config);
  // Bounded IDs-only list: 1,000 UUIDs may exceed the field operation's 16 KiB cap.
  const input = await readOperation(request, 65536);
  return assignmentAdmin(database(), input, administrator.id);
}
