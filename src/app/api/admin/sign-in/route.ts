import type { NextRequest } from "next/server";
import { adminEndpoint, signInAdministrator } from "@/server/admin-auth";
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    signInAdministrator(request, context, config),
  );
