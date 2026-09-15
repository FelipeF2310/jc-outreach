import type { NextRequest } from "next/server";
import { adminEndpoint, requireAdministrator } from "@/server/admin-auth";
import { hostedDatabase } from "@/server/postgres";
import { listHostedCampaigns } from "@/server/hosted-campaigns";
import { createAdministratorCampaign } from "@/server/admin-campaigns";
export const GET = (request: NextRequest) =>
  adminEndpoint(request, async (context, config) => {
    await requireAdministrator(context.client, config);
    return { campaigns: await listHostedCampaigns(hostedDatabase()) };
  });
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    createAdministratorCampaign(request, context, config),
  );
