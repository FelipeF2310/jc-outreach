import type { NextRequest } from "next/server";
import { adminEndpoint, sendAdminCode } from "@/server/admin-auth";
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    sendAdminCode(request, context, config),
  );
