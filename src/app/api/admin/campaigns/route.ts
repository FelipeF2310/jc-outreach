import type { NextRequest } from "next/server";
import { adminEndpoint, requireAdministrator } from "@/server/admin-auth";
import { hostedDatabase } from "@/server/postgres";
import {
  listHostedCampaigns,
  requireHostedReader,
} from "@/server/hosted-campaigns";
import { createAdministratorCampaign } from "@/server/admin-campaigns";
export const GET = (request: NextRequest) =>
  adminEndpoint(request, async (context, config) => {
    await requireAdministrator(context.client, config);
    const db = hostedDatabase();
    const stage = await db.transaction(requireHostedReader);
    return {
      campaigns: await listHostedCampaigns(db),
      live: stage === "outreach-live",
    };
  });
export const POST = (request: NextRequest) =>
  adminEndpoint(request, (context, config) =>
    createAdministratorCampaign(request, context, config),
  );
