import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { readAdministratorRetention } from "@/server/admin-retention";
export const runtime = "nodejs";
// POST carries a read-only campaign selection. There is no web deletion action.
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    readAdministratorRetention(request, context, config),
  );
