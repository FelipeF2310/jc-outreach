import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { manageAdministratorCorrection } from "@/server/admin-corrections";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return adminEndpoint(request, (context, config) =>
    manageAdministratorCorrection(request, context, config),
  );
}
