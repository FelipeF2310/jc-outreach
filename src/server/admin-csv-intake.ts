import type { NextRequest } from "next/server";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { hostedDatabase } from "./postgres";
import { DomainError } from "../lib/contracts";
import { csvImportAction, importCsvBytes, readCsvBody } from "./csv-intake";

/** Prepared handler, NOT registered in app/api. The default ingress gate stays
 * closed. Future activation requires reviewed server-owned policy, never a
 * client header, a claimed administrator ID or a browser validation flag. */
export async function importAdministratorCsv(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  dependencies: {
    database?: typeof hostedDatabase;
    ingressApproved?: () => Promise<boolean>;
  } = {},
) {
  const administrator = await requireAdministrator(context.client, config);
  if (!(await dependencies.ingressApproved?.()))
    throw new DomainError(
      503,
      "CSV uploads are not enabled. Continue using the practice examples.",
    );
  const action = request.headers.get("X-JCO-Import-Action");
  const metadata = csvImportAction.safeParse({
    action,
    campaignId: request.headers.get("X-JCO-Campaign"),
    ...(action === "finalize"
      ? {
          digest: request.headers.get("X-JCO-Source-Digest"),
          confirmed: request.headers.get("X-JCO-Import-Confirmed") === "true",
        }
      : {}),
  });
  if (!metadata.success)
    throw new DomainError(400, "Invalid CSV import request.");
  const bytes = await readCsvBody(request);
  return importCsvBytes(
    (dependencies.database ?? hostedDatabase)(),
    metadata.data,
    bytes,
    administrator.id,
  );
}
