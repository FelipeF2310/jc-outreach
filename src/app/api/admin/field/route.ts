import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { manageAdministratorField } from "@/server/admin-field";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return adminEndpoint(request, (context, config) =>
    manageAdministratorField(request, context, config),
  );
}
