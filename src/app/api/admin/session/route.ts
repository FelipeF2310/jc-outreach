import type { NextRequest } from "next/server";
import {
  adminEndpoint,
  requireAdministrator,
  signOutAdministrator,
} from "@/server/admin-auth";
export const GET = (request: NextRequest) =>
  adminEndpoint(request, async (context, config) => ({
    administrator: await requireAdministrator(context.client, config),
  }));
export const DELETE = (request: NextRequest) =>
  adminEndpoint(request, (context) => signOutAdministrator(context));
