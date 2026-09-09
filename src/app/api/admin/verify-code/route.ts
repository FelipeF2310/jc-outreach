import type { NextRequest } from "next/server";
import { adminEndpoint, verifyAdminCode } from "@/server/admin-auth";
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    verifyAdminCode(request, context, config),
  );
