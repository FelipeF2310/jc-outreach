import type { NextRequest } from "next/server";
import { adminEndpoint } from "@/server/admin-auth";
import { importAdministratorExample } from "@/server/admin-imports";
export const runtime = "nodejs";
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    importAdministratorExample(request, context, config),
  );
