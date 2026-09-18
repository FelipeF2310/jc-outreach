import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { prepareAdministratorAssignment } from "@/server/admin-assignments";
export const runtime = "nodejs";
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    prepareAdministratorAssignment(request, context, config),
  );
