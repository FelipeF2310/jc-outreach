import { currentRelease } from "@/lib/app-release";
export const dynamic = "force-dynamic";
// Public build metadata only. No credentials, assignment or resident data.
export function GET() {
  return Response.json(currentRelease, {
    headers: { "Cache-Control": "no-store", "X-JCO-Live-Campaigns": "1" },
  });
}
