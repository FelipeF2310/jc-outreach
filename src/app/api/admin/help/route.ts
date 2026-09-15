import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { manageAdministratorHelp } from "@/server/admin-help";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return adminEndpoint(request, (context, config) =>
    manageAdministratorHelp(request, context, config),
  );
}
